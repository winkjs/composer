// core/source-manager/csv/start.js

/**
 * @fileoverview CSV streaming source implementation.
 *
 * Reads CSV file line-by-line using Node.js streams for memory efficiency.
 * Each row is parsed and emitted as a message to the pipeline.
 *
 * Adapter contract (ADR-018, source role):
 * - Every `onStatus` payload carries the uniform structured shape per
 *   ADR-018: `{status: 'green' | 'yellow' | 'red', connected, phase}`;
 *   the error path adds an `error: {code, message}` field. One payload
 *   rule, no exceptions (uniformity sweep, 2026-07-09). Callers without
 *   an `onStatus` handler still see error-path failures via a classified
 *   `console.error` line (fallback).
 * - Lifecycle phases emitted (`status: 'green'` for all, since the file
 *   stream is healthy until it errors):
 *     `phase: 'starting'` — file open, includes `path`.
 *     `phase: 'headers'`  — header line parsed, includes `headers` array.
 *     `phase: 'complete'` — file fully consumed; `connected: false` (stream
 *                           closed). Includes the uniform `count` of
 *                           produced messages (per ADR-018 there is no
 *                           onComplete callback) and the `skipped` count
 *                           of rows read but not delivered: structurally
 *                           malformed, transform-dropped, or
 *                           transform-failed. For in-range rows,
 *                           count + skipped covers every data row read.
 *     `phase: 'errored'`  — terminal red: the run loop failed and the
 *                           stream is dead (the ADR-018 two-tier rule).
 *     `phase: 'stopped'`  — forced stop exceeded its time budget
 *                           (`status: 'yellow'`, with a `note`).
 *
 * `err.code` vocabulary (per-adapter; ADR-018 requires it documented here):
 * - `SOURCE_UNREACHABLE` — file open failed (Node fs error code ENOENT,
 *   EACCES, or EISDIR). Classified at error time so consumers can route
 *   on code without parsing fs error strings.
 * - `DECODE_ERROR`       — one data row could not be parsed (field count
 *   does not match the header, or an unterminated quoted field). The row
 *   is skipped, the skip is signalled with `status: 'yellow'`, and the
 *   stream continues — per-record skip-classify-continue (ADR-018).
 *   A bad field VALUE in a parseable row is NOT a decode error;
 *   it passes through for the pipeline (`sanitize`) to judge.
 * - `CALLBACK_FAILED`    — the user's `transform` threw on one row. The
 *   row is skipped (counted in `skipped`), the throw is reported per
 *   record with `status: 'yellow'`, and the stream continues — user
 *   code is never reported as a stream failure. Fix the transform
 *   function; the report names the data row. Uniform with the MQTT
 *   source (transform contract, 2026-07-11).
 * - `READ_ERROR`         — stream read failed mid-stream (encoding error,
 *   truncation, decoder failure, etc.). Catch-all for non-open failures.
 */

import fs from 'node:fs';
import readline from 'node:readline';

/**
 * Detects delimiter from header line.
 * @param {string} headerLine - First line of CSV
 * @returns {string} Detected delimiter
 */
const detectDelimiter = function ( headerLine ) {
    if ( headerLine.includes( '\t' ) ) return '\t';
    if ( headerLine.includes( ';' ) ) return ';';
    return ',';
};

/**
 * Parses a CSV line into values.
 *
 * Also reports whether the line ended inside an open quote — a
 * structural fault the caller classifies as `DECODE_ERROR` (ADR-018).
 *
 * @param {string} line - CSV line
 * @param {string} delimiter - Field delimiter
 * @returns {{values: string[], unterminated: boolean}} Parsed values
 *   and the unterminated-quote flag
 */
const parseLine = function ( line, delimiter ) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for ( let i = 0; i < line.length; i += 1 ) {
        const char = line[ i ];

        if ( char === '"' ) {
            inQuotes = !inQuotes;
        } else if ( char === delimiter && !inQuotes ) {
            values.push( current.trim() );
            current = '';
        } else {
            current += char;
        }
    }
    values.push( current.trim() );

    return { values, unterminated: inQuotes };
};

/**
 * Names the structural fault in a data row, or returns null when the
 * row is structurally sound (the ADR-018 boundary: field-count
 * mismatch and an unterminated quote are the source's DECODE_ERROR;
 * a bad field VALUE inside a parseable row is the pipeline's concern
 * and passes through).
 *
 * @param {{values: string[], unterminated: boolean}} parsed - parseLine result
 * @param {string[]} headers - Column headers
 * @returns {string|null} Fault description, or null when sound
 */
const structuralFault = function ( parsed, headers ) {
    if ( parsed.unterminated ) {
        return 'unterminated quoted field';
    }
    if ( parsed.values.length !== headers.length ) {
        return `expected ${headers.length} fields, got ${parsed.values.length}`;
    }
    return null;
};

/**
 * Casts string value to appropriate type.
 * @param {string} value - String value
 * @returns {*} Typed value
 */
const castValue = function ( value ) {
    if ( value === '' ) return null;
    if ( value.toLowerCase() === 'true' ) return true;
    if ( value.toLowerCase() === 'false' ) return false;

    const num = Number( value );
    if ( !Number.isNaN( num ) ) return num;

    return value;
};

/**
 * Builds a row object from parsed CSV values.
 * @param {string[]} headers - Column headers
 * @param {string[]} values - Parsed values for this row
 * @param {boolean} dynamicTyping - Whether to auto-cast values
 * @returns {Object} Row object with header keys
 */
const buildRow = function ( headers, values, dynamicTyping ) {
    const row = Object.create( null );

    for ( let i = 0; i < headers.length; i += 1 ) {
        let value = values[ i ];
        if ( dynamicTyping ) {
            value = castValue( value );
        }
        row[ headers[ i ] ] = value;
    }

    return row;
};

/**
 * Checks range filter status for a row.
 * @param {*} rangeKey - Current row's range key (field value or index)
 * @param {boolean} wasInRange - Previous inRange state
 * @param {*} startMsgId - Start of range (inclusive)
 * @param {*} endMsgId - End of range (inclusive)
 * @returns {{inRange: boolean, shouldStop: boolean}} Range status
 */
const checkRange = function ( rangeKey, wasInRange, startMsgId, endMsgId ) {
    let inRange = wasInRange;

    // Check if we should start processing
    if ( !inRange && startMsgId !== null && rangeKey >= startMsgId ) {
        inRange = true;
    }

    // Check if we should stop after this row
    const shouldStop = endMsgId !== null && rangeKey >= endMsgId;

    return { inRange, shouldStop };
};

/**
 * Starts streaming CSV source.
 *
 * @param {Object} config - Source configuration
 * @param {string} config.path - Path to CSV file
 * @param {Function} config.onMessage - Message handler
 * @param {number} [config.delayMs=0] - Delay between messages (ms)
 * @param {boolean} [config.dynamicTyping=true] - Auto-cast values
 * @param {Function} [config.transform] - Optional row transform:
 *   ( row ) => row; return null/undefined to drop (counted in skipped);
 *   a throw skips the row (CALLBACK_FAILED) and the stream continues
 * @param {Function} [config.onStatus] - Status callback; completion arrives
 *   here as `{phase: 'complete', count, skipped}` (per ADR-018 there is
 *   no onComplete callback)
 * @param {Function} [config.onShutdown] - Shutdown handler (injected by runtime)
 * @param {boolean} [config.shutdownOnComplete=true] - Auto-shutdown pipeline when CSV ends
 * @param {string} [config.idField] - Field to use for range matching (row index if omitted)
 * @param {number|string} [config.startMsgId] - Start processing at this id/row (inclusive)
 * @param {number|string} [config.endMsgId] - Stop processing after this id/row (inclusive)
 * @returns {Function} Stop function
 */
export const start = function ( config ) {
    const {
        path,
        onMessage,
        delayMs = 0,
        dynamicTyping = true,
        transform = null,
        onStatus = null,
        onShutdown = null,
        shutdownOnComplete = true,
        idField = null,
        startMsgId = null,
        endMsgId = null
    } = config;

    let stopped = false;
    let rowCount = 0;
    let rowIndex = 0;
    let skippedCount = 0;
    let inRange = ( startMsgId === null );  // Start immediately if no startMsgId

    // Per-record skip-classify-continue (ADR-018): a structurally
    // malformed row is skipped and signalled — never a silent drop. When
    // the caller owns reporting (onStatus supplied) the framework stays
    // quiet; without one, the classified console.error keeps the skip
    // visible (ADR-018's two-party rule).
    const reportDecodeError = function ( dataRowIndex, fault ) {
        const message = `data row ${dataRowIndex}: ${fault} — row skipped`;
        if ( onStatus ) {
            onStatus( {
                status: 'yellow',
                connected: true,
                phase: 'running',
                error: { code: 'DECODE_ERROR', message }
            } );
        } else {
            console.error( `CSV source error [DECODE_ERROR]: ${message}` );
        }
    };

    // A throwing transform is user code, never a stream failure: the
    // row is skipped with a per-record CALLBACK_FAILED report and the
    // stream continues (transform contract, uniform with the MQTT
    // source, 2026-07-11). Same two-party reporting rule as decode
    // errors above.
    const reportCallbackError = function ( dataRowIndex, err ) {
        const message = `data row ${dataRowIndex}: transform threw: ${err.message} — row skipped`;
        if ( onStatus ) {
            onStatus( {
                status: 'yellow',
                connected: true,
                phase: 'running',
                error: { code: 'CALLBACK_FAILED', message }
            } );
        } else {
            console.error( `CSV source error [CALLBACK_FAILED]: ${message}` );
        }
    };

    // Run the user's transform under guard. Returns the transformed
    // row; null when the transform threw (reported above) — the caller
    // counts every null/undefined result as skipped.
    const applyTransform = function ( row, dataRowIndex ) {
        if ( !transform ) {
            return row;
        }
        try {
            return transform( row );
        } catch ( err ) {
            reportCallbackError( dataRowIndex, err );
            return null;
        }
    };

    // Holds the file stream so the stop function can close it if the
    // read loop runs out of time. `finished` is a Promise that turns
    // ready as soon as the loop exits, success or error. Together they
    // give the stop function its time-budget behaviour, the same shape
    // sinks use per ADR-018.
    let activeStream = null;
    let resolveFinished;
    const finished = new Promise( ( resolve ) => {
        resolveFinished = resolve;
    } );

    const run = async function () {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- `path` comes from the caller-supplied CSV source config (`config.path`). This adapter does not validate path provenance; per composer's adapter contract the caller (flow runtime + its configuration source) owns that. Sufficient under zone=internal (SECURITY-MODEL.md §2); re-evaluate if CSV source is ever exposed to untrusted configuration.
        const fileStream = fs.createReadStream( path, { encoding: 'utf8' } );
        activeStream = fileStream;
        const rl = readline.createInterface( { input: fileStream, crlfDelay: Infinity } );

        let headers = null;
        let delimiter = ',';

        if ( onStatus ) onStatus( {
            status: 'green',
            connected: true,
            phase: 'starting',
            path
        } );

        try {
            for await ( const line of rl ) {
                if ( stopped ) break;
                if ( !line.trim() ) continue; // eslint-disable-line no-continue

                // First line is header
                if ( !headers ) {
                    delimiter = detectDelimiter( line );
                    headers = parseLine( line, delimiter ).values;
                    if ( onStatus ) onStatus( {
                        status: 'green',
                        connected: true,
                        phase: 'headers',
                        headers
                    } );
                    continue; // eslint-disable-line no-continue
                }

                // Parse the data row; a structurally malformed row is
                // skipped, classified, and the stream continues (ADR-018).
                // The skipped row still occupies its position — rowIndex
                // advances so positional range filtering stays stable.
                const parsed = parseLine( line, delimiter );
                const fault = structuralFault( parsed, headers );
                if ( fault ) {
                    skippedCount += 1;
                    reportDecodeError( rowIndex, fault );
                    rowIndex += 1;
                    continue; // eslint-disable-line no-continue
                }
                const row = buildRow( headers, parsed.values, dynamicTyping );

                // Determine range key and check filter
                const rangeKey = idField ? row[ idField ] : rowIndex;
                const rangeStatus = checkRange( rangeKey, inRange, startMsgId, endMsgId );
                inRange = rangeStatus.inRange;

                // Process only if in range
                if ( inRange ) {
                    const msg = applyTransform( row, rowIndex );

                    // Only null/undefined mean drop — any other return,
                    // however falsy, is delivered (transform contract,
                    // uniform with the MQTT source, 2026-07-11).
                    if ( msg !== null && msg !== undefined ) {
                        await onMessage( msg );
                        rowCount += 1;
                    } else {
                        skippedCount += 1;
                    }

                    if ( delayMs > 0 && !stopped ) {
                        await new Promise( ( resolve ) => setTimeout( resolve, delayMs ) );
                    }

                    if ( rangeStatus.shouldStop ) break;
                }

                rowIndex += 1;
            }
        } finally {
            activeStream = null;
        }

        // Completion travels onStatus with the uniform `count` field
        // (per ADR-018 there is no onComplete callback).
        if ( onStatus ) onStatus( {
            status: 'green',
            connected: false,
            phase: 'complete',
            count: rowCount,
            skipped: skippedCount
        } );

        // Auto-shutdown pipeline if requested
        if ( shutdownOnComplete && onShutdown ) {
            await onShutdown();
        }
    };

    // Start async processing. Failures inside the run loop are classified
    // and routed through onStatus per ADR-018; callers without an
    // onStatus handler still see the failure via a classified console.error
    // (fallback) so a misconfigured pipeline is never silently swallowed.
    // The `finished` Promise resolves once the run loop exits (success or
    // error) so `stopFn({ timeout })` can wait on it.
    run().catch( ( err ) => {
        const fsCode = err && err.code;
        const code = ( fsCode === 'ENOENT' || fsCode === 'EACCES' || fsCode === 'EISDIR' ) ?
            'SOURCE_UNREACHABLE' :
            'READ_ERROR';
        const message = ( err && err.message ) ? err.message : String( err );
        if ( onStatus ) {
            // Terminal red: the stream is dead. Uniform payload with
            // phase 'errored' per the ADR-018 two-tier rule.
            onStatus( {
                status: 'red',
                connected: false,
                phase: 'errored',
                error: { code, message }
            } );
        } else {
            console.error( `CSV source error [${code}]: ${message}` );
        }
    } ).finally( () => {
        resolveFinished();
    } );

    // Stop the source, with a time budget. Per ADR-018.
    //
    // What it does:
    //  - Asks the read loop to stop at the next row by setting `stopped`.
    //  - Waits for the loop to finish reading. If it finishes within
    //    `timeout` ms, the stop returns right away.
    //  - If the loop is stuck (for example, waiting forever inside
    //    `onMessage(msg)`), the time budget runs out. We then close
    //    the file and let the stop return anyway, so the rest of the
    //    shutdown can proceed.
    //  - When the budget runs out, we send a yellow status so callers
    //    know the stop was forced rather than clean.
    //
    // The timer is `unref()`ed so it does not keep Node alive while
    // the loop is finishing in time.
    //
    // Default time budget (5000 ms) matches what sinks use, so the
    // whole pipeline shutdown has consistent timing.
    return function ( { timeout = 5000 } = {} ) {
        stopped = true;
        return new Promise( ( resolve ) => {
            let settled = false;
            let forceTimer = null;
            const settle = function () {
                if ( settled ) return;
                settled = true;
                if ( forceTimer ) clearTimeout( forceTimer );
                resolve();
            };
            forceTimer = setTimeout( () => {
                if ( activeStream ) activeStream.destroy();
                if ( onStatus ) {
                    onStatus( {
                        status: 'yellow',
                        connected: false,
                        phase: 'stopped',
                        note: `Stop took longer than ${timeout}ms — forced.`
                    } );
                }
                settle();
            }, timeout );
            forceTimer.unref();
            finished.then( settle, settle );
        } );
    };
};


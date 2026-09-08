// core/storage-manager/questdb/persist-plan.js

/**
 * @fileoverview Build per-insightType persist plans from asset class definition.
 *
 * Pre-compiles column writers at startup for allocation-minimized hot path.
 * Each persist plan is a closure that writes a message to QuestDB via ILP.
 *
 * Integration with persist-if node:
 * - persist-if calls: state.storage.write(insightType, msg, partitionId)
 * - Persist plan signature: persistRow(sender, message, partitionId)
 *   (Note: partitionId is internal name, written as 'assetId' column)
 *
 * designatedTimestamp handling:
 * - Validated by semantics loader at startup
 * - Used here to call sender.at() which ends the ILP row
 * - Other timestamp columns use sender.timestampColumn()
 *
 * Two-phase rows — validate, then write (ADR-018: a rejected message
 * costs only itself):
 * - Phase 1 checks every column value against its declared type without touching
 *   the sender. Phase 2 opens the ILP row and writes only the values that passed;
 *   a failed value costs that column, with a warning naming the expected and
 *   received types — never a coercion.
 * - Why the order matters: a value the client rejects mid-row (a number handed to
 *   a string column) throws AFTER sender.table() and BEFORE sender.at(), leaving
 *   the sender wedged on a half-written row — every later write then fails. One
 *   wrong value silently killed 98.6% of a replay's writes in the 2026-06-10
 *   silent-write-failure incident. Checking every value before the row opens
 *   means the row is never started unless it will complete.
 *   For that to hold, phase 1's acceptance checks must match the writers' REAL
 *   domain — the client requires integers for int64/timestamp columns and for
 *   the designated timestamp, so a merely-finite check would let a fractional
 *   value through to a mid-row throw (found and fixed 2026-07-07). The
 *   recoverSender() backstop in index.js contains any residual mismatch to
 *   one row.
 * - Warnings fire in phase 1 too, before the row opens, so the documented
 *   strict mode (an `onWarning` that throws) rejects a bad row with the sender
 *   untouched.
 *
 * Row append rejections — the no-silent-failures contract:
 * - @questdb/nodejs-client v4 declares sender.at() as async. The append
 *   runs first and synchronously; the trailing `await this.tryFlush()`
 *   does nothing, because the adapter turns the client's own flush
 *   trigger off (ADR-029). So the promise rejects only when the append
 *   itself threw, which for a validated row means the client's byte
 *   ceiling (`max_buf_size`). The row never completed. Per composer's
 *   "no silent failures" contract, that loss MUST surface.
 *
 *   The rejection is routed through the `onDeliveryFailure` callback,
 *   with a context of the same shape as a flush report:
 *   `{ trigger: 'append', rowsLost: 1, abandoned: false, probe: null,
 *   tableName }`. The context is one object per insight type, shared
 *   by every rejection, so a handler must not keep it.
 *   When a caller provides one, they own the response (log, alert,
 *   stop the flow). When none is provided, one classified
 *   `DELIVERY_FAILED` console line reports it and the process keeps
 *   running: an unattended deployment must report a lost row, not
 *   stop on it. One handler exists per insight type and is attached
 *   to each row's promise. The derived promise that `.catch()` creates
 *   is the one per-row allocation this file cannot avoid while `at()`
 *   is async.
 *
 *   This separates two concerns:
 *     - `onWarning` — soft, per-row data quality (NaN in float column,
 *       null where a value was expected, invalid designated timestamp).
 *       These are routine ETL realities; default behaviour stays
 *       log-and-skip. One warning fires once per insightType instead
 *       of per row: a record field named 'assetId' that differs from
 *       the partition id. That mistake sits in the flow's
 *       configuration, not in the data, so every row would repeat it.
 *       The field is ignored either way; the column stores the
 *       partition id.
 *     - `onDeliveryFailure` — hard data loss: the row the client
 *       refused. Default behaviour: one DELIVERY_FAILED console line.
 *
 * `err.code` (setup-time throws per ADR-018 fail-fast setup):
 * - `INVALID_CONFIG` — buildPersistPlans called with non-function
 *   `onWarning` or non-function `onDeliveryFailure`; or a table/column name
 *   the client's own ILP rules reject (checked at plan build by driving each
 *   name through a throwaway client buffer — a name is not a value, so the
 *   per-message phase 1 below cannot catch it).
 *
 * Runtime console classification:
 * - `DELIVERY_FAILED` — sender.at() rejected and no `onDeliveryFailure`
 *   callback was provided. One `logger.error` line naming the table.
 *
 * @see docs/architecture/storage-layer.md
 * @see ADR-018
 */

import { SenderBufferV1 } from '@questdb/nodejs-client';

import { QUEST_WRITERS, writeAsString, createFloat64Writer } from './writers.js';
import { wrapCallback } from '../../utils/callback-guard/index.js';
import { logger } from '../../logger/index.js';

/**
 * Console channel for the callback guard: one classified line in this
 * adapter's family. Receives an already-safe detail string, never the
 * raw thrown value.
 */
const reportCallbackFault = function ( severity, name, detail ) {
    logger.error(
        `winkComposer/questdb: user callback ${name} failed [CALLBACK_FAILED]: ${detail}`
    );
}; // reportCallbackFault()

// ============================================================================
// DEFAULT WARNING HANDLER
// ============================================================================

/**
 * Default warning handler for invalid column values.
 * Logs to console in winkComposer format.
 *
 * Validation behavior:
 * - null/undefined columns: skip column only (QuestDB stores NULL)
 * - NaN/Infinity in numeric columns: skip column only (QuestDB stores NULL)
 * - Wrong-typed column values (e.g. a number where the column is string-typed):
 *   skip column only, never coerce — the warning names the expected and
 *   received types
 * - Invalid designatedTimestamp: skip entire row
 *
 * For strict mode (throw on any invalid), provide:
 *   { onWarning: (msg) => { throw new Error(msg); } }
 *
 * Future extension: return value may control skip-row vs skip-column behavior.
 *
 * @param {string} message - Warning message describing the issue
 */
const defaultOnWarning = function ( message ) {
    logger.warn( `winkComposer/questdb: ${message}` );
};

/**
 * Check if column type requires numeric validation (NaN/Infinity check).
 *
 * @param {string} type - Column type from semantics
 * @returns {boolean} true if type should be validated for finite values
 */
const isNumericType = ( type ) => type === 'float64' || type === 'int64' || type === 'timestamp';

/**
 * Per-type value checks, pre-resolved at plan build time — the same dispatch idea
 * as QUEST_WRITERS. Each check answers one question: may this value be handed to
 * the matching writer? A value that fails is skipped with a warning — never
 * coerced. Coercion would "work" and silently persist garbage (String( 0.79 )
 * into a text column); the warning is what tells the author their glue is wrong.
 *
 * A column type outside this map falls back to the write-as-string writer, which
 * accepts any value, so its check accepts any value too (acceptAny below).
 *
 * @type {Object.<string, function(*): boolean>}
 */
const ACCEPTS = Object.create( null );
ACCEPTS.float64 = ( value ) => Number.isFinite( value );
// The client's integer writers REQUIRE integers — probe-verified against
// 4.2.0: intColumn( 'c', 1.5 ) throws "Value must be an integer" and
// timestampColumn( 'c', 1.5, 'ms' ) throws "Timestamp value must be an
// integer or BigInt". A finite non-integer passing phase 1 would throw
// mid-row in phase 2 — the exact wedge this file exists to prevent.
// bigint is accepted: the int64/timestamp writers document
// `number|bigint` and convert before the client call.
ACCEPTS.int64 = ( value ) => Number.isInteger( value ) || typeof value === 'bigint';
ACCEPTS.timestamp = ACCEPTS.int64;
ACCEPTS.string = ( value ) => typeof value === 'string';
ACCEPTS.bool = ( value ) => typeof value === 'boolean';

/**
 * Acceptance check for column types without a dedicated writer: the
 * write-as-string fallback stringifies anything, so any value is writable.
 *
 * @returns {boolean} always true
 */
const acceptAny = () => true;

/**
 * Builds the reason text for a value that failed its phase-1 acceptance
 * check. Called only on the rare skip path, so its allocations are
 * acceptable (same budget as the error returns in index.js).
 *
 * @param {*} rawValue - the rejected value
 * @param {boolean} isNumeric - whether the column type is numeric
 * @param {string} expectedType - declared column type, named in the message
 * @returns {string} plain reason text for the skip warning
 */
const skipReason = function ( rawValue, isNumeric, expectedType ) {
    if ( rawValue === null ) return 'null';
    if ( rawValue === undefined ) return 'undefined';
    if ( isNumeric && typeof rawValue === 'number' ) {
        if ( Number.isNaN( rawValue ) ) return 'NaN';
        // A finite number can only be rejected by the integer-required
        // types (int64/timestamp/designated timestamp) — float64 accepts
        // every finite number.
        return Number.isFinite( rawValue ) ? 'non-integer' : 'non-finite';
    }
    return `wrong-typed (expected ${expectedType}, received ${typeof rawValue})`;
}; // skipReason()

/**
 * Asserts every ILP name a plan will write — the table name and each column
 * name — by driving them once through a throwaway client buffer, so the
 * client's OWN name rules do the checking. No mirrored rules that could
 * drift from the client; the validator is the client.
 *
 * Why here, at plan build: phase 1 validates VALUES per message, but a name
 * is not a value — a bad name would surface as a mid-row client throw at
 * write time, the very failure mode the two-phase split exists to prevent.
 * Names come from the asset class, which is fully known at startup, so a bad
 * one fails the deployment here with a classified INVALID_CONFIG instead of
 * failing the stream later.
 *
 * The scratch buffer is reset before each name, so nothing accumulates and
 * a long column list can never trip a buffer limit.
 *
 * @param {string} tableName - Fully built table name ({prefix}_{insightType})
 * @param {string[]} columnNames - Column names the plan will write
 * @throws {Error} classified `INVALID_CONFIG` naming the offending name
 */
const assertIlpNames = function ( tableName, columnNames ) {
    // Client defaults suffice: name validation depends only on the client's
    // default max name length (127), matching the sender the plans run on.
    const scratch = new SenderBufferV1( {} );
    let kind = 'table name';
    let current = tableName;
    try {
        scratch.table( tableName );
        kind = 'column name';
        for ( let i = 0; i < columnNames.length; i += 1 ) {
            current = columnNames[ i ];
            scratch.reset();
            scratch.table( 't' );
            scratch.symbol( current, 'x' );
        }
    } catch ( err ) {
        const wrapped = new Error(
            `winkComposer/questdb: invalid ILP ${kind} '${current}' — ${err.message}`
        );
        wrapped.code = 'INVALID_CONFIG';
        wrapped.cause = err;
        throw wrapped;
    }
}; // assertIlpNames()

// ============================================================================
// PERSIST PLAN BUILDER
// ============================================================================

/**
 * Build per-insightType persist plans from asset class definition.
 *
 * Each plan is a closure that works in two phases — validate, then write:
 * 1. Phase 1 validates the designatedTimestamp (skips the row if invalid) and
 *    checks every column value against its declared type. No sender calls.
 * 2. Phase 2 sets the table name `{tablePrefix}_{insightType}`, writes assetId
 *    as SYMBOL, writes each column that passed via its pre-resolved type writer
 *    (a failed column is skipped with a warning), and ends the row with
 *    sender.at().
 *
 * Validation behavior (fault-tolerant, never throws):
 * - Invalid designatedTimestamp (null/undefined/NaN/Infinity): warn + skip entire row
 * - null/undefined column: warn + skip column (QuestDB stores NULL)
 * - NaN/Infinity in numeric column: warn + skip column (QuestDB stores NULL).
 *   This is the designed end of composer's NaN propagation: an upstream node
 *   marks an invalid input by publishing NaN, and the persist plan lands it as
 *   a NULL column while the rest of the row survives.
 * - Wrong-typed value in any column: warn + skip column, never coerce
 *
 * For strict mode, provide onWarning that throws.
 *
 * @param {Object} assetClass - Asset class definition with columns and insightTypes
 * @param {string} tablePrefix - Prefix for table names (typically assetClass.name)
 * @param {Object} [options] - Optional configuration
 * @param {function} [options.onWarning] - Soft per-row warning callback for
 *   invalid values (NaN, null, invalid timestamp). Default: console.warn.
 * @param {function} [options.onDeliveryFailure] - Called as
 *   `( err, { tableName } )` when `sender.at()` rejects (the client's
 *   byte ceiling). Default: one classified DELIVERY_FAILED console line.
 * @returns {Object.<string, function>} Map of insightType to persistRow function
 */
const buildPersistPlans = function ( assetClass, tablePrefix, options ) {
    const providedOnWarning = options && options.onWarning;
    const providedOnDeliveryFailure = options && options.onDeliveryFailure;

    if ( providedOnWarning !== undefined && typeof providedOnWarning !== 'function' ) {
        // Per ADR-018, setup-time throws carry classified err.code.
        const err = new Error( 'winkComposer/questdb: onWarning must be a function' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }
    if ( providedOnDeliveryFailure !== undefined && typeof providedOnDeliveryFailure !== 'function' ) {
        const err = new Error( 'winkComposer/questdb: onDeliveryFailure must be a function' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }

    const onWarning = providedOnWarning || defaultOnWarning;
    // onWarning stays raw on purpose. A strict-mode onWarning throws,
    // and that throw is the instruction that rejects the row. ADR-027
    // keeps such callbacks — ones whose throw or return the adapter
    // acts on — out of the guard's scope. onDeliveryFailure only
    // notifies, so the shared guard arms it. It was validated raw
    // above and is wrapped once here (ADR-018: a broken handler costs
    // its own output, never the flush chain). Absent stays null, so
    // the no-handler DELIVERY_FAILED escape hatch below keeps its
    // exact meaning.
    const onDeliveryFailure = wrapCallback( providedOnDeliveryFailure || null, {
        name: 'onDeliveryFailure', severity: 'red', report: reportCallbackFault
    } );
    const plansByInsightType = Object.create( null );
    const insightTypes = assetClass.insightTypes || Object.create( null );
    const columns = assetClass.columns;

    const insightTypeNames = Object.keys( insightTypes );

    for ( let i = 0; i < insightTypeNames.length; i += 1 ) {
        const insightTypeName = insightTypeNames[ i ];
        const insightTypeSpec = insightTypes[ insightTypeName ];
        const persistedColumnNames = insightTypeSpec.columns;
        const designatedTimestamp = insightTypeSpec.designatedTimestamp;

        // The column name 'assetId' is reserved. Composer writes that
        // column itself, from the partition id. A persisted column with
        // the same name would make the CREATE TABLE ask for 'assetId'
        // twice. That happens whether the name appears in the columns
        // list or as the designated timestamp. Fail fast here and name
        // the fix; otherwise QuestDB answers at table creation with its
        // raw "Duplicate column" error. A dictionary column named
        // 'assetId' that no insightType persists stays legal.
        if ( persistedColumnNames.includes( 'assetId' ) || designatedTimestamp === 'assetId' ) {
            const err = new Error(
                `winkComposer/questdb: insightType '${insightTypeName}' uses reserved column name 'assetId' — ` +
                'composer writes this column automatically from the flow\'s .assetId() field (the partition id); ' +
                'rename the semantics column or remove it from this insightType'
            );
            err.code = 'INVALID_CONFIG';
            throw err;
        }

        // Pre-compile the writer steps. The designated timestamp is
        // handled separately, via sender.at(). Every other column uses
        // its type-specific writer.
        const stepNames = [];
        const stepWriters = [];
        const stepIsNumeric = [];
        const stepTypes = [];
        const stepAccepts = [];

        for ( let j = 0; j < persistedColumnNames.length; j += 1 ) {
            const columnName = persistedColumnNames[ j ];

            // Skip the designated timestamp. It is handled separately, via
            // sender.at().
            if ( columnName !== designatedTimestamp ) {
                const columnSpec = columns[ columnName ];
                const columnType = columnSpec ? columnSpec.type : 'string';

                stepNames.push( columnName );
                stepIsNumeric.push( isNumericType( columnType ) );
                stepTypes.push( columnType );
                stepAccepts.push( ACCEPTS[ columnType ] || acceptAny );

                // float64 columns use the resolution-aware writer factory.
                // columnSpec exists here: columnType is 'float64' only when
                // columnSpec.type is 'float64'.
                if ( columnType === 'float64' ) {
                    stepWriters.push( createFloat64Writer( columnSpec.resolution ) );
                } else {
                    stepWriters.push( QUEST_WRITERS[ columnType ] || writeAsString );
                }
            }
        }

        const stepCount = stepNames.length;
        const tableName = tablePrefix + '_' + insightTypeName;

        // One rejection handler and one shared context per insight
        // type, built here so the per-row path allocates nothing. See
        // the file header for the context's shape and what a rejection
        // means.
        const appendContext = {
            trigger: 'append',
            rowsLost: 1,
            abandoned: false,
            probe: null,
            tableName
        };
        const onAppendRejected = function ( err ) {
            if ( onDeliveryFailure ) {
                onDeliveryFailure( err, appendContext );
                return;
            }
            logger.error(
                `winkComposer/questdb: row append failed for table '${tableName}' [DELIVERY_FAILED]: ${err.message}`
            );
        }; // onAppendRejected()
        // Fail-fast at startup: a bad table or column name would otherwise
        // throw inside the client mid-row at write time.
        assertIlpNames( tableName, stepNames );
        // Scratch array reused on every row: phase 1 records which columns passed
        // validation, phase 2 reads it. Allocated once here, never per message.
        const stepValueOk = new Array( stepCount );

        // Once-flag for the assetId-mismatch warning below, allocated once
        // per insightType (never per row). The mismatch is a mistake in
        // the flow's configuration, so it would repeat on every row.
        // One report carries all the information.
        let assetIdMismatchWarned = false;

        // Create the closure that captures the pre-resolved references.
        // Interface: persistRow(sender, message, partitionId) -> boolean.
        // It returns true when a row was opened and completed on the
        // sender. It returns false when phase 1 skipped the whole row,
        // so the sender was never touched. The caller's buffered-row
        // accounting keys off this: a skipped row must not count as
        // buffered. Note: partitionId is the internal name; it is written
        // as the 'assetId' column in QuestDB.
        plansByInsightType[ insightTypeName ] = function ( sender, message, partitionId ) {
            // ---- Phase 1: validate. No sender calls — nothing irreversible
            // happens until every value has been checked (see file header).

            // The designated timestamp first. When it is invalid, skip the
            // entire row.
            const tsValue = message[ designatedTimestamp ];
            if ( tsValue === undefined || tsValue === null ) {
                onWarning(
                    `designatedTimestamp '${designatedTimestamp}' is ${tsValue === null ? 'null' : 'undefined'} ` +
                    `in insightType '${insightTypeName}' (asset: ${partitionId}) - row skipped`
                );
                return false;
            }
            // Integer or bigint, matching the client's own .at() validation.
            // Probe-verified: at( ...000.5, 'ms' ) throws "Designated
            // timestamp must be an integer or BigInt". It throws AFTER the
            // whole row is written, so catching it here is the only place
            // the row survives intact.
            if ( !Number.isInteger( tsValue ) && typeof tsValue !== 'bigint' ) {
                onWarning(
                    `designatedTimestamp '${designatedTimestamp}' is ${skipReason( tsValue, true, 'timestamp' )} ` +
                    `in insightType '${insightTypeName}' (asset: ${partitionId}) - row skipped`
                );
                return false;
            }

            // A record field named 'assetId' never sets the assetId column.
            // That column always stores the partition id. A record value
            // that differs is almost always one mistake: trying to relabel
            // identity in the record. It is reported once per insightType,
            // never silently dropped (ADR-018 no-silent-failures). The
            // flag advances only after onWarning returns. So under strict
            // mode, where onWarning throws, every mismatched row is
            // rejected here with the sender untouched.
            if ( !assetIdMismatchWarned && message.assetId !== undefined && message.assetId !== partitionId ) {
                onWarning(
                    `record field 'assetId' (${message.assetId}) ignored in insightType '${insightTypeName}' ` +
                    `(asset: ${partitionId}) — the assetId column always stores the partition id; to change ` +
                    'stored identity, change the flow\'s .assetId() field; reported once per insightType'
                );
                assetIdMismatchWarned = true;
            }

            // Check every column value against its declared type. A failed
            // check marks the column for a silent skip in phase 2, where
            // QuestDB stores NULL. That is the treatment null already gets.
            // The warning fires HERE, before the row opens. So an onWarning
            // that throws (documented strict mode) rejects the row with the
            // sender untouched instead of wedging it mid-row. Composer's
            // NaN propagation ends here exactly as before. A NaN in a
            // numeric column fails its acceptance check and lands as a
            // NULL column while the row survives.
            for ( let k = 0; k < stepCount; k += 1 ) {
                const rawValue = message[ stepNames[ k ] ];
                stepValueOk[ k ] = ( rawValue !== null ) && ( rawValue !== undefined ) && stepAccepts[ k ]( rawValue );
                if ( !stepValueOk[ k ] ) {
                    onWarning(
                        `column '${stepNames[ k ]}' is ${skipReason( rawValue, stepIsNumeric[ k ], stepTypes[ k ] )} ` +
                        `in insightType '${insightTypeName}' (asset: ${partitionId}) — column skipped`
                    );
                }
            }

            // ---- Phase 2: write. The row opens only after every value passed,
            // so it is never left half-written by a rejected value.
            sender.table( tableName );
            sender.symbol( 'assetId', partitionId );

            for ( let k = 0; k < stepCount; k += 1 ) {
                if ( stepValueOk[ k ] ) {
                    stepWriters[ k ]( sender, stepNames[ k ], message[ stepNames[ k ] ] );
                }
                // A skipped column (QuestDB stores NULL) was already warned
                // about in phase 1 — before the row opened.
            }

            // Designated timestamp (ends the row in ILP). sender.at() is
            // async; its promise rejects when the append itself threw
            // (see the file header). The prebuilt handler routes the
            // rejection; a mock at() that returns no promise is skipped.
            const atResult = sender.at( tsValue, 'ms' );
            if ( atResult && typeof atResult.catch === 'function' ) {
                atResult.catch( onAppendRejected );
            }

            return true;
        };
    }

    return plansByInsightType;
};

// ============================================================================
// EXPORTS
// ============================================================================

export { buildPersistPlans, defaultOnWarning };

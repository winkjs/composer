// core/source-manager/test-harness/comparator.js

/**
 * @fileoverview Check tool for testHarness.
 *
 * Takes the messages the harness generated (the ground truth) and
 * one capture per sink (terminal stdout, MQTT subscriber messages,
 * QuestDB rows) and checks each sink's output against the harness
 * input, matched on `_harnessId`.
 *
 * Why ground-truth-driven: the harness deterministically produced a
 * known sequence of messages. The "correct" output for any sink is
 * exactly that sequence. Comparing sinks to each other only catches
 * alignment drift; comparing each sink to the harness input also
 * catches a whole pipeline going wrong in the same way (a uniform
 * error every sink shares).
 *
 * Per-message rules:
 *  - Every checked sink must have the message (matched by _harnessId).
 *  - For each column declared in the asset class:
 *      - float64 with declared resolution: the sink's value must
 *        round to the same grid step as the harness input.
 *      - other numerics, strings, bools, timestamps: exact match.
 *  - Fuzz messages (those carrying `_harnessFuzzPattern`) skip the
 *    value check — fuzz inputs legitimately produce different sink
 *    outputs (NaN becomes "NaN" in terminal, null in MQTT JSON,
 *    dropped in QDB). The check is "every sink saw it" only.
 *
 * The report:
 *   {
 *       ok: boolean,
 *       errors: [ '<diagnostic line>', ... ],
 *       summary: {
 *           messageCount,
 *           sinkCounts: { terminal, mqtt, qdb }
 *       }
 *   }
 *
 * Error strings name the harnessId, the column, the harness input,
 * the sink's observed value, and the declared resolution when it
 * applies.
 */

const HARNESS_ID_FIELD = '_harnessId';
const FUZZ_MARKER_FIELD = '_harnessFuzzPattern';

/**
 * Walks captured terminal stdout and pulls out each message that
 * was printed in pretty-JSON form (the terminal emitter's
 * `verbose: true` output).
 *
 * Relies on a flat-message layout: each top-level `{` and matching
 * `}` sit at column 0; everything in between is indented. We
 * collect lines between those bookends and JSON.parse the result.
 *
 * @param {string} text - Captured stdout buffer
 * @returns {Object[]} Parsed messages in the order they appeared
 */
export const parseTerminalOutput = function ( text ) {
    const messages = [];
    let buffer = null;

    const lines = text.split( '\n' );
    for ( let i = 0; i < lines.length; i += 1 ) {
        const line = lines[ i ];
        if ( line === '{' ) {
            buffer = `${line}\n`;
        } else if ( line === '}' && buffer !== null ) {
            buffer += line;
            messages.push( JSON.parse( buffer ) );
            buffer = null;
        } else if ( buffer !== null ) {
            buffer += `${line}\n`;
        }
    }

    return messages;
};

/**
 * Returns an array indexed by message harness id. Each entry is the
 * parsed message; missing ids show up as `undefined`. The id field
 * is fixed (`_harnessId`) — the harness always adds it.
 *
 * @param {Object[]} messages - Parsed messages from one sink
 * @returns {Map<number, Object>}
 */
export const indexById = function ( messages ) {
    const map = new Map();
    for ( const msg of messages ) {
        const id = msg[ HARNESS_ID_FIELD ];
        if ( id !== undefined && id !== null ) {
            map.set( id, msg );
        }
    }
    return map;
};

/**
 * Tells whether a column should be compared with resolution-aware
 * tolerance. Only float64 columns with a declared resolution use
 * the grid-snap check; everything else uses exact equality.
 */
const usesResolutionTolerance = function ( columnSpec ) {
    return columnSpec && columnSpec.type === 'float64' && typeof columnSpec.resolution === 'number';
};

/**
 * For two float values that should sit on the same resolution grid,
 * tells whether they round to the same grid step. Equivalent to
 * "within half a resolution step of each other".
 */
const onSameGrid = function ( a, b, resolution ) {
    if ( typeof a !== 'number' || typeof b !== 'number' ) return false;
    if ( Number.isNaN( a ) || Number.isNaN( b ) ) return Number.isNaN( a ) === Number.isNaN( b );
    return Math.round( a / resolution ) === Math.round( b / resolution );
};

/**
 * Returns true when the sink's value matches the harness's value,
 * applying resolution tolerance for float64 columns that declare it.
 */
const valuesAgree = function ( harnessValue, sinkValue, columnSpec ) {
    if ( usesResolutionTolerance( columnSpec ) ) {
        return onSameGrid( harnessValue, sinkValue, columnSpec.resolution );
    }
    if ( Number.isNaN( harnessValue ) || Number.isNaN( sinkValue ) ) {
        return Number.isNaN( harnessValue ) === Number.isNaN( sinkValue );
    }
    return harnessValue === sinkValue;
};

/**
 * Builds a diagnostic line for one column where a sink's value
 * disagrees with the harness input.
 */
const formatColumnError = function ( harnessId, sinkName, columnName, columnSpec, harnessValue, sinkValue ) {
    const head = `harnessId=${harnessId}, column '${columnName}' — harness sent ${JSON.stringify( harnessValue )}, ${sinkName} saw ${JSON.stringify( sinkValue )}`;
    if ( usesResolutionTolerance( columnSpec ) ) {
        return `${head}, declared resolution: ${columnSpec.resolution} — beyond resolution`;
    }
    return `${head} — values differ`;
};

/**
 * Compares one sink's captured messages against the harness inputs,
 * column by column. Returns the error strings for this sink.
 */
const checkSinkAgainstInputs = function ( sinkName, sinkIndex, harnessIndex, columnNames, columns ) {
    const errors = [];
    for ( const [ harnessId, harnessMsg ] of harnessIndex.entries() ) {
        const sinkMsg = sinkIndex.get( harnessId );
        if ( !sinkMsg ) {
            errors.push( `harnessId=${harnessId} missing from ${sinkName}` );
            continue; // eslint-disable-line no-continue
        }
        // Fuzz messages skip the column-by-column check — presence
        // alone is the fuzz assertion.
        if ( harnessMsg[ FUZZ_MARKER_FIELD ] !== undefined ) {
            continue; // eslint-disable-line no-continue
        }
        for ( const columnName of columnNames ) {
            if ( columnName === HARNESS_ID_FIELD ) continue; // eslint-disable-line no-continue
            const harnessValue = harnessMsg[ columnName ];
            const sinkValue = sinkMsg[ columnName ];
            if ( !valuesAgree( harnessValue, sinkValue, columns[ columnName ] ) ) {
                errors.push( formatColumnError( harnessId, sinkName, columnName, columns[ columnName ], harnessValue, sinkValue ) );
            }
        }
    }
    return errors;
};

/**
 * Checks each captured sink against the harness inputs (the ground
 * truth). Skips per-column value checks for fuzz messages — those
 * legitimately produce different sink outputs.
 *
 * @param {Object[]} harnessInputs       - Messages the harness produced (ground truth)
 * @param {Object} captures
 * @param {string}   [captures.terminal] - Raw stdout buffer
 * @param {Object[]} [captures.mqtt]     - Messages received over MQTT
 * @param {Object[]} [captures.qdb]      - Rows queried from QuestDB
 * @param {Object} assetClass            - Declares column types and resolutions
 * @returns {{ok: boolean, errors: string[], summary: Object}}
 */
export const compareCaptures = function ( harnessInputs, captures, assetClass ) {
    const harnessIndex = indexById( harnessInputs || [] );

    const sinkIndices = {};
    const sinkCounts = {};

    if ( captures.terminal !== undefined ) {
        const parsed = parseTerminalOutput( captures.terminal );
        sinkIndices.terminal = indexById( parsed );
        sinkCounts.terminal = parsed.length;
    }
    if ( captures.mqtt !== undefined ) {
        sinkIndices.mqtt = indexById( captures.mqtt );
        sinkCounts.mqtt = captures.mqtt.length;
    }
    if ( captures.qdb !== undefined ) {
        sinkIndices.qdb = indexById( captures.qdb );
        sinkCounts.qdb = captures.qdb.length;
    }

    const columnNames = ( assetClass && assetClass.columns ) ? Object.keys( assetClass.columns ) : [];
    const columns = ( assetClass && assetClass.columns ) ? assetClass.columns : {};

    const errors = [];
    for ( const sinkName of Object.keys( sinkIndices ) ) {
        const sinkErrors = checkSinkAgainstInputs(
            sinkName, sinkIndices[ sinkName ], harnessIndex, columnNames, columns
        );
        errors.push( ...sinkErrors );
    }

    return {
        ok: errors.length === 0,
        errors,
        summary: {
            messageCount: harnessIndex.size,
            sinkCounts
        }
    };
};

// core/storage-manager/questdb/writers.js

/**
 * @fileoverview QuestDB column writers mapped to semantics COLUMN_TYPES.
 *
 * Each writer is a function that calls the appropriate QuestDB Sender method
 * for the given column type. These are pre-resolved at startup and stored
 * in persist plans for allocation-minimized hot path execution.
 *
 * Timestamp handling:
 * - rowTimestamp (designated): handled via sender.at() which ends the row
 * - Additional timestamps: use QUEST_WRITERS.timestamp via sender.timestampColumn()
 *
 * Resolution-aware float64 quantization is delegated to the shared
 * `core/utils/quantize` helper so QDB and the terminal emitter (and any
 * future adapter that honours declared resolution) compute identical
 * rounded values for the same input. Cross-sink alignment by construction.
 *
 * @see https://questdb.com/docs/clients/ingest-node/
 * @see ../../utils/quantize/index.js (shared quantizer used by createFloat64Writer)
 */

import { buildResolutionQuantizer } from '../../utils/quantize/index.js';

// ============================================================================
// TYPE WRITERS
// ============================================================================

/**
 * Type-specific column writers for QuestDB ILP.
 * Keys match semantics COLUMN_TYPES from column-schema.js.
 *
 * @type {Object.<string, function(Object, string, *): void>}
 */
const QUEST_WRITERS = Object.create( null );

/**
 * Write float64 value.
 *
 * @param {Object} sender - QuestDB Sender instance
 * @param {string} columnName - Column name
 * @param {number} value - Float value
 */
QUEST_WRITERS.float64 = function ( sender, columnName, value ) {
    sender.floatColumn( columnName, value );
};

/**
 * Factory to create a resolution-aware float64 writer.
 *
 * Wraps the shared `buildResolutionQuantizer` (in `core/utils/quantize`)
 * with QDB's sender-calling glue. The shared quantizer pre-computes the
 * inverse resolution and decimal-place count once at factory time, so
 * the per-message hot path is one quantize call + one `sender.floatColumn`
 * call — no allocations, no recomputation.
 *
 * When the shared helper returns `null` (resolution undefined or 1),
 * we route to the default `QUEST_WRITERS.float64` passthrough writer
 * so callers do not pay the wrapper cost for the common case of "no
 * quantization needed".
 *
 * @param {number} resolution - Resolution from semantics (e.g., 0.1, 0.01)
 * @returns {function(Object, string, number): void} Writer function
 */
const createFloat64Writer = function ( resolution ) {
    const quantize = buildResolutionQuantizer( resolution );
    if ( !quantize ) return QUEST_WRITERS.float64;

    return function ( sender, columnName, value ) {
        sender.floatColumn( columnName, quantize( value ) );
    };
};

/**
 * Write int64 value.
 *
 * WARNING: JavaScript numbers lose precision above Number.MAX_SAFE_INTEGER (2^53 - 1).
 * BigInt is converted to Number here, which may cause precision loss for very large values.
 *
 * @param {Object} sender - QuestDB Sender instance
 * @param {string} columnName - Column name
 * @param {number|bigint} value - Integer value
 */
QUEST_WRITERS.int64 = function ( sender, columnName, value ) {
    sender.intColumn( columnName, typeof value === 'bigint' ? Number( value ) : value );
};

/**
 * Write boolean value.
 *
 * @param {Object} sender - QuestDB Sender instance
 * @param {string} columnName - Column name
 * @param {boolean} value - Boolean value
 */
QUEST_WRITERS.bool = function ( sender, columnName, value ) {
    sender.booleanColumn( columnName, value );
};

/**
 * Write string value.
 *
 * @param {Object} sender - QuestDB Sender instance
 * @param {string} columnName - Column name
 * @param {string} value - String value
 */
QUEST_WRITERS.string = function ( sender, columnName, value ) {
    sender.stringColumn( columnName, value );
};

/**
 * Write timestamp value (for additional timestamp columns, NOT rowTimestamp).
 * The designated rowTimestamp is handled via sender.at() which ends the row.
 *
 * @param {Object} sender - QuestDB Sender instance
 * @param {string} columnName - Column name
 * @param {number} value - Timestamp in milliseconds since epoch
 */
QUEST_WRITERS.timestamp = function ( sender, columnName, value ) {
    sender.timestampColumn( columnName, value, 'ms' );
};

// ============================================================================
// FALLBACK WRITER
// ============================================================================

/**
 * Fallback writer that converts value to string.
 * Used for unknown column types or when explicit string conversion is needed.
 *
 * @param {Object} sender - QuestDB Sender instance
 * @param {string} columnName - Column name
 * @param {*} value - Any value (converted to string)
 */
const writeAsString = function ( sender, columnName, value ) {
    sender.stringColumn( columnName, String( value ) );
};

// ============================================================================
// EXPORTS
// ============================================================================

export { QUEST_WRITERS, writeAsString, createFloat64Writer };

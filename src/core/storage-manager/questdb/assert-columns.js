// core/storage-manager/questdb/assert-columns.js

/**
 * @fileoverview Walks every column in an asset class and checks that the
 * column-internal facts QuestDB actually reads are well-formed. Throws
 * with `err.code = 'INVALID_CONFIG'` on the first problem found, naming
 * the offending column and field in the message.
 *
 * Why this file exists separately from the universal semantics schema:
 *
 * The semantics schema (in `core/semantics/schemas/`) validates what a
 * well-formed asset class looks like in the abstract. It says "every
 * column needs a `type`" because that is true for any consumer; it does
 * NOT say "if `type === 'float64'` then `resolution` must be positive"
 * because that is QuestDB-specific knowledge — other adapters may not
 * care about resolution at all. Adapter-specific contracts belong in
 * the adapter, not in the universal schema.
 *
 * Per ADR-018's column-internal facts pattern: each adapter that
 * consumes column-internal facts MUST validate them defensively at
 * startup AND document those assertions in its `@fileoverview`. This
 * file is QuestDB's enforcement point; the documentation lives in the
 * `Column-internal facts consumed` section of `index.js`'s top-of-file
 * comment block.
 *
 * What this layer catches that the universal semantics schema does not:
 *
 * - **Type drift.** The universal schema accepts any type the semantics
 *   layer knows about. QuestDB knows how to write a fixed set (the keys
 *   of `DDL_TYPES` — float64, int64, bool, string, timestamp). If a new
 *   type joins semantics tomorrow but QuestDB's writers haven't caught
 *   up, the silent fallback (in `ensure-tables.js` and `persist-plan.js`)
 *   would coerce values to VARCHAR. This check makes the gap loud.
 * - **Bypassed schema validation.** Any path that builds an asset class
 *   without going through `loadSemantics()` AND without going through
 *   `flow.assetClass()` (e.g., a test calling `createStorage` directly)
 *   skips the schema. This file is the last line of defense.
 * - **Resolution sanity for float64.** Resolution is optional in the
 *   schema (defaults to 1, treated as passthrough by `writers.js:54`).
 *   But if the caller declares `resolution: 0` or `resolution: -0.1`,
 *   the writer would compute `invResolution = 1 / resolution` as
 *   Infinity / negative — silently corrupting every persisted value.
 *   The schema does not enforce positivity (since absent resolution is
 *   valid); this layer does, when present.
 *
 * Family: same shape as `core/wiring/assert-handle.js`. Both are pure
 * functions that throw diagnostically at startup when an adapter
 * contract is violated.
 *
 * `err.code` thrown:
 * - `INVALID_CONFIG` — column-internal fact missing or malformed.
 *   Per ADR-018, setup-time throws carry a classified `err.code`.
 *
 * @see ADR-018 (capability declaration)
 * @see ./writers.js (resolution handling at write time)
 */

import { DDL_TYPES } from './ensure-tables.js';

/**
 * Walk every column in `assetClass.columns` and assert the facts QuestDB
 * reads are well-formed. Throws on the first violation.
 *
 * Behaviour:
 * - Each column's `type` must be set and writable by QuestDB
 *   (i.e., a key in `DDL_TYPES`).
 * - For columns where `type === 'float64'` and `resolution` is defined,
 *   `resolution` must be a positive finite number. (Absent resolution
 *   is fine — the writer treats undefined as passthrough.)
 *
 * @param {Object} assetClass - asset class with `columns` map
 * @throws {Error} `err.code === 'INVALID_CONFIG'` on any column-internal
 *   fact violation; message names the column and the offending field
 */
const assertColumnFacts = function ( assetClass ) {
    const columns = assetClass.columns || Object.create( null );
    const colNames = Object.keys( columns );

    for ( let i = 0; i < colNames.length; i += 1 ) {
        const colName = colNames[ i ];
        const colSpec = columns[ colName ];

        // Column type must be set and writable by QuestDB. Closes the
        // silent fallback to VARCHAR / writeAsString for any missing or
        // unsupported type. The `colSpec` truthy check also catches a
        // null / undefined column entry — caller bug, but we surface it
        // clearly rather than crashing on `.type` access.
        if ( !colSpec || !( colSpec.type in DDL_TYPES ) ) {
            const supportedTypes = Object.keys( DDL_TYPES ).join( ', ' );
            const actualType = colSpec ? String( colSpec.type ) : 'undefined';
            const err = new Error(
                `WinkComposer/questdb: column '${colName}' has invalid or missing type '${actualType}'; ` +
                `expected one of: ${supportedTypes}`
            );
            err.code = 'INVALID_CONFIG';
            throw err;
        }

        // Float64 columns may declare a resolution for quantization. When
        // present, must be a positive finite number — invResolution at
        // 0 / negative / non-finite would silently corrupt every value.
        // Absent resolution is fine: writers.js:54 treats undefined and
        // 1 as passthrough (no quantization).
        if ( colSpec.type === 'float64' && colSpec.resolution !== undefined ) {
            if ( typeof colSpec.resolution !== 'number' ||
                !Number.isFinite( colSpec.resolution ) ||
                colSpec.resolution <= 0 ) {
                const err = new Error(
                    `WinkComposer/questdb: column '${colName}' has type 'float64' ` +
                    `but resolution is '${colSpec.resolution}'; ` +
                    'expected positive finite number (or omit for passthrough)'
                );
                err.code = 'INVALID_CONFIG';
                throw err;
            }
        }
    }
};

export { assertColumnFacts };

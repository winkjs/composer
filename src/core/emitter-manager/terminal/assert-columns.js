// core/emitter-manager/terminal/assert-columns.js

/**
 * @fileoverview Walks the column map terminal received from the wiring
 * layer and checks that the column-internal facts terminal actually
 * reads are well-formed. Throws with `err.code = 'INVALID_CONFIG'` on
 * the first problem found, naming the offending column and field.
 *
 * Why this file exists separately from the universal semantics schema:
 *
 * Same reasoning as QuestDB's `storage-manager/questdb/assert-columns.js`.
 * The semantics schema validates universal correctness ("every column
 * needs a `type`"); adapter-specific contracts ("if `type` is float64
 * AND a `resolution` is declared, it must be a positive finite number")
 * live with the adapter that consumes the fact. Terminal only consumes
 * `resolution` (for per-column formatting), so this file's check is
 * narrower than QDB's: just resolution validity, no type whitelist.
 *
 * Terminal handles every column type at runtime — string, boolean,
 * number, integer, etc. all flow through `formatValue`. So unlike
 * QDB, terminal does not require columns to declare a `type` field at
 * all. Resolution is the one fact terminal reads from columns.
 *
 * Per ADR-018's adapter–semantics alignment: each adapter that
 * consumes column-internal facts MUST validate them defensively at
 * startup AND document those assertions in its `@fileoverview`. This
 * file is terminal's enforcement point; the documentation lives in the
 * `Column-internal facts consumed` section of `index.js`.
 *
 * `err.code` thrown:
 * - `INVALID_CONFIG` — column-internal fact malformed.
 *   Per ADR-018, setup-time throws carry a
 *   classified `err.code`.
 *
 * @see ADR-018 (adapter–semantics alignment)
 * @see ../../storage-manager/questdb/assert-columns.js (sister file for QDB)
 */

/**
 * Walk every column in `columns` and assert the resolution facts
 * terminal reads are well-formed. Throws on the first violation.
 *
 * Behaviour:
 * - Columns without a `resolution` field are fine (terminal falls back
 *   to its global `precision` config).
 * - When `resolution` is present AND the column's `type === 'float64'`,
 *   resolution must be a positive finite number. Other resolution
 *   values would silently produce garbage formatting (`Math.log10` of
 *   zero is -Infinity, of a negative is NaN, etc.).
 * - When `resolution` is present but `type !== 'float64'` (or `type`
 *   is missing), resolution is ignored — terminal only quantizes
 *   float64. We do not throw because semantically the field is dead
 *   weight, not corrupting; the column is still usable for display.
 *
 * @param {Object} columns - the columns map from the asset class slice
 * @throws {Error} `err.code === 'INVALID_CONFIG'` on any column-internal
 *   fact violation; message names the column and the offending field
 */
const assertColumnFacts = function ( columns ) {
    if ( !columns || typeof columns !== 'object' ) {
        return;
    }

    const colNames = Object.keys( columns );

    for ( let i = 0; i < colNames.length; i += 1 ) {
        const colName = colNames[ i ];
        const colSpec = columns[ colName ];

        // Defensive: a null or non-object column entry is a caller bug;
        // skip rather than crash on a `.type` access. The semantics
        // schema would have rejected this earlier in any well-formed
        // pipeline; this is the last-line-of-defense path for direct
        // createEmitter calls (e.g., test code).
        if ( !colSpec || typeof colSpec !== 'object' ) {
            continue; // eslint-disable-line no-continue
        }

        // Resolution check fires only when present AND the column is
        // float64. Other types: resolution is ignored as dead weight,
        // not a hard error — the column is still usable for display.
        if ( colSpec.type === 'float64' && colSpec.resolution !== undefined ) {
            if ( typeof colSpec.resolution !== 'number' ||
                !Number.isFinite( colSpec.resolution ) ||
                colSpec.resolution <= 0 ) {
                const err = new Error(
                    `winkComposer/terminal: column '${colName}' has type 'float64' ` +
                    `but resolution is '${colSpec.resolution}'; ` +
                    'expected positive finite number (or omit the field to use the global precision)'
                );
                err.code = 'INVALID_CONFIG';
                throw err;
            }
        }
    }
};

export { assertColumnFacts };

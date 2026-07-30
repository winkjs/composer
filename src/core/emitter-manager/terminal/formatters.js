// core/emitter-manager/terminal/formatters.js

/**
 * @fileoverview Per-column value formatters for the terminal emitter.
 *
 * Same role for terminal as `questdb/writers.js` plays for QDB: takes
 * an asset-class column slice at startup and returns a value-formatter
 * closure pre-resolved to the per-column quantization. Hot path is a
 * lookup + a quantizer call, no per-message allocation.
 *
 * Quantization is delegated to the shared `core/utils/quantize` helper
 * — the same one QDB's `writers.js` consumes. Both sinks compute
 * identical rounded values for the same input; cross-sink alignment is
 * structural, not coincidental.
 *
 * What this file does NOT do: validate the column slice. Validation
 * lives in `assert-columns.js` and runs once at startup before the
 * formatter is built. By the time these helpers see the columns map,
 * every `resolution` is known to be a positive finite number (or
 * absent, in which case the column falls through to global precision).
 *
 * @see ./assert-columns.js (defensive validation that runs first)
 * @see ../../utils/quantize/index.js (shared quantizer used here and by QDB)
 * @see ../../storage-manager/questdb/writers.js (sister consumer)
 */

import { buildResolutionQuantizer } from '../../utils/quantize/index.js';

/**
 * Build a column-name → quantizer-closure map at startup from the asset
 * class column slice. Only float64 columns with a defined positive
 * resolution contribute; everything else falls through to the global
 * precision at format time.
 *
 * Each quantizer applies the same formula QDB's `createFloat64Writer`
 * uses, so a value declared with `resolution: R` produces the same
 * rounded number in both sinks:
 *
 *     quantized = Math.round( value * invResolution ) * resolution
 *     clean     = +quantized.toFixed( decimalPlaces )
 *
 * `Math.round(v / r) * r` snaps the value to the nearest multiple of
 * `r` (the resolution grid). Then `toFixed( decimalPlaces )` cleans up
 * floating-point noise like `10.100000000001` → `10.1`. The closure
 * pre-resolves `invResolution` and `decimalPlaces` at startup so the
 * per-message hot path is one multiply, one round, one multiply, one
 * `toFixed` — no allocations, no recomputation.
 *
 * The per-column quantizer takes precedence over the integer-passthrough
 * check in the formatter — when a column declares `resolution: 5`, an
 * input value of `1234` gets quantized to `1235` (the nearest multiple
 * of 5), regardless of the value's `Number.isInteger` shape. This
 * matches QDB's behaviour: the asset class declared the resolution,
 * the data MUST be aligned to it, integer-shaped or not.
 *
 * Decimal places follow the same rule as QDB writers:
 * - `resolution = 0.1`   → 1 decimal place
 * - `resolution = 0.01`  → 2 decimal places
 * - `resolution = 0.001` → 3 decimal places
 * - `resolution = 5`     → 0 decimal places (whole-number resolution)
 * - `resolution = 1`     → 0 decimal places (effectively passthrough)
 *
 * Returns `Object.create(null)` so per-column lookups never accidentally
 * hit `Object.prototype` keys (e.g., a column literally named
 * `'toString'` or `'hasOwnProperty'`). The keys are runtime-supplied
 * column names — exactly the case the rule says use a prototype-less
 * dictionary for.
 *
 * @param {Object} columns - the columns map from the asset class slice
 *   (typically `config.assetClass.columns` post wire-semantics injection)
 * @returns {Object} prototype-less map of column name → `(v) → number`
 */
const buildColumnQuantizers = function ( columns ) {
    const map = Object.create( null );

    if ( !columns || typeof columns !== 'object' ) {
        return map;
    }

    const colNames = Object.keys( columns );
    for ( let i = 0; i < colNames.length; i += 1 ) {
        const colName = colNames[ i ];
        const colSpec = columns[ colName ];
        if ( colSpec && colSpec.type === 'float64' ) {
            // Delegate to the shared quantizer. Returns null when the
            // column does not need quantization (no resolution declared
            // or resolution = 1); we simply skip those columns and
            // they fall back to the global precision at format time.
            const quantize = buildResolutionQuantizer( colSpec.resolution );
            if ( quantize ) {
                map[ colName ] = quantize;
            }
        }
    }

    return map;
};

/**
 * Build a value formatter closure that uses each column's quantizer
 * (when one was registered for the column name) and the global
 * `precision` config otherwise. Receives `(key, v)` so it can look up
 * the column-specific quantizer by name.
 *
 * Branch order in the returned formatter:
 * 1. null → `'null'`
 * 2. boolean → as-is
 * 3. string → as-is
 * 4. non-number (object, undefined, etc.) → `String( v )`
 * 5. **per-column quantizer** if the column registered one (this fires
 *    even for integer values, because the column declared a resolution
 *    and the data MUST be on the resolution grid)
 * 6. integer → as-is (only reached when no per-column quantizer
 *    applies; preserves the original behaviour for non-resolution columns)
 * 7. very small non-zero (`|v| < 0.001`) → exponential notation
 *    using the **global** precision (intentionally; see note below)
 * 8. normal decimal → `+v.toFixed( precision )` (global fallback)
 *
 * **Why the exponential branch keeps using global precision.** Resolution
 * describes the meaningful step size on the absolute scale. For values
 * below that step — say `resolution: 0.1` and `v = 0.0003` — the
 * "correctly rounded" value is `0`, but printing `0` for a non-zero
 * value loses diagnostic information. Terminal is a debugging tool;
 * the exponential form (`3e-4`) is more useful to a human eye than
 * `0`. This is an intentional carve-out, not a bug. Note that this
 * branch only fires for columns WITHOUT a per-column quantizer; columns
 * with one always go through the quantizer path (step 5).
 *
 * @param {number} precision - Default decimal places when no per-column
 *   quantizer is registered
 * @param {Object} columnQuantizers - Map produced by
 *   `buildColumnQuantizers`. Pass an empty `Object.create(null)` if no
 *   asset class was supplied — the formatter then falls back to global
 *   precision for every column.
 * @returns {function(string, *): *} Formatter function `(key, v) → out`
 */
const createValueFormatter = function ( precision, columnQuantizers ) {
    return function ( key, v ) {
        if ( v === null ) return 'null';
        if ( typeof v === 'boolean' ) return v;
        if ( typeof v === 'string' ) return v;
        if ( typeof v !== 'number' ) return String( v );

        // Per-column quantizer takes precedence over every other rule:
        // the column declared a resolution, the value MUST snap to the
        // grid (matching what QDB will store). This is the cross-sink
        // alignment guarantee. Fires for integers too — e.g.,
        // resolution=5 with value=1234 quantizes to 1235.
        const quantizer = columnQuantizers[ key ];
        if ( quantizer ) return quantizer( v );

        // No per-column quantizer beyond this point — the original
        // behaviour for non-resolution columns is preserved exactly.
        if ( Number.isInteger( v ) ) return v;
        if ( v !== 0 && Math.abs( v ) < 0.001 ) return v.toExponential( precision );
        return Number( v.toFixed( precision ) );
    };
};

export { buildColumnQuantizers, createValueFormatter };

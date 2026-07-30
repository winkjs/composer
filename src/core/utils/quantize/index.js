// core/utils/quantize/index.js

/**
 * @fileoverview Snap a value to the nearest multiple of a declared
 * resolution.
 *
 * Adapter authors honouring a column's `resolution` (declared in the
 * semantics layer) need to round values to that resolution's grid before
 * storing or displaying them. QuestDB does this when it writes float64
 * columns; the terminal emitter does it when it formats float64 values
 * for human reading. Both used to carry their own copy of the same
 * formula; this module is the single source.
 *
 * The quantizer pre-computes the inverse resolution and the appropriate
 * decimal-place count at build time, so the per-message hot path is one
 * multiply, one round, one multiply, one `toFixed` — no allocation, no
 * recomputation.
 *
 * Decimal places follow the natural rule:
 * - `resolution = 0.001` → 3 decimal places
 * - `resolution = 0.01`  → 2 decimal places
 * - `resolution = 0.1`   → 1 decimal place
 * - `resolution = 1`     → 0 (returns `null`, signalling passthrough)
 * - `resolution = 5`     → 0 (whole-number resolution; values still
 *                          snap to multiples of 5, but no decimals to
 *                          format)
 *
 * The `toFixed` step cleans up floating-point noise — for example,
 * `Math.round( 10.1 * 10 ) * 0.1` produces `10.100000000001` because
 * of IEEE-754 rounding, and `toFixed(1)` returns the tidy `"10.1"`
 * which `Number(...)` parses back to `10.1`.
 *
 * Returning `null` for `resolution === 1` (or undefined) is a small but
 * load-bearing optimisation: the common case is "no resolution declared"
 * (or `resolution: 1`, which is the schema's default), and callers can
 * skip a wrapping closure entirely. QDB's `writers.js` uses this to
 * route to its `QUEST_WRITERS.float64` passthrough writer; terminal's
 * `formatters.js` uses it to skip per-column quantizer registration.
 */

/**
 * Build a quantizer closure that snaps a value to the nearest multiple
 * of `resolution`. Returns `null` when the resolution does not need
 * quantization (undefined, or 1) — callers handle the null by treating
 * the value as passthrough.
 *
 * Sample usage:
 *
 *     const quantize = buildResolutionQuantizer( 0.1 );
 *     if ( quantize ) {
 *         const clean = quantize( 23.456 );  // → 23.5
 *     }
 *
 * @param {number|undefined} resolution - The declared resolution from
 *   the column's semantics. Must be a positive finite number for
 *   meaningful quantization; the caller is responsible for asserting
 *   that (we trust the input here).
 * @returns {function(number): number|null} A quantizer function, or
 *   `null` when no quantization is needed.
 */
const buildResolutionQuantizer = function ( resolution ) {
    if ( resolution === undefined || resolution === 1 ) return null;

    const invResolution = 1 / resolution;
    const decimalPlaces = resolution < 1 ?
        Math.ceil( -Math.log10( resolution ) ) :
        0;

    return function ( v ) {
        const quantized = Math.round( v * invResolution ) * resolution;
        return Number( quantized.toFixed( decimalPlaces ) );
    };
};

export { buildResolutionQuantizer };

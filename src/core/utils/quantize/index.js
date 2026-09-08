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
 * The quantizer chooses its arithmetic once, at build time, so the
 * per-message hot path is a few float operations and no allocation.
 * Three shapes of resolution get three paths:
 *
 * - The inverse is a whole number (0.1, 0.01, 0.001, 0.25, 0.5, 0.2,
 *   0.125). The value is `Math.round( v * inverse ) / inverse`. A
 *   division by an exact whole number is correctly rounded, so it
 *   returns the nearest double to the grid value: 101 / 10 is 10.1
 *   and 95 / 4 is 23.75. No string is built.
 * - The resolution is a whole number (5, 10, 7). The value is
 *   `Math.round( v / resolution ) * resolution`, exact for whole
 *   numbers. No string is built.
 * - Anything else (0.3, 0.15, 2.5). The old path stays: multiply,
 *   round, multiply, then `toFixed` to trim the noise and `Number` to
 *   parse it back. The trim keeps as many decimals as the resolution
 *   itself has. This path allocates one short string per value. It is
 *   rare: a declared resolution is nearly always a power of ten.
 *
 * Why not `toFixed` for everything. `Math.round( 10.1 * 10 ) * 0.1` is
 * `10.100000000000001`, because 0.1 is not exact in binary, so a
 * multiply by the resolution needs a trim. The trim built a string per
 * value on the storage hot path. It also cut grid values short: with a
 * resolution of 0.25 the trim kept one decimal, so 23.75 became 23.8,
 * off the grid. Division by the exact inverse has neither problem.
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

    if ( Number.isInteger( invResolution ) ) {
        return function ( v ) {
            return Math.round( v * invResolution ) / invResolution;
        };
    }

    if ( Number.isInteger( resolution ) ) {
        return function ( v ) {
            return Math.round( v / resolution ) * resolution;
        };
    }

    // The string path trims the noise to the decimals the grid needs.
    // The count comes from the resolution's own digits, so 0.15 gets
    // two and 2.5 gets one. A resolution below one millionth prints in
    // exponent form, so it takes the count from its magnitude instead.
    const text = String( resolution );
    const decimalPlaces = ( text.indexOf( 'e' ) === -1 ) ?
        ( text.length - text.indexOf( '.' ) - 1 ) :
        Math.ceil( -Math.log10( resolution ) );

    return function ( v ) {
        const quantized = Math.round( v * invResolution ) * resolution;
        return Number( quantized.toFixed( decimalPlaces ) );
    };
};

export { buildResolutionQuantizer };

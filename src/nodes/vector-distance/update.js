// nodes/vector-distance/update.js

/* eslint-disable no-bitwise */

/**
 * vector-distance / update.js
 *
 * Purpose
 * Compute distances between two vectors in a single pass:
 * - Maximum single element difference
 *      - For correlations [-1,1]: bounded [0,2]
 *      - For general vectors: bounded [0, ∞]
 * - RMS distance between vectors
 *      - For correlations [-1,1]: bounded [0,2]
 *      - For general vectors: bounded [0, ∞]
 * - MAD distance between vectors
 *      - For correlations [-1,1]: bounded [0,2]
 *      - For general vectors: bounded [0, ∞]
 * - Angular distance [0,π] regardless of input
 * - Cosine distance [0,2] regardless of input
 */

// ---- slot indices for Float64 accumulator --------------
const ACC_SUM_ABS = 0;
const ACC_SUM_SQ  = 1;
const ACC_MAX     = 2;
const ACC_DOT     = 3;
const ACC_N1      = 4;
const ACC_N2      = 5;

// ---- helpers ----------------------------------------------------------------

/**
 * Quick structural validation. Strict same-length requirement.
 * Returns null to indicate "do nothing" (pass-through).
 */
const validateVectors = function ( state, msg ) {
    const xVal = msg[ state.x ];
    const yVal = msg[ state.y ];
    if ( !xVal || !yVal ) return null;
    const nx = ( typeof xVal.length === 'number' ) ? xVal.length : -1;
    const ny = ( typeof yVal.length === 'number' ) ? yVal.length : -1;
    if ( ( nx <= 0 ) || ( ny <= 0 ) || ( nx !== ny ) ) return null;

    for ( let i = 0; i < nx; i += 1 ) if ( !Number.isFinite( xVal[ i ] ) ) return null;
    for ( let i = 0; i < nx; i += 1 ) if ( !Number.isFinite( yVal[ i ] ) ) return null;
    return { xVal, yVal, n: nx };
}; // validateVectors()

/**
 * Tight single-pass accumulation. No type checks inside the loop
 * (assumes upstream generated numeric vectors).
 */
const accumulate = function ( acc, v1, v2, n, mask ) {
    for ( let i = 0; i < n; i += 1 ) {
        const a = v1[ i ];
        const b = v2[ i ];
        const d = ( a - b );

        if ( ( mask & 1 ) !== 0 ) {
            const ad = Math.abs( d );
            acc[ ACC_SUM_ABS ] += ad;
            if ( ad > acc[ ACC_MAX ] ) acc[ ACC_MAX ] = ad;
        }
        if ( ( mask & 2 ) !== 0 ) {
            acc[ ACC_SUM_SQ ] += ( d * d );
        }
        if ( ( mask & 4 ) !== 0 ) {
            acc[ ACC_DOT ] += ( a * b );
            acc[ ACC_N1 ]  += ( a * a );
            acc[ ACC_N2 ]  += ( b * b );
        }
    }
}; // accumulate()

/**
 * Convert accumulators into requested distances and update state.
 * Clamps cosine similarity to avoid NaN from acos due to FP error.
 */
const finalize = function ( state, acc, n ) {
    if ( state.stats.mad ) {
        state.distances.mad = acc[ ACC_SUM_ABS ] / n;
    }
    if ( state.stats.rms ) {
        state.distances.rms = Math.sqrt( acc[ ACC_SUM_SQ ] / n );
    }
    if ( state.stats.maximum ) {
        state.distances.maximum = acc[ ACC_MAX ];
    }

    if ( ( state.mask & 4 ) !== 0 ) {
        const n1 = acc[ ACC_N1 ];
        const n2 = acc[ ACC_N2 ];

        // Zero-vector policy: treat as no directional information -> zero distances
        if ( ( n1 === 0 ) || ( n2 === 0 ) ) {
            if ( state.stats.cosine ) state.distances.cosine = 0;
            if ( state.stats.angular ) state.distances.angular = 0;
            return;
        }

        const denom = Math.sqrt( n1 ) * Math.sqrt( n2 );
        let cosSim = acc[ ACC_DOT ] / denom;

        // Clamp for numerical safety
        if ( cosSim > 1 ) cosSim = 1;
        else if ( cosSim < -1 ) cosSim = -1;

        if ( state.stats.cosine ) state.distances.cosine = 1 - cosSim;
        if ( state.stats.angular ) state.distances.angular = Math.acos( cosSim );
    }
}; // finalize()

// ---- update (export default) ------------------------------------------------

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    // Reset on each update
    state.inputValidationFailed = false;
    const validated = validateVectors( state, msg );
    if ( !validated ) {
        // Reset on the downstream node may cause this state.
        // Will wait until warms up or error goes away.
        state.inputValidationFailed = true;
        return state;
    }

    const { xVal, yVal, n } = validated;

    const acc = state.accumulator;
    acc.fill( 0 );
    accumulate( acc, xVal, yVal, n, state.mask );
    finalize( state, acc, n );

    state.computed = true;
    return state;
}; // update()

export default update;

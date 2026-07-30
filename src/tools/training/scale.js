// src/tools/training/scale.js

/**
 * @fileoverview Feature scaling for training pipelines.
 *
 * Three methods, each with a compute → scale pair:
 *   computeStandardParams  — Welford's single-pass mean/std (Welford, 1962)
 *   computeMinMaxParams    — single-pass min/max per feature
 *   computeRobustParams    — median and IQR per feature
 *
 * scale() is the unified dispatcher — reads params.method to apply the
 * matching transform. Returns a new matrix (no mutation).
 *
 * Zero-variance / zero-range / zero-IQR features are flagged via isConstant
 * and their divisor is clamped to 1, producing 0 after centering.
 *
 * Reference:
 *   Welford, B. P. (1962). Note on a Method for Calculating Corrected Sums
 *   of Squares and Products. Technometrics, 4(3), 419–420.
 *
 * The batch Welford variant uses the same delta/delta2 pattern as
 * composer's esStats node (src/nodes/es-stats/update-welford.js),
 * without exponential weighting.
 */

import { validateMatrix } from './validate.js';

// ── Standard (Welford) ──────────────────────────────────────────

/**
 * Compute per-feature mean and standard deviation using Welford's
 * single-pass algorithm for numerical stability.
 *
 * @param {number[][]} X — Training matrix, one row per sample.
 * @returns {{ method: string, mean: Float64Array, std: Float64Array, isConstant: Uint8Array }}
 */
const computeStandardParams = function ( X ) {
    const { n, p } = validateMatrix( X, 'computeStandardParams' );

    const mean = new Float64Array( p );
    const m2 = new Float64Array( p );
    const std = new Float64Array( p );
    const isConstant = new Uint8Array( p );

    // Welford batch variant (Welford, 1962):
    // Single pass — accumulates mean and sum-of-squared-deviations (m2).
    for ( let i = 0; i < n; i += 1 ) {
        const row = X[ i ];
        const count = i + 1;
        for ( let j = 0; j < p; j += 1 ) {
            const delta = row[ j ] - mean[ j ];
            mean[ j ] += delta / count;
            const delta2 = row[ j ] - mean[ j ];
            m2[ j ] += delta * delta2;
        }
    }

    for ( let j = 0; j < p; j += 1 ) {
        const variance = m2[ j ] / n;
        if ( variance < 1e-24 ) {
            std[ j ] = 1;
            isConstant[ j ] = 1;
        } else {
            std[ j ] = Math.sqrt( variance );
        }
    }

    return { method: 'standard', mean: mean, std: std, isConstant: isConstant };
}; // computeStandardParams()

// ── MinMax ───────────────────────────────────────────────────────

/**
 * Compute per-feature min and range (max − min) in a single pass.
 *
 * @param {number[][]} X — Training matrix, one row per sample.
 * @returns {{ method: string, min: Float64Array, range: Float64Array, isConstant: Uint8Array }}
 */
const computeMinMaxParams = function ( X ) {
    const { n, p } = validateMatrix( X, 'computeMinMaxParams' );

    const min = new Float64Array( p );
    const max = new Float64Array( p );
    const range = new Float64Array( p );
    const isConstant = new Uint8Array( p );

    // Initialise from first row.
    const first = X[ 0 ];
    for ( let j = 0; j < p; j += 1 ) {
        min[ j ] = first[ j ];
        max[ j ] = first[ j ];
    }

    for ( let i = 1; i < n; i += 1 ) {
        const row = X[ i ];
        for ( let j = 0; j < p; j += 1 ) {
            if ( row[ j ] < min[ j ] ) min[ j ] = row[ j ];
            if ( row[ j ] > max[ j ] ) max[ j ] = row[ j ];
        }
    }

    for ( let j = 0; j < p; j += 1 ) {
        range[ j ] = max[ j ] - min[ j ];
        if ( range[ j ] < 1e-24 ) {
            range[ j ] = 1;
            isConstant[ j ] = 1;
        }
    }

    return { method: 'minMax', min: min, range: range, isConstant: isConstant };
}; // computeMinMaxParams()

// ── Robust (median / IQR) ────────────────────────────────────────

/**
 * Linear interpolation percentile on a pre-sorted array.
 *
 * @param {Float64Array} sorted — Sorted values.
 * @param {number} q — Quantile in [0, 1].
 * @returns {number} Interpolated percentile value.
 */
const percentile = function ( sorted, q ) {
    const pos = q * ( sorted.length - 1 );
    const lo = Math.floor( pos );
    const hi = Math.ceil( pos );
    if ( lo === hi ) return sorted[ lo ];
    const frac = pos - lo;
    return ( sorted[ lo ] * ( 1 - frac ) ) + ( sorted[ hi ] * frac );
}; // percentile()

/**
 * Compute per-feature median and IQR. Copies each column and sorts
 * to find percentiles — O(n log n) per feature.
 *
 * @param {number[][]} X — Training matrix, one row per sample.
 * @returns {{ method: string, median: Float64Array, iqr: Float64Array, isConstant: Uint8Array }}
 */
const computeRobustParams = function ( X ) {
    const { n, p } = validateMatrix( X, 'computeRobustParams' );

    const median = new Float64Array( p );
    const iqr = new Float64Array( p );
    const isConstant = new Uint8Array( p );

    for ( let j = 0; j < p; j += 1 ) {
        // Extract and sort column j.
        const col = new Float64Array( n );
        for ( let i = 0; i < n; i += 1 ) {
            col[ i ] = X[ i ][ j ];
        }
        col.sort();

        median[ j ] = percentile( col, 0.50 );
        const q1 = percentile( col, 0.25 );
        const q3 = percentile( col, 0.75 );
        iqr[ j ] = q3 - q1;

        if ( iqr[ j ] < 1e-24 ) {
            iqr[ j ] = 1;
            isConstant[ j ] = 1;
        }
    }

    return { method: 'robust', median: median, iqr: iqr, isConstant: isConstant };
}; // computeRobustParams()

// ── Unified dispatcher ───────────────────────────────────────────

/**
 * Scale a matrix using pre-computed parameters.
 * Reads params.method to determine the transform.
 * Returns a new matrix — the input is never mutated.
 *
 * @param {number[][]} X — Matrix to scale.
 * @param {object} params — From any compute*Params function.
 * @returns {number[][]} Scaled copy.
 */
const scale = function ( X, params ) {
    if ( !Array.isArray( X ) || X.length === 0 ) {
        throw new Error( 'scale: X must be a non-empty array of rows.' );
    }

    const n = X.length;
    const method = params.method;
    const result = new Array( n );

    if ( method === 'standard' ) {
        const mean = params.mean;
        const std = params.std;
        const p = mean.length;
        for ( let i = 0; i < n; i += 1 ) {
            const row = X[ i ];
            const out = new Array( p );
            for ( let j = 0; j < p; j += 1 ) {
                out[ j ] = ( row[ j ] - mean[ j ] ) / std[ j ];
            }
            result[ i ] = out;
        }
    } else if ( method === 'minMax' ) {
        const min = params.min;
        const range = params.range;
        const p = min.length;
        for ( let i = 0; i < n; i += 1 ) {
            const row = X[ i ];
            const out = new Array( p );
            for ( let j = 0; j < p; j += 1 ) {
                out[ j ] = ( row[ j ] - min[ j ] ) / range[ j ];
            }
            result[ i ] = out;
        }
    } else if ( method === 'robust' ) {
        const med = params.median;
        const iq = params.iqr;
        const p = med.length;
        for ( let i = 0; i < n; i += 1 ) {
            const row = X[ i ];
            const out = new Array( p );
            for ( let j = 0; j < p; j += 1 ) {
                out[ j ] = ( row[ j ] - med[ j ] ) / iq[ j ];
            }
            result[ i ] = out;
        }
    } else {
        throw new Error( 'scale: unknown method "' + method + '".' );
    }

    return result;
}; // scale()

// Backward compatibility: `standardize` is an alias for `scale`.
const standardize = scale;

export {
    computeStandardParams,
    computeMinMaxParams,
    computeRobustParams,
    scale,
    standardize
};

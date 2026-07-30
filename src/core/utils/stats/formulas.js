// core/utils/stats/formulas.js

/**
 * @fileoverview Pure functions that compute statistics from central moments.
 *
 * Shared by digestMoments (converts raw moments to stats) and twStats
 * (tumbling window stats with deferred computation at publish time).
 *
 * All formulas use unnormalized central moments (M2 = sum of squared deviations,
 * not M2/n) as input, consistent with Pébay's incremental algorithm output.
 *
 * @see https://en.wikipedia.org/wiki/Algorithms_for_calculating_variance
 * @see Pébay, P. (2008). Sandia Report SAND2008-6212.
 */

/**
 * Compute sample variance from second central moment.
 * @param {number} M2 - Second central moment (sum of squared deviations)
 * @param {number} n - Sample count
 * @param {boolean} biased - If true, divide by n (population); else by n-1 (sample)
 * @returns {number} Variance
 */
export const computeVariance = function ( M2, n, biased ) {
    const divisor = biased ? n : ( n - 1 );
    return M2 / divisor;
}; // computeVariance()

/**
 * Compute coefficient of variation.
 * @param {number} stddev - Standard deviation
 * @param {number} mean - Arithmetic mean
 * @param {number} eps - Epsilon for numerical stability
 * @returns {number} CV or NaN if mean is near zero
 */
export const computeCV = function ( stddev, mean, eps ) {
    return ( Math.abs( mean ) > eps ) ? ( stddev / Math.abs( mean ) ) : NaN;
}; // computeCV()

/**
 * Compute skewness: m3 / m2^1.5 (population skewness)
 * @param {number} M3 - Third central moment
 * @param {number} n - Sample count
 * @param {number} m2 - Population variance (M2/n)
 * @param {number} eps - Epsilon for numerical stability
 * @returns {number} Skewness or NaN/0 for edge cases
 */
export const computeSkew = function ( M3, n, m2, eps ) {
    if ( !Number.isFinite( M3 ) ) return NaN;
    const m3 = M3 / n;
    const denom = Math.pow( m2, 1.5 );
    return ( denom > eps ) ? ( m3 / denom ) : 0;
}; // computeSkew()

/**
 * Compute excess kurtosis: (m4 / m2²) - 3
 * @param {number} M4 - Fourth central moment
 * @param {number} n - Sample count
 * @param {number} m2 - Population variance (M2/n)
 * @param {number} eps - Epsilon for numerical stability
 * @returns {number} Excess kurtosis or NaN/-3 for edge cases
 */
export const computeKurtosis = function ( M4, n, m2, eps ) {
    if ( !Number.isFinite( M4 ) ) return NaN;
    const m4 = M4 / n;
    const denom = m2 * m2;
    return ( denom > eps ) ? ( ( m4 / denom ) - 3 ) : -3;
}; // computeKurtosis()

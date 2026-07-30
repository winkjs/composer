// nodes/digest-moments/update.js

/**
 * @fileoverview Update function for digestMoments node.
 *
 * Converts raw moments (n, M1-M4, min, max) into displayable statistics.
 * Only computes stats that were requested in the spec.
 */

import { computeVariance, computeCV, computeSkew, computeKurtosis } from './formulas.js';

/**
 * Set all variance-dependent stats to NaN.
 * @param {Object} state - Node state
 * @param {Object} stats - Requested stats config
 */
const setVarianceStatsNaN = function ( state, stats ) {
    if ( stats.variance ) state.variance = NaN;
    if ( stats.stddev ) state.stddev = NaN;
    if ( stats.cv ) state.cv = NaN;
    if ( stats.skew ) state.skew = NaN;
    if ( stats.kurtosis ) state.kurtosis = NaN;
}; // setVarianceStatsNaN()

/**
 * Compute and store min/max pass-through stats.
 * @param {Object} state - Node state
 * @param {Object} stats - Requested stats config
 * @param {Object} msg - Message with moment fields
 */
const computeMinMax = function ( state, stats, msg ) {
    if ( stats.min ) {
        const min = msg[ state.fields.min ];
        state.min = Number.isFinite( min ) ? min : NaN;
    }
    if ( stats.max ) {
        const max = msg[ state.fields.max ];
        state.max = Number.isFinite( max ) ? max : NaN;
    }
}; // computeMinMax()

/**
 * Compute and store variance-dependent stats.
 * @param {Object} state - Node state
 * @param {Object} stats - Requested stats config
 * @param {Object} msg - Message with moment fields
 * @param {number} M1 - Mean
 * @param {number} M2 - Second central moment
 * @param {number} n - Sample count
 * @param {number} m2 - Population variance (M2/n)
 * @param {number} eps - Epsilon for numerical stability
 */
const computeVarianceStats = function ( state, stats, msg, M1, M2, n, m2, eps ) {
    const variance = computeVariance( M2, n, state.biased );
    const stddev = Math.sqrt( variance );

    if ( stats.variance ) state.variance = variance;
    if ( stats.stddev ) state.stddev = stddev;
    if ( stats.cv ) state.cv = computeCV( stddev, M1, eps );
    if ( stats.skew ) state.skew = computeSkew( msg[ state.fields.M3 ], n, m2, eps );
    if ( stats.kurtosis ) state.kurtosis = computeKurtosis( msg[ state.fields.M4 ], n, m2, eps );
}; // computeVarianceStats()

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;

    state.inputValidationFailed = false;

    // Read required moment fields from upstream momentsDigest
    const n   = msg[ state.fields.n ];
    const M1  = msg[ state.fields.M1 ];
    const M2  = msg[ state.fields.M2 ];

    // Validate required inputs (n, M1, M2 are always needed)
    if ( !Number.isFinite( n ) || !Number.isFinite( M1 ) || !Number.isFinite( M2 ) ) {
        state.inputValidationFailed = true;
        return state;
    }

    const eps = state.epsilon;
    const stats = state.stats;

    // n is pass-through (already validated as finite)
    if ( stats.n ) state.n = n;

    // Mean is always M1
    if ( stats.mean ) state.mean = M1;

    // Min/max are pass-through
    computeMinMax( state, stats, msg );

    // Check if any variance-dependent stats requested
    const needsVariance = stats.variance || stats.stddev || stats.cv || stats.skew || stats.kurtosis;
    if ( !needsVariance ) return state;

    // Variance-dependent stats require n >= 2
    if ( n < 2 ) {
        setVarianceStatsNaN( state, stats );
        return state;
    }

    // Population variance (M2/n) used for skew/kurtosis denominators
    const m2 = M2 / n;

    // When m2 < eps: variance/stddev are 0, cv/skew/kurtosis are NaN
    if ( m2 < eps ) {
        if ( stats.variance ) state.variance = 0;
        if ( stats.stddev ) state.stddev = 0;
        if ( stats.cv ) state.cv = NaN;
        if ( stats.skew ) state.skew = NaN;
        if ( stats.kurtosis ) state.kurtosis = NaN;
        return state;
    }

    computeVarianceStats( state, stats, msg, M1, M2, n, m2, eps );

    return state;
}; // update()

export default update;

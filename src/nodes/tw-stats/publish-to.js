// nodes/tw-stats/publish-to.js

/**
 * @fileoverview TW Stats Publish — deferred stat conversion from snapshot.
 *
 * On publish ticks (window completion or flush): computes final statistics
 * from the Pébay moment snapshot and writes them to the message.
 *
 * On non-publish ticks: scrubs all storeAs fields to undefined to prevent
 * downstream from reading stale data.
 *
 * No publishNaN — invalid samples are skipped in update(); a flush snapshot
 * planned in the prelude still publishes regardless of the current input.
 */

import { computeVariance, computeCV, computeSkew, computeKurtosis } from '../../core/utils/stats/formulas.js';

/**
 * Publish variance-dependent stats when m2 is above epsilon.
 * Extracted to keep publishTo within nesting depth limits.
 */
const publishVarianceStats = function ( state, msg, s, n, m2 ) {
    const variance = computeVariance( s.M2, n, state.biased );
    const stddev = Math.sqrt( variance );
    const stats = state.stats;
    const eps = state.epsilon;

    if ( stats.variance ) msg[ stats.variance.storeAs ] = variance;
    if ( stats.stddev ) msg[ stats.stddev.storeAs ] = stddev;
    if ( stats.cv ) msg[ stats.cv.storeAs ] = computeCV( stddev, s.M1, eps );
    if ( stats.skew ) msg[ stats.skew.storeAs ] = computeSkew( s.M3, n, m2, eps );
    if ( stats.kurtosis ) msg[ stats.kurtosis.storeAs ] = computeKurtosis( s.M4, n, m2, eps );
}; // publishVarianceStats()

/**
 * Set all variance-dependent stats to NaN.
 * Used when n < 2 or variance is not computable.
 */
const publishVarianceNaN = function ( stats, msg ) {
    if ( stats.variance ) msg[ stats.variance.storeAs ] = NaN;
    if ( stats.stddev ) msg[ stats.stddev.storeAs ] = NaN;
    if ( stats.cv ) msg[ stats.cv.storeAs ] = NaN;
    if ( stats.skew ) msg[ stats.skew.storeAs ] = NaN;
    if ( stats.kurtosis ) msg[ stats.kurtosis.storeAs ] = NaN;
}; // publishVarianceNaN()

/**
 * Set variance-dependent stats for near-zero variance (m2 < epsilon).
 * Variance and stddev are 0; cv, skew, kurtosis degenerate.
 */
const publishVarianceZero = function ( stats, msg ) {
    if ( stats.variance ) msg[ stats.variance.storeAs ] = 0;
    if ( stats.stddev ) msg[ stats.stddev.storeAs ] = 0;
    if ( stats.cv ) msg[ stats.cv.storeAs ] = NaN;
    if ( stats.skew ) msg[ stats.skew.storeAs ] = 0;
    if ( stats.kurtosis ) msg[ stats.kurtosis.storeAs ] = -3;
}; // publishVarianceZero()

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;

    if ( state.planPublish ) {
        const s = state.snapshot;
        const n = s.n;
        const stats = state.stats;

        // Always-available stats
        if ( stats.n ) msg[ stats.n.storeAs ] = n;
        if ( stats.mean ) msg[ stats.mean.storeAs ] = s.M1;
        if ( stats.min ) msg[ stats.min.storeAs ] = s.min;
        if ( stats.max ) msg[ stats.max.storeAs ] = s.max;

        // Variance-dependent stats (require maxMoment >= 2)
        if ( state.maxMoment >= 2 ) {
            if ( n >= 2 ) {
                const m2 = s.M2 / n;
                if ( m2 >= state.epsilon ) {
                    publishVarianceStats( state, msg, s, n, m2 );
                } else {
                    publishVarianceZero( stats, msg );
                }
            } else {
                publishVarianceNaN( stats, msg );
            }
        }

        // Derived stats: RMS and crest factor (cold-path only, from existing accumulators)
        if ( state.needsRms ) {
            const rms = Math.sqrt( ( s.M2 / n ) + ( s.M1 * s.M1 ) );
            if ( stats.rms ) msg[ stats.rms.storeAs ] = rms;
            if ( stats.crestFactor ) {
                const peak = Math.max( Math.abs( s.min ), Math.abs( s.max ) );
                msg[ stats.crestFactor.storeAs ] = ( rms > state.epsilon ) ? ( peak / rms ) : NaN;
            }
        }

        msg[ state.name ] = true;
        return;
    }

    // Non-publish tick: scrub all storeAs fields to undefined
    const keys = state.scrubKeys;
    for ( let i = 0; i < keys.length; i += 1 ) {
        msg[ keys[ i ] ] = undefined;
    }
}; // publishTo()

export default publishTo;

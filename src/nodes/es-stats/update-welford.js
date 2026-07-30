/**
 * @fileoverview Exponentially weighted Welford update for mean, variance,
 * stdev, and derived signal-quality metrics (SNR, CV, zScore).
 *
 * Uses the numerically stable two-pass delta form:
 *   delta  = x - mean;  mean += alpha * delta;
 *   delta2 = x - mean;  m2   = decay * m2 + alpha * delta * delta2
 *
 * The "unbiased" variance is normalized as m2/weightSum. This intentionally
 * diverges from the pandas ewm().var(bias=False) Bessel-type correction;
 * both converge as n -> infinity (weightSum -> 1). See golden-truth-es-stats.py
 * for cross-validation details.
 *
 * Zero allocations; all reads/writes via the pre-allocated state object.
 */
// nodes/es-stats/update-welford.js

const updateWelford = function ( state, xVal ) {
    state.weightSum = ( state.decay * state.weightSum ) + state.alpha;
    if ( state.weightSum > 1 ) state.weightSum = 1; // defensive clamp against drift

    // Z-Score: How many standard deviations away from established mean?
    // Computed BEFORE update to detect anomalies in incoming value
    // Uses pre-update stats to preserve causality in anomaly detection
    if ( state.stats.zScore ) {
        if ( state.stdev > state.EPS ) {
            // Use current baseline
            state.zScore = ( xVal - state.mean ) / state.stdev;
        } else {
            state.zScore = 0;
        }
    }

    // NOW incorporate this value into running statistics
    const delta = xVal - state.mean;
    state.mean += ( state.alpha * delta );
    const delta2 = xVal - state.mean;

    state.m2 = ( state.decay * state.m2 ) + ( state.alpha * delta * delta2 );

    state.variance = state.biased ? state.m2 :
        ( state.weightSum > state.EPS ? ( state.m2 / state.weightSum ) : state.m2 );

    if ( state.variance < 0 ) state.variance = 0;
    state.stdev = Math.sqrt( state.variance );

    if ( state.stats.snrDB ) {
        if ( state.stdev < state.EPS ) {
            state.snrDB = state.snrDbCap; // No noise — clean signal → 60 dB cap
        } else if ( Math.abs( state.mean ) < state.EPS ) {
            state.snrDB = 0; // No signal — noise dominates → 0 dB
        } else {
            state.snrDB = 20 * Math.log10( Math.abs( state.mean ) / state.stdev );
        }
    }

    if ( state.stats.cv ) {
        state.cv = ( Math.abs( state.mean ) > state.EPS ) ?
            ( state.stdev / Math.abs( state.mean ) ) : state.cvLarge;
    }
}; // updateWelford()

export default updateWelford;


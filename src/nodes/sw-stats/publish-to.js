// nodes/sw-stats/publish-to.js

import { isNotFull, size } from '../../windowing/count-sliding/index.js';
import { publishNaN } from '../../core/utils/node/index.js';

const EPS = 1e-9;

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;
    // Propagate NaN if unhealthy
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }
    // Do not publish partial results.
    if ( isNotFull( state.ring ) ) return;

    const windowSize = size( state.ring );
    const mean = state.s1 / windowSize;
    if ( state.stats.mean ) msg[ state.stats.mean.storeAs ] = mean;
    if ( state.need2 ) {
        const sumSquaredDeviations = state.s2 - ( state.s1 * mean );
        const m2 =       sumSquaredDeviations / windowSize;
        const variance = sumSquaredDeviations / ( windowSize - 1 );
        const safeVariance = ( variance < EPS ) ? 0 : variance;
        // --- Use `stats.variance` in the if statement to check ---------------------
        if ( state.stats.variance ) msg[ state.stats.variance.storeAs ] = safeVariance;
        if ( state.stats.stdev )    msg[ state.stats.stdev.storeAs ]    = Math.sqrt( safeVariance );
        if ( state.stats.rms )      msg[ state.stats.rms.storeAs ]      = Math.sqrt( state.s2 / windowSize );
        if ( state.need3 ) {
            // Formula: m3 = ( s3 - 3 μ s2 + 2 μ^3 N ) / N
            const m3 = ( state.s3 - (3 * mean * state.s2 ) + ( 2 * mean * mean * mean * windowSize ) ) / windowSize;
            const denom = Math.pow( m2, 1.5 );
            if ( state.stats.skewness ) msg[ state.stats.skewness.storeAs ] = ( denom > EPS ) ? m3 / denom : 0;
        }
        if ( state.need4 ) {
            const m4 = ( state.s4 - ( 4 * ( mean * state.s3 ) ) + ( 6 * mean * mean * state.s2 ) -
                       ( 3 * mean * mean * mean * mean * windowSize ) ) / windowSize;
            const denom = m2 * m2;
            if ( state.stats.kurtosis ) msg[ state.stats.kurtosis.storeAs ] = ( denom > EPS ) ? ( ( m4 / denom ) - 3 ) : -3;
        }
    }
}; // publishTo()

export default publishTo;

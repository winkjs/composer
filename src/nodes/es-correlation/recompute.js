/**
 * @fileoverview Numerical stability handler for the es-correlation node.
 * Floors negative variances (floating-point guard), recomputes correlation
 * from current accumulated state, and clamps the result to [-1, 1].
 */
// nodes/es-correlation/recompute.js

const recompute = function ( state ) {
    // It doesn't store historical data, so traditional recomputation isn't possible.
    // Instead, we perform numerical stability checks and adjustments.

    // Check for numerical issues in variances.
    // Variance should never be negative due to our update formula,
    // but floating point errors could theoretically cause issues.
    if ( state.varianceX < 0 ) {
        state.varianceX = 0;
    }
    if ( state.varianceY < 0 ) {
        state.varianceY = 0;
    }

    // Recompute correlation from current statistics to ensure consistency.
    if ( state.sampleCount >= state.minSamples ) {
        const stdX = Math.sqrt( Math.max( state.varianceX, state.minVariance ) );
        const stdY = Math.sqrt( Math.max( state.varianceY, state.minVariance ) );

        state.correlation = state.covariance / ( stdX * stdY );

        // Ensure correlation is in valid range.
        if ( state.correlation > 1 ) {
            state.correlation = 1;
        } else if ( state.correlation < -1 ) {
            state.correlation = -1;
        }

        // Check for NaN (could occur if both variances are zero despite protection).
        if ( Number.isNaN( state.correlation ) ) {
            state.correlation = 0;
        }

        // Keep derived stats consistent with adjusted correlation.
        if ( state.stats && state.stats.r2 ) {
            state.r2 = state.correlation * state.correlation;
        }
        if ( ( state.fisherZCap < 1 ) && state.stats && state.stats.fisherZT ) {
            const r = state.correlation;
            const capped = ( r > state.fisherZCap ) ? state.fisherZCap :
                ( r < -state.fisherZCap ? -state.fisherZCap : r );
            state.fisherZT = 0.5 * Math.log( ( 1 + capped ) / ( 1 - capped ) );
        }
    }

    return true;
}; // recompute()

export default recompute;

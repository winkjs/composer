/**
 * @fileoverview Hot-path exponentially weighted moving correlation computation.
 * Uses a Welford-style incremental algorithm with exponential decay on means,
 * variance, and covariance. Optionally computes r² and Fisher Z transform.
 * Zero allocations; all reads/writes via the pre-allocated state object.
 */
// nodes/es-correlation/update.js

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    const xVal = msg[ state.x ];
    // Reset on each update
    state.inputValidationFailed = false;
    // Handle faults gracefully: ensure their isolation
    if ( !Number.isFinite( xVal ) ) {
        // Signals publishing NaN for all demanded `stats` in publishTo.
        state.inputValidationFailed = true;
        return state;
    }

    const yVal = msg[ state.y ];
    // Handle faults gracefully: ensure their isolation
    if ( !Number.isFinite( yVal ) ) {
        // Signals publishing NaN for all demanded `stats` in publishTo.
        state.inputValidationFailed = true;
        return state;
    }

    // Special handling for first observation:
    // Initialize means with the first sample for faster convergence
    // and more natural variance evolution; no variance/covariance yet.
    if ( state.sampleCount === 0 ) {
        state.meanX = xVal;
        state.meanY = yVal;
        state.sampleCount = 1;  // count the first sample
        return state;
    }

    // Increment sample count for subsequent observations.
    state.sampleCount += 1;

    // Compute deltas BEFORE updating means (critical for numerical stability).
    const deltaX = xVal - state.meanX;
    const deltaY = yVal - state.meanY;

    // Exponentially smoothed update for means.
    state.meanX += state.alpha * deltaX;
    state.meanY += state.alpha * deltaY;

    // Numerically stable variance and covariance updates.
    // Note: We use the NEW mean for the second delta computation.

    // Update covariance using the stable formula.
    // cov += α * δx * (y - mean_y_new)
    state.covariance += state.alpha * ( ( deltaX * ( yVal - state.meanY ) ) - state.covariance );

    // If neither correlation nor r2 is requested, we can skip the
    // variance/correlation path (keeps hot path lean). r2 implies
    // correlation at compute-time even if not explicitly requested.
    if ( ( state.stats.correlation === undefined ) && ( state.stats.r2 === undefined ) ) {
        return state;
    }

    // Update variances using the stable formula.
    // var_x += α * δx * (x - mean_x_new)
    state.varianceX += state.alpha * ( ( deltaX * ( xVal - state.meanX ) ) - state.varianceX );
    state.varianceY += state.alpha * ( ( deltaY * ( yVal - state.meanY ) ) - state.varianceY );

    // Compute correlation only after minimum samples collected.
    if ( state.sampleCount >= state.minSamples ) {
        // Compute standard deviations with minimum variance protection.
        const stdX = Math.sqrt( Math.max( state.varianceX, state.minVariance ) );
        const stdY = Math.sqrt( Math.max( state.varianceY, state.minVariance ) );

        // Compute correlation coefficient.
        // The max() ensures we never divide by zero.
        state.correlation = state.covariance / ( stdX * stdY );

        // Clamp correlation to [-1, 1] to handle numerical errors.
        // Due to floating point arithmetic, we might get values like 1.0000000002.
        if ( state.correlation >= 1 ) {
            // Note: fisherZCap currently couples clamping and Z-publish enabling.
            // We will decouple this in a subsequent Fisher-Z clarity pass.
            state.correlation = state.fisherZCap;
        } else if ( state.correlation <= -1 ) {
            state.correlation = -state.fisherZCap;
        }

        // Compute r² (coefficient of determination) at publish time (if required)
        // by squaring the correlation. r² is always in [0,1] and has a direct
        // percentage interpretation (model quality, sensor agreement, etc).
        if ( state.stats && state.stats.r2 ) {
            state.r2 = state.correlation * state.correlation;
        }

        // Compute Fisher Z transform only when:
        // - feature enabled (fisherZCap < 1), and
        // - output mapping provided in stats.fisherZ.
        if ( ( state.fisherZCap < 1 ) && state.stats && state.stats.fisherZT ) {
            // Guard against |r| → 1 to prevent infinities; clamp with current cap.
            const r = state.correlation;
            const capped = ( r > state.fisherZCap ) ? state.fisherZCap : ( r < -state.fisherZCap ? -state.fisherZCap : r );
            state.fisherZT = 0.5 * Math.log( ( 1 + capped ) / ( 1 - capped ) );
        }
    }

    return state;
}; // update()

export default update;

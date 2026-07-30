/**
 * @fileoverview Hot-path exponentially weighted pairwise correlation computation.
 * Uses a Welford-style incremental algorithm with exponential decay on means,
 * variance, and covariance for all n*(n-1)/2 variable pairs. Zero allocations;
 * all reads/writes via the pre-allocated state object.
 */
// nodes/es-pairwise-correlation/update.js

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    const {
        x, n, alpha, minVariance,
        values, deltas, means, variances, covariances,
        correlations, fisherZCap, pairCount
    } = state;

    state.inputValidationFailed = false;
    // Extract and validate & Handle faults gracefully: ensure their isolation
    for ( let i = 0; i < n; i += 1 ) {
        const val = msg[ x[ i ] ];
        if ( val === undefined || val === null ) {
            // Signals publishing NaN for all demanded `stats` in publishTo.
            state.inputValidationFailed = true;
            return state;
        }
        values[ i ] = val;
        if ( !Number.isFinite( values[ i ] ) ) {
            // Signals publishing NaN for all demanded `stats` in publishTo.
            state.inputValidationFailed = true;
            return state;
        }
    }

    // Initialize on first sample: set means and count, no variance/covariance yet.
    if ( state.sampleCount === 0 ) {
        for ( let i = 0; i < n; i += 1 ) {
            means[ i ] = values[ i ];
        }
        state.sampleCount = 1;
        return state;
    }

    // Increment sample count for subsequent observations.
    state.sampleCount += 1;

    // Update deltas, means, variances
    for ( let i = 0; i < n; i += 1 ) {
        deltas[ i ] = values[ i ] - means[ i ];
        means[ i ] += alpha * deltas[ i ];
        variances[ i ] += alpha * ( ( deltas[ i ] * ( values[ i ] - means[ i ] ) ) - variances[ i ] );
    }

    // Update covariances and correlations
    let idx = 0;
    for ( let i = 0; i < n; i += 1 ) {
        for ( let j = i + 1; j < n; j += 1 ) {
            // Update covariance
            covariances[ idx ] += alpha * ( ( deltas[ i ] * ( values[ j ] - means[ j ] ) ) - covariances[ idx ] );

            // Compute correlation if ready
            if ( state.sampleCount >= state.minSamples ) {
                const varX = Math.max( variances[ i ], minVariance );
                const varY = Math.max( variances[ j ], minVariance );
                correlations[ idx ] = covariances[ idx ] / Math.sqrt( varX * varY );

                // Clamp
                if ( correlations[ idx ] >= fisherZCap ) {
                    correlations[ idx ] = fisherZCap;
                } else if ( correlations[ idx ] <= -fisherZCap ) {
                    correlations[ idx ] = -fisherZCap;
                }
            }

            idx += 1;
        }
    }

    // Fisher Z transform if needed
    if ( state.fisherZT && state.sampleCount >= state.minSamples ) {
        for ( let i = 0; i < pairCount; i += 1 ) {
            const r = correlations[ i ];
            state.fisherZT[ i ] = 0.5 * Math.log( ( 1 + r ) / ( 1 - r ) );
        }
    }

    return state;
}; // update()

export default update;

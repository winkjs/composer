/**
 * @fileoverview Numerical stability handler for the es-pairwise-correlation node.
 * Floors negative variances (floating-point guard), recomputes all pairwise
 * correlations from current accumulated state, clamps results, and re-derives
 * Fisher Z transforms when enabled.
 */
// nodes/es-pairwise-correlation/recompute.js

const recompute = function ( state ) {
    // Recompute correlations from current statistics
    // This ensures numerical consistency and fixes any accumulated errors

    const {
        n, variances, covariances, correlations,
        minVariance, fisherZCap, pairCount
    } = state;

    // Step 1: Ensure variances are non-negative (fix numerical errors)
    for ( let i = 0; i < n; i += 1 ) {
        if ( variances[ i ] < 0 ) {
            variances[ i ] = 0;
        }
    }

    // Step 2: Recompute all correlations using direct nested loops
    let idx = 0;
    for ( let i = 0; i < n; i += 1 ) {
        // Pre-compute variance for variable i with protection
        const varX = Math.max( variances[ i ], minVariance );
        const stdX = Math.sqrt( varX );

        for ( let j = i + 1; j < n; j += 1 ) {
            // Pre-compute variance for variable j with protection
            const varY = Math.max( variances[ j ], minVariance );
            const stdY = Math.sqrt( varY );

            // Compute correlation from covariance
            const cov = covariances[ idx ];
            correlations[ idx ] = cov / ( stdX * stdY );

            // Ensure valid range [-1, 1] with Fisher Z cap if applicable
            if ( correlations[ idx ] >= fisherZCap ) {
                correlations[ idx ] = fisherZCap;
            } else if ( correlations[ idx ] <= -fisherZCap ) {
                correlations[ idx ] = -fisherZCap;
            } else if ( Number.isNaN( correlations[ idx ] ) ) {
                // Handle edge case where both variances were zero
                correlations[ idx ] = 0;
            }

            idx += 1;
        }
    }

    // Step 3: Recompute Fisher Z transformation if present
    if ( state.fisherZT ) {
        for ( let i = 0; i < pairCount; i += 1 ) {
            const r = correlations[ i ];
            // Fisher Z: 0.5 * ln((1+r)/(1-r))
            // Note: r is already clamped to [-fisherZCap, fisherZCap]
            // so we're guaranteed (1+r)/(1-r) > 0
            state.fisherZT[ i ] = 0.5 * Math.log( ( 1 + r ) / ( 1 - r ) );
        }
    }

    return true;
}; // recompute()

export default recompute;

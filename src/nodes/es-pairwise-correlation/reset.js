/**
 * @fileoverview Resets all statistical accumulators (means, variances,
 * covariances, correlations) and output values (fisherZT) to their initial
 * state, allowing the node to restart computation from scratch.
 */
// nodes/es-pairwise-correlation/reset.js

const reset = function ( state ) {
    // Reset all statistics to zero
    state.means.fill( 0 );
    state.variances.fill( 0 );
    state.covariances.fill( 0 );
    state.correlations.fill( 0 );

    if ( state.fisherZT ) {
        state.fisherZT.fill( 0 );
    }

    // Reset sample counter
    state.sampleCount = 0;

    // Clear workspace arrays
    state.values.fill( 0 );
    state.deltas.fill( 0 );

    return true;
}; // reset()

export default reset;

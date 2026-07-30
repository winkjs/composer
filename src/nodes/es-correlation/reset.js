/**
 * @fileoverview Resets all statistical accumulators (means, variances,
 * covariance) and output values (correlation, r², fisherZT) to their
 * initial state, allowing the node to restart computation from scratch.
 */
// nodes/es-correlation/reset.js

const reset = function ( state ) {
    // Reset all statistical accumulators to initial values.
    state.meanX = 0;
    state.meanY = 0;
    state.varianceX = 0;
    state.varianceY = 0;
    state.covariance = 0;

    // Reset output values.
    state.correlation = 0;
    state.r2 = 0;
    state.fisherZT = 0;

    // Reset sample counter.
    state.sampleCount = 0;

    return true;
}; // reset()

export default reset;

/**
 * @fileoverview Resets all esStats accumulated state to its pre-observation
 * condition.
 *
 * Clears mean, m2, variance, stdev, envelope metrics, signal-quality scores,
 * weightSum, and sampleCount. Configuration (alpha, decay, halfLife, biased,
 * stats, computation-path flags) is preserved so the next observation seeds
 * the estimate afresh. Returns true per ADR-004 control-signal contract.
 */
// nodes/es-stats/reset.js

/**
 * Reset all statistical accumulators to initial state.
 * Called by control signals to restart statistics tracking.
 *
 * @param {Object} state - Node state to reset
 * @returns {boolean} Always true (ADR-004)
 */
const reset = function ( state ) {
    // Reset core statistics
    state.mean = 0;
    state.m2 = 0;
    state.variance = 0;
    state.stdev = 0;

    // Reset envelope statistics
    state.floor = 0;
    state.ceiling = 0;
    state.envelope = 0;
    state.mid = 0;

    // Reset signal quality
    state.snrDB = 0;
    state.cv = 0;

    // Reset current value scores
    state.zScore = 0;
    state.envScore = 0;

    // Reset weight accumulator
    state.weightSum = 0;

    // Reset sample counter
    state.sampleCount = 0;

    return true;
}; // reset()

export default reset;

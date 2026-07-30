/**
 * @fileoverview Resets Page-Hinkley state to initial values.
 *
 * Clears all accumulated state (cumulative sum, running minimum, baseline
 * mean, sample count) and detection outputs (shiftDetected, testStatistic).
 * Configuration (alpha, detectDrop, tunables, stats) is preserved.
 */

const reset = function ( state ) {
    // Reset accumulated computation state
    state.cumSum = 0;
    state.minCumSum = 0;
    state.mean = 0;
    state.count = 0;
    // Reset detection outputs — avoids publishing stale results after reset
    state.shiftDetected = false;
    state.testStatistic = 0;
    // Clear error suppression so next error episode is logged
    state.tunableErrorLogged = false;
    return true;
}; // reset()

export default reset;

/**
 * @fileoverview Resets accumulated EWMA state to its pre-observation condition.
 *
 * Clears the estimate, initialization flag, adaptive innovation tracker, and
 * last observed value. Restores currentAlpha to the base alpha derived at init,
 * so the next observation seeds the estimate afresh.
 */

const reset = function ( state ) {
    state.esmValue = null;
    state.isInitialized = false;

    // Restore base alpha (derived from half-life at init)
    state.currentAlpha = state.alpha;

    // New adaptive state
    state.esAbsInnovation = null;

    state.lastValue = null;

    return true;
}; // reset()

export default reset;

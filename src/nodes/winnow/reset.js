/**
 * @fileoverview Reset winnow to initial state.
 *
 * Clears the anchor, counter, and all accumulated state. The next
 * message will trigger the warmup path (anchor is null), establishing
 * a fresh reference trajectory.
 *
 * Called by the controller node when a downstream condition fires
 * (e.g., after a step change detected by kalman1d's innovation gate).
 */

const reset = function ( state ) {
    state.anchor = null;
    state.anchorSlope = 0;
    state.anchorTime = 0;
    state.lastPassedAt = 0;
    state.prevDirection = null;
    state.counter = 0;
    state.deviation = 0;
    state.predicted = 0;
    state.significant = false;
    state.tunableErrorLogged = false;

    // ── Buffer state ───────────────────────────────────────────────
    state.bufferedX = NaN;
    state.bufferedT = NaN;
    state.keptByGate = false;
    state.xPrev = NaN;
    state.tPrev = NaN;

    return true;
}; // reset()

export default reset;

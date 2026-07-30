// nodes/lag/recompute.js

/**
 * @fileoverview Numerical stability handler for the lag node.
 *
 * Five of six stats (delta, ratio, roc, slope, logReturn) are inherently
 * stable — each is computed fresh from (xVal, xLag) with no accumulated
 * state, so no recomputation is needed.
 *
 * cumDelta is the exception: it maintains an unbounded running sum
 * (`state.cumDelta += (xVal - xLag)`) subject to O(n * machineEpsilon)
 * floating-point drift over n messages. In practice, drift is bounded by
 * periodic reset signals from the controller node; recompute remains a
 * no-op under this assumption. If long-term accumulation without periodic
 * reset is ever required, switch cumDelta to Kahan compensated summation
 * in update.js.
 *
 * @see ADR-004
 */

/**
 * Recomputes internal state for numerical stability.
 *
 * No-op: five instantaneous stats have no drift; cumDelta drift is bounded
 * by periodic controller resets (see fileoverview).
 *
 * @returns {boolean} Always returns true (no action needed)
 */
const recompute = function () {
    return true;
}; // recompute()

export default recompute;

// nodes/accumulate/recompute.js

/**
 * @fileoverview Numerical stability handler for accumulate node.
 *
 * Running sum is numerically stable for bounded accumulation windows —
 * controller resets prevent unbounded drift. Without resets, IEEE 754
 * rounding error grows with the number of additions, and precision
 * degrades when magnitudes vary widely. No recomputation is possible
 * here (no ring buffer to re-sum from), so timely controller resets
 * are essential.
 *
 * @see ADR-004
 */

/**
 * Handles numerical stability (no-op — no history buffer to recompute from).
 *
 * @returns {boolean} Always returns true
 */
const recompute = function () {
    // No-op: controller resets bound the accumulation window.
    // Without resets, sum drifts — but there is no ring buffer to re-sum from.
    return true;
}; // recompute()

export default recompute;

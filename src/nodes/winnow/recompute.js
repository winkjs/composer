/**
 * @fileoverview Recompute for winnow — no-op.
 *
 * Winnow's state is a reference trajectory (anchor + slope) and a
 * counter. No accumulated sums or running averages that could drift
 * due to floating-point error. Counter overflow is safe to 2^53
 * (at 20 kHz, that is 14 million years).
 */

const recompute = function () {
    return true;
}; // recompute()

export default recompute;

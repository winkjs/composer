/**
 * @fileoverview Reset for the unbalance node. Nothing accumulates — every
 * output is recomputed from scratch each tick — so reset is a no-op.
 */

const reset = function () {
    return true;
}; // reset()

export default reset;

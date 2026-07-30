/**
 * @fileoverview Recompute for the unbalance node. The computation is exact and
 * stateless — there is no incremental drift to correct — so recompute is a
 * no-op.
 */

const recompute = function () {
    return true;
}; // recompute()

export default recompute;

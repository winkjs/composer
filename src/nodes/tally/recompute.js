/**
 * @fileoverview Recompute for the tally node. The reduction is exact and
 * stateless — there is no incremental drift to correct — so recompute is a no-op.
 */

const recompute = function () {
    return true;
}; // recompute()

export default recompute;

/**
 * @fileoverview Recompute function for the transform node.
 *
 * No numerical stability concerns — the node is stateless with
 * no accumulators, running sums, or recursive filters.
 */

const recompute = function () {
    return true;
}; // recompute()

export default recompute;

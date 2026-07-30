/**
 * @fileoverview Recompute for categorize node.
 *
 * No-op: categorization is computed fresh from the input value on every
 * update — there is no accumulated state that can drift over time.
 */

const recompute = function () {
    // Nothing to recompute - categorization is stateless
    // No accumulations or numerical drift possible
    return true;
}; // recompute()

export default recompute;

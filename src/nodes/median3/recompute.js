/**
 * @fileoverview Recompute for median3 node.
 *
 * No-op: median is computed fresh from the raw ring buffer values on every
 * update — there is no accumulated state that can drift over time.
 */

const recompute = function () {
    return true;
}; // recompute()

export default recompute;

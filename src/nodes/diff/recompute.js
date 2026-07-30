/**
 * @fileoverview Recompute for diff node.
 *
 * No-op: difference is computed fresh from raw input values on every
 * update — there is no accumulated state that can drift over time.
 */

const recompute = function () {
    return true;
}; // recompute()

export default recompute;

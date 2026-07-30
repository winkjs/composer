/**
 * @fileoverview Recompute for invertFlag node.
 *
 * No-op: inversion is computed fresh from raw input on every update
 * — there is no accumulated state that can drift over time.
 */

const recompute = function () {
    return true;
}; // recompute()

export default recompute;

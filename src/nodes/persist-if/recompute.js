// nodes/persist-if/recompute.js

/**
 * @fileoverview Recompute function for persistIf node
 *
 * No numerical computation to stabilize.
 */

/**
 * Recompute for numerical stability.
 *
 * @param {Object} _state - Node state (unused)
 * @returns {boolean} Always true (no recomputation needed)
 */
const recompute = function ( _state ) {
    // No numerical computation to stabilize
    return true;
}; // recompute()

export default recompute;

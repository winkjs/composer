// nodes/accumulate/reset.js

/**
 * @fileoverview Resets the accumulate node state.
 *
 * Clears accumulated sum to zero. Called by controller triggers
 * to start a new accumulation window.
 *
 * @see ADR-004
 */

/**
 * Resets the accumulated sum to zero.
 *
 * @param {Object} state - Node state to reset
 * @returns {boolean} Always returns true (success)
 */
const reset = function ( state ) {
    // Reset accumulated sum to zero
    state.sum = 0;

    return true;
}; // reset()

export default reset;

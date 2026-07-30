// nodes/persist-if/reset.js

/**
 * @fileoverview Reset function for persistIf node
 *
 * Resets statistics and state tracking.
 */

/**
 * Reset node state.
 *
 * @param {Object} state - Node state
 * @returns {boolean} Always true (ADR-004; parity with emitIf)
 */
const reset = function ( state ) {
    // Reset statistics
    state.persistCount = 0;
    state.passCount = 0;
    state.lastPersistTime = null;
    state.persistErrors = 0;
    state.lastPersistError = null;
    state.lastPersistErrorCode = null;
    state.firstPersistError = null;
    state.firstPersistErrorCode = null;

    // Reset state tracking
    state.inErrorState = false;
    // Clear error suppression so next error episode is logged
    state.predicateErrorLogged = false;
    state.writeErrorLogged = false;

    return true;
}; // reset()

export default reset;

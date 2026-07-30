// nodes/pass-if/reset.js

/**
 * @fileoverview Reset function for passIf node
 *
 * Clears message counter and error suppression flag,
 * allowing counter-based predicates to restart.
 */

const reset = function ( state ) {
    // Reset counter to initial state
    state.counter = 0;
    // Clear error suppression so next error episode is logged
    state.predicateErrorLogged = false;
    return true;
}; // reset()

export default reset;

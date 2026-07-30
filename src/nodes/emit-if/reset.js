/**
 * @fileoverview Reset function for emitIf node
 *
 * Resets statistics and state tracking.
 */

const reset = function ( state ) {
    // Reset statistics
    state.emissionCount = 0;
    state.passCount = 0;
    state.lastEmissionTime = null;
    state.emissionErrors = 0;
    state.lastEmissionError = null;
    state.lastEmissionErrorCode = null;
    state.firstEmissionError = null;
    state.firstEmissionErrorCode = null;

    // Reset state tracking
    state.inErrorState = false;
    // Clear error suppression so next error episode is logged
    state.predicateErrorLogged = false;
    state.emitErrorLogged = false;

    return true;
}; // reset()

export default reset;

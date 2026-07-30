const reset = function ( state ) {
    // Stateless validation node - nothing to reset
    // Failure status is per-message, not accumulated

    state.failureReason = null;
    state.failedValue = null;
    // Clear error suppression so next error episode is logged
    state.predicateErrorLogged = false;
    state.tunableErrorLogged = false;

    return state;
}; // reset()

export default reset;

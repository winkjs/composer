// nodes/threshold/reset.js

const reset = function ( state ) {
    // Reset to initial conditions
    state.active = false;
    state.wasActive = false;
    state.hasSeenValue = false;
    // Clear error suppression so next error episode is logged
    state.tunableErrorLogged = false;

    return true;
}; // reset()

export default reset;

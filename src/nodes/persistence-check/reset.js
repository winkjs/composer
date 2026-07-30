// nodes/persistence-check/reset.js

const reset = function ( state ) {
    state.voteCount = 0;
    state.unvoteCount = 0;
    state.persistenceConfirmed = false;
    // Clear error suppression so next error episode is logged
    state.predicateErrorLogged = false;
    return state;
}; // reset()

export default reset;

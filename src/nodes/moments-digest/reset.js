// nodes/moments-digest/reset.js

const reset = function ( state ) {
    // Reset all statistical state
    state.n = 0;
    state.M1 = 0;
    state.M2 = 0;
    state.M3 = 0;
    state.M4 = 0;
    state.min = Infinity;
    state.max = -Infinity;

    // Reset window management
    state.currentCount = 0;
    state.windowComplete = false;

    return true;
}; // reset()

export default reset;

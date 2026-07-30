// nodes/tw-stats/reset.js

const reset = function ( state ) {
    state.n = 0;
    state.M1 = 0;
    state.M2 = 0;
    state.M3 = 0;
    state.M4 = 0;
    state.min = Infinity;
    state.max = -Infinity;
    state.currentCount = 0;

    return true;
}; // reset()

export default reset;

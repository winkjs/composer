const reset = function ( state ) {
    // Reset all fields to null (forces re-initialization)
    for ( let i = 0; i < state.fieldCount; i += 1 ) {
        const field = state.fieldNames[ i ];
        state.prevValues[ field ] = null;
    }

    // Reset counters and timing
    state.debounceCount = 0;
    state.stateStartTime = null;
    state.samplesInState = 0;


    state.dwellSamples = null;
    state.dwellTime = null;

    return state;
}; // reset()

export default reset;

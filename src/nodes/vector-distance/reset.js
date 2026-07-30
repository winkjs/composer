// nodes/vector-distance/reset.js

const reset = function ( state ) {
    // Reset all distance values
    state.distances.mad = 0;
    state.distances.rms = 0;
    state.distances.maximum = 0;
    state.distances.cosine = 0;
    state.distances.angular = 0;

    // Reset computation flag
    state.computed = false;

    // Reset workspace values
    state.accumulator.fill( 0 );

    return true;
}; // reset()

export default reset;

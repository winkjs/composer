const reset = function ( state ) {
    state.buffer.fill( 0 );
    // Next index to write into `[ 0..size-1 ]`.
    state.head   = 0;
    // Number of slots currently occupied (≤ size).
    state.used   = 0;

    return state;
}; // create()

export default reset;

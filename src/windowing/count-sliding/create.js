const create = function ( size ) {
    const state = Object.create( null );

    state.size = size;
    state.buffer = new Float64Array( state.size );
    // Explicitly initialize to `0`.
    state.buffer.fill( 0 );
    // Next index to write into `[ 0..size-1 ]`.
    state.head   = 0;
    // Number of slots currently occupied (≤ size).
    state.used   = 0;

    return state;
}; // create()

export default create;

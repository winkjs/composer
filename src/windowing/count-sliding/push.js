const push = function ( state, value ) {
    // If buffer not yet full, return `undefined`; else return the overwritten slot.
    const evicted = ( state.used < state.size ) ? undefined : state.buffer[ state.head ];
    // Overwrite at head index.
    state.buffer[ state.head ] = value;
    // Advance head, wrapping around; modulus is slower i.e. `head = ( head + 1 ) % size`.
    state.head += 1;
    if ( state.head === state.size ) state.head = 0;
    // Track occupancy until full.
    if ( state.used < state.size ) state.used += 1;

    return evicted;
}; // push()

export default push;

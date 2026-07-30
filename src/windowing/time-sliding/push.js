const push = function ( state, value, msg ) {
    const timestamp = state.getTime( msg );
    const cutoff = timestamp - state.duration;

    const evicted = [];

    // Evict values outside [cutoff, timestamp)
    while ( state.count > 0 && state.timestamps[ state.tail ] < cutoff ) {
        evicted.push({
            timestamp: state.timestamps[ state.tail ],
            value: state.values[ state.tail ]
        });

        state.tail += 1;
        if ( state.tail >= state.size ) state.tail = 0;
        state.count -= 1;
    }

    // Add new value
    state.timestamps[ state.head ] = timestamp;
    state.values[ state.head ] = value;

    state.head += 1;
    if ( state.head >= state.size ) state.head = 0;
    state.count += 1;

    // Handle overflow
    if ( state.count > state.size ) {
        evicted.push({
            timestamp: state.timestamps[ state.tail ],
            value: state.values[ state.tail ]
        });

        state.tail += 1;
        if ( state.tail >= state.size ) state.tail = 0;
        state.count = state.size;
    }

    return evicted;
}; // push()

export default push;

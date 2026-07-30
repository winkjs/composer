const create = function ( spec ) {
    const state = Object.create( null );

    state.duration = spec.duration;
    state.size = spec.maxSize || 8192;

    // Ring buffer storage
    state.timestamps = new Float64Array( state.size );
    state.values = new Float64Array( state.size );
    state.head = 0;
    state.tail = 0;
    state.count = 0;

    // Time extraction
    if ( spec.timeStrategy === 'eventTime' ) {
        const field = spec.timeField || 'timestamp';
        state.getTime = ( msg ) => msg[ field ];
    } else {
        state.getTime = () => Date.now();
    }

    return state;
}; // create()

export default create;

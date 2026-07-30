// nodes/csv-source/update.js
const update = function ( state, msg ) {
    // Source nodes are special - they generate messages
    // The msg parameter here is typically a trigger/timer signal

    if ( !state.isLoaded || state.isPaused ) {
        return null;  // Nothing to emit
    }

    if ( state.currentIndex >= state.data.length ) {
        if ( state.loop ) {
            state.currentIndex = 0;  // Reset to beginning
        } else {
            state.isPaused = true;  // Stop emitting
            return null;
        }
    }

    // Rate limiting for stream mode
    if ( state.mode === 'stream' ) {
        const now = Date.now();
        const timeSinceLastEmit = now - state.lastEmitTime;
        const minInterval = 1000 / state.rate;

        if ( timeSinceLastEmit < minInterval ) {
            return null;  // Too soon, skip this update
        }

        state.lastEmitTime = now;
    }

    // Get next row
    const row = state.data[ state.currentIndex ];
    state.currentIndex += 1;

    // Create output message
    const output = Object.create( null );

    // Add metadata
    output._source = {
        type: 'csv',
        index: state.currentIndex - 1,
        total: state.data.length,
        timestamp: Date.now()
    };

    // Map columns
    if ( state.columns === 'auto' ) {
        // Use all columns as-is
        Object.assign( output, row );
    } else {
        // Custom column mapping
        for ( const [ csvCol, msgField ] of Object.entries( state.columns ) ) {
            if ( row.hasOwnProperty( csvCol ) ) {
                output[ msgField ] = row[ csvCol ];
            }
        }
    }

    return output;  // This will be the new message
}; // update()

export default update;

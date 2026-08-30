// core/batch/sliding-window.js
// Purpose:
//   Fixed-capacity sliding window for retaining recent data snapshots.
//   Designed for "first paint" scenarios where new subscribers need recent history.
//   Maintains a circular buffer of rows with stable object shapes.

export const createWindow = function ( capacity, fieldOrder ) {
    // Input validation
    if ( !capacity || capacity <= 0 ) {
        throw new Error( 'winkComposer/batch: capacity must be positive integer' );
    }
    if ( !Array.isArray( fieldOrder ) || fieldOrder.length === 0 ) {
        throw new Error( 'winkComposer/batch: fieldOrder must be non-empty array' );
    }

    // Pre-allocate all row objects with stable shape
    const rows = new Array( capacity );
    for ( let i = 0; i < capacity; i += 1 ) {
        const r = Object.create( null );
        // Initialize all fields to null for consistent shape
        for ( let k = 0; k < fieldOrder.length; k += 1 ) {
            r[ fieldOrder[ k ] ] = null;
        }
        rows[ i ] = r;
    }

    // Circular buffer state:
    // - head: next write position [0, capacity)
    // - count: total items in window (capped at capacity)
    let head = 0;
    let count = 0;

    /**
     * Add a new row to the window, evicting oldest if at capacity.
     */
    const put = function ( src ) {
        // Get pre-allocated row at current position
        const dst = rows[ head ];

        // Copy only declared fields in order
        for ( let k = 0; k < fieldOrder.length; k += 1 ) {
            const key = fieldOrder[ k ];
            const v = src[ key ];
            // FIXED: Normalize undefined to null for consistent serialization
            dst[ key ] = ( v === undefined ) ? null : v;
        }

        // Advance head with wraparound
        head = ( head + 1 ) % capacity;

        // Track fill level (stops growing at capacity)
        if ( count < capacity ) count += 1;
    };

    /**
     * Extract recent rows from window in FIFO order (oldest to newest).
     * Returns the most recent 'max' rows or all available rows if less than max.
     */
    const toRows = function ( out, max ) {
        // Determine how many rows we can actually provide
        const take = Math.min( count, max );

        if ( take === 0 ) return 0;

        // Calculate starting position for oldest data we want to return
        let idx;
        if ( count < capacity ) {
            // Window not full: we have 'count' items starting from 0
            // To get the most recent 'take' items, start from (count - take)
            idx = Math.max( 0, count - take );
        } else {
            // Window full: head points to next write position (oldest data)
            // To get the most recent 'take' items, go back 'take' positions
            idx = ( head - take + capacity ) % capacity;
        }

        // Copy row references to output array in chronological order
        for ( let i = 0; i < take; i += 1 ) {
            out[ i ] = rows[ idx ];
            idx = ( idx + 1 ) % capacity;
        }

        return take;
    };

    // Public API
    return {
        put: put,
        toRows: toRows
    };
};

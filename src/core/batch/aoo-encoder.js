// core/batch/aoo-encoder/index.js
// Purpose:
//   Array-of-Objects (AoO) encoder for efficient batch transmission of tabular data.
//   Optimized for downsampled time-series data where rows have consistent shape.
//   Designed to work with msgpackr's structure learning for maximum compression.
//
// Design Philosophy:
//   - Zero allocations in hot path - reuse all objects and arrays
//   - Stable object shapes - enables msgpackr structure learning
//   - Predictable field order - consistent compression ratios
//   - Null preservation - maintains shape even with missing data
//
// Use Case:
//   Downsampled sensor data often arrives as rows of readings:
//   [{ timestamp: 1234, temp: 23.5, pressure: 101.3 }, ...]
//   This encoder batches these rows efficiently for MQTT transmission.
//
// Compression Strategy:
//   By maintaining stable object shapes and field order, msgpackr learns the
//   structure after ~5 messages. Subsequent messages only send structure ID + values,
//   achieving 80-90% size reduction compared to JSON.

/**
 * Create an Array-of-Objects encoder for batch data transmission.
 *
 * @param {Object} options - Encoder configuration
 * @param {number} options.maxRows - Maximum rows per batch (pre-allocation size)
 * @param {string[]} options.fieldOrder - Field names in consistent order
 * @param {Object} options.codec - Codec instance from createCodec()
 *
 * @returns {Object} Encoder with encode() method and fieldOrder reference
 *
 * @example
 * const encoder = createAooEncoder({
 *   maxRows: 100,
 *   fieldOrder: ['timestamp', 'temperature', 'pressure'],
 *   codec: msgpackCodec
 * });
 *
 * const { payload, props } = encoder.encode('sensor-01', 1, readings, 50);
 * mqttClient.publish('telemetry/batch', payload, { properties: props });
 */
export const createAooEncoder = function ( { maxRows, fieldOrder, codec } ) {
    // Input validation - fail fast on misconfiguration
    if ( !Array.isArray( fieldOrder ) || fieldOrder.length === 0 ) {
        throw new Error( 'fieldOrder must be non-empty array of field names' );
    }
    if ( !maxRows || maxRows <= 0 ) {
        throw new Error( 'maxRows must be positive integer' );
    }
    if ( !codec || typeof codec.pack !== 'function' ) {
        throw new Error( 'codec must have pack() method');
    }

    // Pre-allocate row objects with stable shape.
    // Critical for msgpackr structure learning:
    // - Same fields in same order = same structure ID
    // - null instead of undefined = consistent serialization
    // - Object.create(null) = no prototype pollution
    const rows = new Array( maxRows );
    for ( let i = 0; i < maxRows; i += 1 ) {
        const r = Object.create( null );
        // Initialize all fields to null (not undefined!)
        // This ensures consistent object shape even when values are missing
        for ( let k = 0; k < fieldOrder.length; k += 1 ) {
            r[ fieldOrder[ k ] ] = null;
        }
        rows[ i ] = r;
    }

    // Pre-allocate batch array that references row objects.
    // We'll adjust its length per batch but never reallocate.
    // slice() here is a one-time shallow copy of references.
    const batch = rows.slice();

    // Cache MQTT properties to avoid repeated calls.
    // These properties hint the wire format to subscribers.
    const props = codec.properties || {};

    /**
     * Encode source rows into a compressed batch payload.
     *
     * Design decisions:
     *   - Copy values field-by-field to maintain stable shape
     *   - Preserve null but normalize undefined to null
     *   - Reuse pre-allocated objects to avoid GC
     *   - Temporarily adjust batch.length without reallocation
     *
     * @param {string} producerId - Identifies the data source (e.g., device ID)
     * @param {number} seq - Sequence number for gap detection on receiver side
     * @param {Array} srcRows - Source rows to encode (not modified)
     * @param {number} count - Number of rows to encode (may be < srcRows.length)
     *
     * @returns {Object} { payload: Uint8Array|Buffer, props: Object }
     *                   payload: Compressed binary data
     *                   props: MQTT v5 properties for content type hint
     */
    const encode = function ( producerId, seq, srcRows, count ) {
        // Validate count doesn't exceed pre-allocated capacity
        if ( count > maxRows ) {
            throw new Error( `Cannot encode ${count} rows, max capacity is ${maxRows}` );
        }

        // Copy source data into pre-allocated row objects
        for ( let i = 0; i < count; i += 1 ) {
            const src = srcRows[ i ];
            const dst = rows[ i ];

            // Copy only declared fields in consistent order
            for ( let k = 0; k < fieldOrder.length; k += 1 ) {
                const key = fieldOrder[ k ];
                const v = src[ key ];
                // FIXED: Normalize undefined to null for consistent serialization
                dst[ key ] = ( v === undefined ) ? null : v;
            }

            // Point batch array to this row (reference, not copy)
            batch[ i ] = dst;
        }

        // Temporarily adjust batch length for this encoding
        const cap = batch.length;
        batch.length = count;

        // Pack the message with consistent structure
        const payload = codec.pack( {
            producerId: producerId,
            seq: seq,
            items: batch
        } );

        // Restore batch array to full capacity for next call
        batch.length = cap;

        return {
            payload: payload,
            props: props
        };
    }; // encode()

    // Public API
    // Expose encode function and field order for reference.
    // slice() returns a defensive copy of fieldOrder.
    return {
        encode: encode,
        fieldOrder: fieldOrder.slice()
    };
};

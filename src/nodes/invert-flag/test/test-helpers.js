// Shared test fixtures and factory functions for invertFlag node tests.

// ── Reusable spec template ────────────────────────────────────────

export const INVERT_SPEC = {
    nodeType: 'Invert Flag',
    name: 'test',
    from: { x: 'flag' },
    stats: { inverted: { storeAs: 'out' } }
};

// ── Message factory ───────────────────────────────────────────────

/**
 * Creates a test message with null prototype.
 * @param {Object} values - Key-value pairs for message fields
 * @returns {Object} Message object
 */
export const createMessage = function ( values ) {
    const msg = Object.create( null );
    Object.keys( values ).forEach( ( key ) => {
        msg[ key ] = values[ key ];
    } );
    return msg;
};

// Shared test fixtures for es-correlation node tests.
// Provides factory functions and constants reused across test files.

/**
 * Build a message object with two keyed fields.
 * Uses Object.create( null ) for prototype-free message objects.
 * @param {string} xKey - Key for the x value.
 * @param {string} yKey - Key for the y value.
 * @param {number} [x] - Value for x (omitted if undefined).
 * @param {number} [y] - Value for y (omitted if undefined).
 * @returns {object} Message object.
 */
export const buildMsg = function ( xKey, yKey, x, y ) {
    const m = Object.create( null );
    if ( x !== undefined ) m[ xKey ] = x;
    if ( y !== undefined ) m[ yKey ] = y;
    return m;
};

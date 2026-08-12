/**
 * @fileoverview Terminal color for the scaffolder, built on
 * node:util's styleText so the zero-dependency rule holds. Color
 * applies only when the target stream is an interactive terminal
 * that reports color support. hasColors() honours NO_COLOR inside
 * Node, so this module never reads the environment itself.
 */

import * as nodeUtil from 'node:util';

/**
 * Colors text for a stream, or returns it unchanged when the stream
 * is not an interactive color terminal.
 *
 * @param {object} stream - The stream the text will be written to.
 * @param {string|string[]} format - A styleText format, e.g. 'green'.
 * @param {string} text - The text to color.
 * @returns {string} Colored or plain text.
 */
const paint = function ( stream, format, text ) {
    const colorable = Boolean( stream.isTTY ) &&
        ( typeof stream.hasColors === 'function' ) &&
        stream.hasColors();
    if ( colorable ) {
        return nodeUtil.styleText( format, text, { validateStream: false } );
    }
    return text;
}; // paint()

export { paint };

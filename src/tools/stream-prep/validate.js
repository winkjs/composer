// src/tools/stream-prep/validate.js

/**
 * @fileoverview Shared init-time validation helpers for the stream-preparation
 * utilities. Nothing here runs on the hot path — every helper is called once,
 * inside a factory, and throws immediately with the calling utility's name
 * leading the message, so a bad config names its own site (fail-fast, the
 * ADR-025 family contract; same error style as the training utilities).
 */

const MINUTES_PER_DAY = 1440;

/**
 * Resolve an optional field-name option: undefined takes the fallback; the
 * result must be a non-empty string.
 *
 * @param {*} value - the option as given
 * @param {string} fallback - default when the option is undefined
 * @param {string} ctx - calling utility name, for the error message
 * @param {string} name - option name, for the error message
 * @returns {string} the validated field name
 */
const fieldNameOr = function ( value, fallback, ctx, name ) {
    const out = ( value === undefined ) ? fallback : value;
    if ( ( typeof out !== 'string' ) || ( out === '' ) ) {
        throw new Error( 'winkComposer/' + ctx + ': ' + name + ' must be a non-empty string.' );
    }
    return out;
}; // fieldNameOr()

/**
 * Resolve an optional numeric option: undefined takes the fallback; the
 * result must be a finite number.
 *
 * @param {*} value - the option as given
 * @param {number} fallback - default when the option is undefined
 * @param {string} ctx - calling utility name, for the error message
 * @param {string} name - option name, for the error message
 * @returns {number} the validated number
 */
const finiteNumberOr = function ( value, fallback, ctx, name ) {
    const out = ( value === undefined ) ? fallback : value;
    if ( ( typeof out !== 'number' ) || !Number.isFinite( out ) ) {
        throw new Error( 'winkComposer/' + ctx + ': ' + name + ' must be a finite number.' );
    }
    return out;
}; // finiteNumberOr()

/**
 * Validate a shift schedule's boundary list: a non-empty array of strictly
 * ascending minutes-of-day, each in [0, 1440). Returns a private copy so the
 * caller's hot path cannot be disturbed by later mutation of the original.
 *
 * @param {*} boundariesMin - the option as given
 * @param {string} ctx - calling utility name, for the error message
 * @returns {number[]} a validated private copy
 */
const validatedBoundaries = function ( boundariesMin, ctx ) {
    if ( !Array.isArray( boundariesMin ) || ( boundariesMin.length === 0 ) ) {
        throw new Error( 'winkComposer/' + ctx + ': boundariesMin must be a non-empty array.' );
    }
    let prev = -1;
    for ( let i = 0; i < boundariesMin.length; i += 1 ) {
        const b = boundariesMin[ i ];
        if ( ( typeof b !== 'number' ) || !Number.isFinite( b ) || ( b < 0 ) || ( b >= MINUTES_PER_DAY ) ) {
            throw new Error( 'winkComposer/' + ctx + ': each boundary must be a minute-of-day in [0, 1440).' );
        }
        if ( b <= prev ) {
            throw new Error( 'winkComposer/' + ctx + ': boundariesMin must be strictly ascending.' );
        }
        prev = b;
    }
    return boundariesMin.slice();
}; // validatedBoundaries()

export { fieldNameOr, finiteNumberOr, validatedBoundaries };

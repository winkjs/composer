// src/tools/stream-prep/coerce-numeric.js

/**
 * @fileoverview coerceNumeric — a stream-preparation utility for a source's
 * `transform` option. Given a fixed list of fields, it rewrites each field on
 * the message to a clean finite number or NaN, in place, allocating nothing
 * per message.
 *
 * Why it exists: raw feeds (CSV replay, MQTT, a historian export) deliver
 * blanks, empty strings, and out-of-range collector garbage mixed with real
 * numbers. A downstream node's NaN-skip only works if "no value" reads as
 * NaN, never 0 — and `Number( '' )` is 0 and `Number( null )` is 0, so a
 * naive coercion silently invents zeros where data is missing. This maps
 * every not-a-real-number to NaN explicitly, so a blank stays a blank.
 *
 * Scope is deliberately narrow and field-agnostic: it does NOT know any
 * field's physical range. Field-specific validity (a -9999 code, a bath
 * below 5 degC) is the `sanitize` node's job in the flow (the ADR-018
 * boundary: a bad value in a parseable record is the pipeline's concern).
 * This utility only guarantees the value is a finite number or NaN, plus an
 * optional magnitude cut (`sentinelAbs`) for the huge collector garbage
 * (e.g. 3.4e38) that is invalid for every field.
 *
 * Family contract (ADR-025, stream-preparation utilities): configuration is
 * captured once at init; the returned function mutates the message in place,
 * creates no objects per message, and returns the same reference, so it
 * drops straight into a source `transform` slot ( row -> row ).
 */

/**
 * Coerce one raw cell to a number or NaN, without allocating. Empty string and
 * null/undefined are "no value" -> NaN (never 0). A numeric string parses; a
 * boolean maps to 1/0; anything unparseable is NaN.
 *
 * Known limitation: a whitespace-only string ( '   ' ) coerces to 0, matching
 * `Number`'s own behaviour — detecting it would cost a per-cell allocation, and
 * real feeds use '' or null for a missing cell. Add such tokens upstream if a
 * feed genuinely encodes missing as whitespace.
 *
 * @param {*} value - the raw cell
 * @returns {number} a number, possibly NaN
 */
const coerceCell = function ( value ) {
    if ( typeof value === 'number' ) {
        return value;
    }
    if ( ( value === null ) || ( value === undefined ) || ( value === '' ) ) {
        return NaN;
    }
    return Number( value );
}; // coerceCell()

/**
 * Build an in-place numeric coercer for a fixed set of fields.
 *
 * @param {string[]} fields - message fields to coerce (non-empty array of
 *     non-empty strings; validated at init, fail-fast)
 * @param {Object} [options]
 * @param {number} [options.sentinelAbs] - if set, any coerced value whose
 *     magnitude is at or above this becomes NaN. A cut for universally-invalid
 *     collector garbage, NOT a per-field physical range (that lives in sanitize).
 * @returns {function( Object ): Object} transform( msg ) -> msg, mutated in place
 */
const coerceNumeric = function ( fields, options ) {
    if ( !Array.isArray( fields ) || ( fields.length === 0 ) ) {
        throw new Error( 'winkComposer/coerceNumeric: fields must be a non-empty array.' );
    }
    for ( let i = 0; i < fields.length; i += 1 ) {
        if ( ( typeof fields[ i ] !== 'string' ) || ( fields[ i ] === '' ) ) {
            throw new Error( 'winkComposer/coerceNumeric: every field must be a non-empty string.' );
        }
    }
    const opts = options || {};
    const sentinelAbs = ( opts.sentinelAbs === undefined ) ? Infinity : opts.sentinelAbs;
    if ( ( typeof sentinelAbs !== 'number' ) || Number.isNaN( sentinelAbs ) || ( sentinelAbs <= 0 ) ) {
        throw new Error( 'winkComposer/coerceNumeric: sentinelAbs must be a positive number.' );
    }
    // Private copy so the caller cannot mutate the field list after init; index
    // iteration over a stable local keeps the hot path free of iterator objects.
    const fieldList = fields.slice();
    const n = fieldList.length;

    return function ( msg ) {
        for ( let i = 0; i < n; i += 1 ) {
            const field = fieldList[ i ];
            const num = coerceCell( msg[ field ] );
            msg[ field ] = ( Number.isFinite( num ) && ( Math.abs( num ) < sentinelAbs ) ) ? num : NaN;
        }
        return msg;
    };
}; // coerceNumeric()

export { coerceCell, coerceNumeric };
export default coerceNumeric;

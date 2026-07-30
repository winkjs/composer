/**
 * @fileoverview Deep clone utility for groupBy template expansion.
 *
 * Clones spec objects while preserving:
 * - Functions (predicates, tunables) - kept by reference
 * - RegExp objects - properly cloned
 * - undefined values - preserved
 * - Nested objects/arrays - recursively cloned
 *
 * Used during `.endGroup()` to create independent spec copies for each
 * group value without sharing mutable state.
 */

/**
 * Deep clones a value, preserving functions by reference.
 *
 * @param {*} value - Value to clone
 * @returns {*} Cloned value (functions returned by reference)
 */
const deepCloneValue = function ( value ) {
    // Null and undefined pass through
    if ( value === null || value === undefined ) {
        return value;
    }

    const type = typeof value;

    // Functions - keep reference (tunables, predicates)
    if ( type === 'function' ) {
        return value;
    }

    // Primitives (string, number, boolean, symbol, bigint)
    if ( type !== 'object' ) {
        return value;
    }

    // RegExp - clone properly
    if ( value instanceof RegExp ) {
        // eslint-disable-next-line security/detect-non-literal-regexp -- cloning an existing RegExp; source/flags come from the object being cloned, not user input
        return new RegExp( value.source, value.flags );
    }

    // Arrays - recurse
    if ( Array.isArray( value ) ) {
        const result = [];
        for ( let i = 0; i < value.length; i += 1 ) {
            result.push( deepCloneValue( value[ i ] ) );
        }
        return result;
    }

    // Objects - use null prototype for safety
    const result = Object.create( null );
    const keys = Object.keys( value );
    for ( let i = 0; i < keys.length; i += 1 ) {
        const key = keys[ i ];
        result[ key ] = deepCloneValue( value[ key ] );
    }

    return result;
};

export { deepCloneValue };

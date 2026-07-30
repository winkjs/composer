/**
 * General-purpose validators
 * Reusable validation functions for common patterns
 */

/**
 * Validates JavaScript identifiers
 */
const identifier = function ( value ) {
    return typeof value === 'string' && ( /^[a-zA-Z_$][a-zA-Z0-9_$]*$/ ).test( value );
}; // identifier()

/**
 * Validates non-empty string with no whitespace characters.
 * Rejects empty strings and strings containing spaces, tabs, or newlines.
 */
const noSpaces = function ( value ) {
    return typeof value === 'string' && value.length > 0 && !( /\s/ ).test( value );
}; // noSpaces()

/**
 * Creates a range validator
 */
const inRange = function ( min, max ) {
    return function ( value ) {
        return typeof value === 'number' && value >= min && value <= max;
    };
}; // inRange()

/**
 * Creates an enum validator
 */
const oneOf = function ( options ) {
    return function ( value ) {
        return options.includes( value );
    };
}; // oneOf()

/**
 * Creates a pattern validator
 */
const matches = function ( pattern ) {
    return function ( value ) {
        return typeof value === 'string' && pattern.test( value );
    };
}; // matches()

/**
 * Validates positive numbers
 */
const positive = function ( value ) {
    return typeof value === 'number' && value > 0;
}; // positive()

/**
 * Validates non-negative numbers
 */
const nonNegative = function ( value ) {
    return typeof value === 'number' && value >= 0;
}; // nonNegative()

/**
 * Validates non-negative finite numbers (rejects NaN, Infinity).
 */
const nonNegativeFinite = function ( value ) {
    return typeof value === 'number' && Number.isFinite( value ) && value >= 0;
}; // nonNegativeFinite()

/**
 * Validates integers
 */
const integer = function ( value ) {
    return Number.isInteger( value );
}; // integer()

/**
 * Validates positive integers
 */
const positiveInteger = function ( value ) {
    return Number.isInteger( value ) && value > 0;
}; // positiveInteger()

/**
 * Validates value is a finite number (not NaN, not Infinity).
 */
const isFinite = function ( value ) {
    return typeof value === 'number' && Number.isFinite( value );
}; // isFinite()

/**
 * Validates non-negative finite numbers OR functions (for tunable support).
 */
const nonNegativeOrFunction = function ( value ) {
    if ( typeof value === 'function' ) return true;
    return typeof value === 'number' && Number.isFinite( value ) && value >= 0;
}; // nonNegativeOrFunction()

/**
 * Validates positive finite numbers OR functions (for tunable support).
 */
const positiveOrFunction = function ( value ) {
    if ( typeof value === 'function' ) return true;
    return typeof value === 'number' && Number.isFinite( value ) && value > 0;
}; // positiveOrFunction()

/**
 * Validates nonzero numbers
 */
const nonZero = function ( value ) {
    return typeof value === 'number' && value !== 0;
}; // nonZero()

/**
 * Validates non-empty strings
 */
const nonEmptyString = function ( value ) {
    return typeof value === 'string' && value.length > 0;
}; // nonEmptyString()

/**
 * Validates string representations of non-negative integers ("0", "1", "123")
 * Used for enum keys which must be numeric string indices.
 * Rejects leading zeros (e.g., "01", "007") to enforce canonical representation.
 */
const integerString = function ( value ) {
    if ( typeof value !== 'string' ) return false;
    if ( value.length === 0 ) return false;
    // Must be digits only
    if ( !( /^\d+$/ ).test( value ) ) return false;
    // No leading zeros except for "0" itself
    if ( value.length > 1 && value[ 0 ] === '0' ) return false;
    return true;
}; // integerString()

/**
 * Validates string representations of finite numbers.
 * Accepts: "0", "-1", "3.14", "-2.5"
 * Rejects: "", "NaN", "Infinity", "3.14.5", "abc"
 * Uses roundtrip validation: String(Number(value)) === value
 */
const numericString = function ( value ) {
    if ( typeof value !== 'string' || value.length === 0 ) return false;
    const num = Number( value );
    if ( !Number.isFinite( num ) ) return false;
    // Roundtrip validation ensures canonical form
    return String( num ) === value;
}; // numericString()

/**
 * Validates boolean string literals.
 * Accepts: exactly "true" or "false"
 */
const booleanString = function ( value ) {
    return value === 'true' || value === 'false';
}; // booleanString()

// Export all validators
export const validators = {
    identifier,
    noSpaces,
    inRange,
    oneOf,
    matches,
    positive,
    nonNegative,
    nonNegativeFinite,
    integer,
    positiveInteger,
    nonZero,
    isFinite,
    nonNegativeOrFunction,
    positiveOrFunction,
    nonEmptyString,
    integerString,
    numericString,
    booleanString
};

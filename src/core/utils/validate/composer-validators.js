/**
 * WinkComposer-specific validators
 * Domain-specific validation functions for streaming analytics nodes
 */

import { validators } from './validators.js';

/**
 * Validates node field specification
 */
const nodeField = function ( value ) {
    return typeof value === 'object' &&
           value !== null &&
           typeof value.field === 'string' &&
           value.field.length > 0 &&
           validators.identifier( value.field );
}; // nodeField()

/**
 * Validates trigger specification
 */
const trigger = function ( value ) {
    if ( typeof value !== 'object' || value === null ) return false;

    // Control must be a valid method name
    if ( typeof value.control !== 'string' || !validators.identifier( value.control ) ) {
        return false;
    }

    // Targets must be an array of valid identifiers
    if ( !Array.isArray( value.targets ) || value.targets.length === 0 ) {
        return false;
    }

    return value.targets.every( ( target ) =>
        typeof target === 'string' && validators.identifier( target )
    );
}; // trigger()

/**
 * Validates statistical output specification
 */
const statSpec = function ( value ) {
    return typeof value === 'object' &&
           value !== null &&
           typeof value.storeAs === 'string' &&
           validators.identifier( value.storeAs );
}; // statSpec()

/**
 * Validates predicate function
 */
const predicate = function ( value ) {
    return typeof value === 'function' && value.length === 1;
}; // predicate()

/**
 * Validates EWMA alpha parameter
 */
const alpha = function ( value ) {
    return typeof value === 'number' && value > 0 && value < 1;
}; // alpha()

/**
 * Validates EWMA half-life parameter
 */
const halfLife = function ( value ) {
    return typeof value === 'number' && value > 0 && value < 999999;
}; // alpha()

/**
 * Validates window size
 */
const windowSize = function ( value ) {
    return Number.isInteger( value ) && value > 0;
}; // windowSize()

/**
 * Validates decay factor (for exponential decay)
 */
const decayFactor = function ( value ) {
    return typeof value === 'number' && value > 0 && value < 1;
}; // decayFactor()

/**
 * Validates threshold specification
 */
const threshold = function ( value ) {
    return typeof value === 'number' && !Number.isNaN( value );
}; // threshold()

/**
 * Validates statistical method names
 */
const statMethod = function ( value ) {
    const validMethods = [
        'mean', 'variance', 'stddev', 'sum', 'count',
        'min', 'max', 'range', 'skewness', 'kurtosis'
    ];
    return typeof value === 'string' && validMethods.includes( value );
}; // statMethod()

/**
 * Validates node type specification
 */
const nodeType = function ( value ) {
    return typeof value === 'string' &&
           value.length > 0 &&
           value.length <= 50; // Reasonable limit for node type names
}; // nodeType()

/**
 * Cross-field validator to prevent self-triggering
 * Ensures a node doesn't list itself in trigger targets
 */
const noSelfTriggers = {
    fields: [ 'name', 'triggers' ],
    validator: ( spec ) => {
        if ( !spec.triggers ) return true;
        return spec.triggers.every( ( trgr ) =>
            !trgr.targets.includes( spec.name )
        );
    },
    error: 'composer/validation: Node cannot trigger control methods on itself'
}; // noSelfTriggers

// Export all composer validators
export const composerValidators = {
    nodeField,
    trigger,
    statSpec,
    predicate,
    alpha,
    halfLife,
    windowSize,
    decayFactor,
    threshold,
    statMethod,
    nodeType,
    noSelfTriggers
};

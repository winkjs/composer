/* eslint-disable no-underscore-dangle */
/**
 * Core validation logic
 * Validates objects against schema definitions with composable validators
 */

import { validateField } from './helpers.js';

const VALIDATION_VERSION = '1.0.0';

/**
 * Runs cross-field validators
 */
const runCrossFieldValidators = function ( object, validators ) {
    const errors = [];

    validators.forEach( ( { fields, validator, error } ) => {
        try {
            const isValid = validator( object );
            if ( !isValid ) {
                errors.push( error );
            }
        } catch ( e ) {
            const fieldList = fields.join( ', ' );
            errors.push( `Cross-field validation (${fieldList}) threw error: ${e.message}` );
        }
    } );

    return errors;
}; // runCrossFieldValidators()

/**
 * Validates an object against a schema definition
 * @param {Object} schema - Schema definition with field specifications
 * @param {Object} object - Object to validate
 * @param {string} pathPrefix - Prefix for error paths (e.g., 'spec')
 * @returns {Object} Validation result with valid flag, errors array, and throwIfInvalid method
 */
const validateWithSchema = function ( schema, object, pathPrefix = 'object' ) {
    const errors = [];

    // Validate each field defined in schema
    Object.entries( schema ).forEach( ( [ key, fieldSchema ] ) => {
        // Skip special keys
        if ( key.startsWith( '_' ) ) return;

        const fieldPath = `${pathPrefix}.${key}`;

        // Check required fields
        if ( fieldSchema.required && !(key in object) ) {
            errors.push( `${fieldPath}: Required field missing` );
            return; // Skip further validation for missing required fields
        }

        // Validate present fields
        if ( key in object ) {
            const fieldErrors = validateField(
                object[ key ],
                fieldSchema,
                fieldPath,
                object // Pass full object for cross-references
            );
            errors.push( ...fieldErrors );
        }
    } );

    // Check for unknown properties at top level
    if ( schema._propertyNames ) {
        const allowedKeys = new Set( schema._propertyNames );
        const objectKeys = Object.keys( object );
        for ( let i = 0; i < objectKeys.length; i += 1 ) {
            const key = objectKeys[ i ];
            if ( !allowedKeys.has( key ) ) {
                errors.push( `${pathPrefix}: Unknown property '${key}'` );
            }
        }
    }

    // Run cross-field validators only if field validation passed
    if ( errors.length === 0 && schema._crossFieldValidators ) {
        const crossFieldErrors = runCrossFieldValidators(
            object,
            schema._crossFieldValidators
        );
        errors.push( ...crossFieldErrors );
    }

    // Build result object
    const valid = errors.length === 0;

    return {
        valid,
        errors,
        version: VALIDATION_VERSION,
        // Throw if invalid - used in init functions
        throwIfInvalid: ( nodeType ) => {
            if ( !valid ) {
                const errorMessage = `WinkComposer/${nodeType} validation failed:\n  ${errors.join( '\n  ' )}`;
                throw new TypeError( errorMessage );
            }
        }
    };
}; // validateWithSchema()

// Export the function directly
export default validateWithSchema;
export { validateWithSchema };

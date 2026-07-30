/**
 * Helper functions for validation
 * Internal utilities used by the main validation logic
 */

import { typeValidators, FIELD_KEYED_TYPES } from './type-validators.js';
// Lazy reference: imports validateWithSchema indirectly to avoid the
// helpers.js ↔ validate.js circular dependency. ES modules handle the
// cycle correctly at runtime since validateWithSchema is only called
// inside a function body (after both modules have fully loaded).
import { validateWithSchema } from './validate.js';

/**
 * Checks exact value match
 */
const checkExactValue = function ( value, schema, path ) {
    if ( schema.value !== undefined && value !== schema.value ) {
        return [ `${path}: Must be exactly '${schema.value}', got '${value}'` ];
    }
    return [];
}; // checkExactValue()

/**
 * Runs the custom validator on a single value.
 *
 * @param {boolean} prefixError - When true, the friendly `schema.error` is prefixed
 *   with the path so a per-field failure names the field. When false (the direct
 *   case) the message is left exactly as before for backward compatibility.
 */
const runOneValidator = function ( value, schema, path, fullObject, prefixError ) {
    try {
        const isValid = schema.validator( value, fullObject );
        if ( !isValid ) {
            if ( prefixError ) {
                return [ `${path}: ${schema.error || 'Validation failed'}` ];
            }
            return [ schema.error || `${path}: Validation failed` ];
        }
    } catch ( e ) {
        return [ `${path}: Validator threw error: ${e.message}` ];
    }

    return [];
}; // runOneValidator()

/**
 * Runs a custom validator function.
 *
 * A custom validator describes ONE field's value (e.g. "is a positive integer",
 * "is a known preset name"). When the option is given as a field-keyed map — one
 * entry per field, the shape a field-keyed-capable type accepts — the validator must
 * run on each entry's value, not on the whole map. Running it on the whole map would
 * hand a scalar check (`positive`, `oneOf`, ...) the map object, which always fails,
 * wrongly rejecting a spec the runtime resolves correctly.
 *
 * Direct values and top-level functions (tunables) are not plain objects, so they
 * run on the whole value exactly as before.
 */
const runCustomValidator = function ( value, schema, path, fullObject ) {
    if ( !schema.validator || value === undefined ) {
        return [];
    }

    const isFieldKeyedMap = FIELD_KEYED_TYPES.has( schema.type ) &&
        typeof value === 'object' && value !== null && !Array.isArray( value );

    if ( isFieldKeyedMap ) {
        const errors = [];
        const keys = Object.keys( value );
        for ( let i = 0; i < keys.length; i += 1 ) {
            const key = keys[ i ];
            errors.push(
                ...runOneValidator( value[ key ], schema, `${path}.${key}`, fullObject, true )
            );
        }
        return errors;
    }

    return runOneValidator( value, schema, path, fullObject, false );
}; // runCustomValidator()

/**
 * Validates a single field against its schema
 * Handles all field types including nested objects and arrays
 */
const validateField = function ( value, schema, path, fullObject = {} ) {
    const errors = [];

    // Check type if specified
    if ( schema.type && typeValidators[ schema.type ] ) {
        const typeErrors = typeValidators[ schema.type ]( value, schema, path );
        errors.push( ...typeErrors );

        // If type validation failed with wrong type, skip further validation
        if ( typeErrors.length > 0 && typeErrors[ 0 ].includes( 'Expected' ) ) {
            return errors;
        }
    }

    // Check exact value
    errors.push( ...checkExactValue( value, schema, path ) );

    // Handle object-specific validations
    if ( schema.type === 'object' && typeof value === 'object' && value !== null ) {
        // Validate property names against allowed list
        if ( schema.propertyNames ) {
            Object.keys( value ).forEach( ( key ) => {
                if ( !schema.propertyNames.includes( key ) ) {
                    errors.push( `${path}: Invalid property name '${key}'` );
                }
            } );
        }

        // Validate property keys against a validator function
        if ( schema.keyValidator ) {
            Object.keys( value ).forEach( ( key ) => {
                if ( !schema.keyValidator( key ) ) {
                    errors.push( `${path}: Invalid key '${key}'` );
                }
            } );
        }

        // Validate all properties against a single schema.
        //
        // Two shapes for `propertySchema`:
        //
        // 1. **Property-schema-map** (target has `_propertyNames`): each
        //    top-level key of the target IS a property schema. Example:
        //    columnSchema, where `type`, `unit`, `resolution`, etc. each
        //    declare their own `required`, `validator`, etc. For these
        //    we delegate to `validateWithSchema` so that `required` flags,
        //    `validator` callbacks, and unknown-property checks all fire
        //    correctly. The previous implementation called validateField
        //    here, which silently did nothing for this shape (because
        //    validateField expects an atomic field schema, not a map of
        //    property schemas). That gap let columns missing required
        //    fields like `type` slip through validation.
        //
        // 2. **Atomic field schema** (no `_propertyNames`): the propertySchema
        //    is itself a field schema, like `{ type: 'object', validator: ... }`.
        //    validateField handles these directly. This is the original
        //    behaviour, preserved for callers that use propertySchema
        //    with inline field-schema targets.
        if ( schema.propertySchema ) {
            const target = schema.propertySchema;
            // eslint-disable-next-line no-underscore-dangle
            const isPropertySchemaMap = target._propertyNames !== undefined;
            Object.entries( value ).forEach( ( [ key, val ] ) => {
                const propPath = `${path}.${key}`;
                if ( isPropertySchemaMap ) {
                    const propResult = validateWithSchema( target, val, propPath );
                    errors.push( ...propResult.errors );
                } else {
                    const propErrors = validateField(
                        val,
                        target,
                        propPath,
                        fullObject
                    );
                    errors.push( ...propErrors );
                }
            } );
        }

        // Validate specific properties
        if ( schema.properties ) {
            Object.entries( schema.properties ).forEach( ( [ key, propSchema ] ) => {
                const propPath = `${path}.${key}`;

                if ( propSchema.required && !(key in value) ) {
                    errors.push( `${propPath}: Required field missing` );
                } else if ( key in value ) {
                    const propErrors = validateField(
                        value[ key ],
                        propSchema,
                        propPath,
                        fullObject
                    );
                    errors.push( ...propErrors );
                }
            } );
        }
    }

    // Handle array item validations (for both 'array' and 'arrayOrString' types)
    const isArrayType = schema.type === 'array' || schema.type === 'arrayOrString';
    if ( isArrayType && Array.isArray( value ) && schema.itemSchema ) {
        value.forEach( ( item, index ) => {
            const itemErrors = validateField(
                item,
                schema.itemSchema,
                `${path}[${index}]`,
                fullObject
            );
            errors.push( ...itemErrors );
        } );
    }

    // Run custom validator last
    errors.push( ...runCustomValidator( value, schema, path, fullObject ) );

    return errors;
}; // validateField()

// Export helper functions
export { validateField };

// core/semantics/schemas/enum-schema.js

/**
 * @fileoverview Enum Schema Definition
 *
 * Defines the validation schema for enum files used in semantics.
 * Enums provide human-readable labels for column values of any type.
 *
 * Supported key types (as strings, no whitespace):
 * - Numeric: "0", "1", "-1", "3.14" (for int64/float64 columns)
 * - Boolean: "true", "false" (for bool columns like isWashing)
 * - Text codes: "R", "G", "B", "idle" (for string columns)
 *
 * Example enum files:
 *
 * Numeric states:
 * {
 *     "name": "machineState",
 *     "values": { "0": "Idle", "1": "Running", "2": "Error" }
 * }
 *
 * Boolean states (e.g., for isWashing column):
 * {
 *     "name": "washingState",
 *     "values": { "true": "Washing", "false": "Idle" }
 * }
 *
 * Text codes:
 * {
 *     "name": "colorCodes",
 *     "values": { "R": "Red", "G": "Green", "B": "Blue" }
 * }
 */

import { validators } from '../../utils/validate/index.js';

// ============================================================================
// CUSTOM VALIDATORS
// ============================================================================

/**
 * Validates a single enum key.
 * Keys must be one of:
 * - Numeric string: Valid finite number in canonical form ("0", "-1", "3.14")
 * - Boolean string: Exactly "true" or "false"
 * - Identifier: Valid JS identifier for text codes ("R", "idle", "state_1")
 *
 * @param {string} key - Single enum key to validate
 * @returns {boolean} True if key is valid
 */
const validEnumKey = function ( key ) {
    // Try numeric (most common for machine states)
    if ( validators.numericString( key ) ) return true;
    // Try boolean
    if ( validators.booleanString( key ) ) return true;
    // Try identifier (text codes)
    return validators.identifier( key );
}; // validEnumKey()

/**
 * Validates that enum values object has valid keys.
 * Keys must be numeric strings, boolean strings, or valid identifiers.
 *
 * @param {Object} values - Enum values object
 * @returns {boolean} True if all keys are valid
 */
const validEnumKeys = function ( values ) {
    if ( typeof values !== 'object' || values === null ) {
        return false;
    }

    const keys = Object.keys( values );
    if ( keys.length === 0 ) {
        return false;
    }

    for ( let i = 0; i < keys.length; i += 1 ) {
        if ( !validEnumKey( keys[ i ] ) ) {
            return false;
        }
    }

    return true;
};

/**
 * Validates that enum values are all non-empty strings.
 * Values can contain spaces (e.g., "Error State", "In Progress").
 *
 * @param {Object} values - Enum values object
 * @returns {boolean} True if all values are non-empty strings
 */
const validEnumValues = function ( values ) {
    if ( typeof values !== 'object' || values === null ) {
        return false;
    }

    const entries = Object.values( values );
    for ( let i = 0; i < entries.length; i += 1 ) {
        if ( !validators.nonEmptyString( entries[ i ] ) ) {
            return false;
        }
    }

    return true;
};

// ============================================================================
// SCHEMA DEFINITION
// ============================================================================

/**
 * Schema for enum JSON files.
 *
 * Uses validate module's `keyValidator` and `propertySchema` features
 * for detailed error messages on individual key/value failures.
 *
 * @type {Object}
 */
const enumSchema = {
    _propertyNames: [ 'name', 'description', 'values' ],
    name: {
        type: 'string',
        required: true,
        validator: validators.identifier,
        error: 'Enum name must be a valid identifier'
    },
    description: {
        type: 'string',
        required: false,
        default: ''
    },
    values: {
        type: 'object',
        required: true,
        minProperties: 1,
        keyValidator: validEnumKey,
        propertySchema: {
            type: 'string',
            validator: validators.nonEmptyString,
            error: 'Enum values must be non-empty strings'
        },
        error: 'Enum values must be an object with valid keys (numeric, boolean, or identifier) and non-empty string values'
    }
};

// ============================================================================
// EXPORTS
// ============================================================================

export { enumSchema, validEnumKey, validEnumKeys, validEnumValues };

export default enumSchema;

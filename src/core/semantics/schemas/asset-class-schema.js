// core/semantics/schemas/asset-class-schema.js

/**
 * @fileoverview Asset Class Schema Definition
 *
 * Defines the validation schema for asset class JSON files.
 * An asset class represents a type of equipment (e.g., industrial pump, vehicle)
 * with defined columns (measurements) and insightTypes (column groupings for computed analytics).
 *
 * Uses `propertySchema` to delegate column validation to columnSchema,
 * ensuring a single source of truth for column validation.
 *
 * Example structure:
 * {
 *     "name": "industrialPump",
 *     "description": "Industrial pump system",
 *     "columns": {
 *         "outlet_pressure": { type, unit, resolution, operational, ... },
 *         "motor_temp": { ... }
 *     },
 *     "insightTypes": {
 *         "pump_digest": { columns: ["outlet_pressure", "motor_temp"], ... }
 *     }
 * }
 */

import { validators } from '../../utils/validate/index.js';
import { columnSchema } from './column-schema.js';

// ============================================================================
// CUSTOM VALIDATORS
// ============================================================================

/**
 * Validates that columns object is non-empty with valid identifier keys.
 * Detailed column validation is delegated to columnSchema via propertySchema.
 *
 * @param {Object} columns - Columns object
 * @returns {boolean} True if valid structure
 */
const validColumnsStructure = function ( columns ) {
    if ( typeof columns !== 'object' || columns === null ) {
        return false;
    }

    const keys = Object.keys( columns );
    if ( keys.length === 0 ) {
        return false; // Must have at least one column
    }

    // Validate all column names are valid identifiers
    for ( let i = 0; i < keys.length; i += 1 ) {
        if ( !validators.identifier( keys[ i ] ) ) {
            return false;
        }
    }

    return true;
};

/**
 * Validates a single insightType entry.
 *
 * Structural validation only:
 * - columns: non-empty array of non-empty strings
 * - designatedTimestamp: required, non-empty string
 *
 * Cross-reference validation (designatedTimestamp in columns, type check)
 * is performed by the loader's validateCrossReferences().
 *
 * @param {Object} it - InsightType entry
 * @returns {boolean} True if valid
 */
const validInsightType = function ( it ) {
    if ( typeof it !== 'object' || it === null ) {
        return false;
    }

    // Must have columns array
    if ( !Array.isArray( it.columns ) || it.columns.length === 0 ) {
        return false;
    }

    // All column names must be strings
    for ( let i = 0; i < it.columns.length; i += 1 ) {
        if ( typeof it.columns[ i ] !== 'string' || it.columns[ i ].length === 0 ) {
            return false;
        }
    }

    // designatedTimestamp is required (designates the row-ending timestamp for storage)
    if ( typeof it.designatedTimestamp !== 'string' || it.designatedTimestamp.length === 0 ) {
        return false;
    }

    return true;
};

/**
 * Validates insightTypes object.
 *
 * @param {Object} insightTypes - InsightTypes object
 * @returns {boolean} True if valid
 */
const validInsightTypes = function ( insightTypes ) {
    if ( typeof insightTypes !== 'object' || insightTypes === null ) {
        return false;
    }

    const keys = Object.keys( insightTypes );
    for ( let i = 0; i < keys.length; i += 1 ) {
        const itName = keys[ i ];
        const itSpec = insightTypes[ itName ];

        // InsightType name must be valid identifier
        if ( !validators.identifier( itName ) ) {
            return false;
        }

        if ( !validInsightType( itSpec ) ) {
            return false;
        }
    }

    return true;
};

// ============================================================================
// SCHEMA DEFINITION
// ============================================================================

/**
 * Schema for asset class JSON files.
 *
 * Column validation is delegated to columnSchema via propertySchema.
 * Cross-reference validation (enumRef, context columns, insightType columns)
 * is performed by the loader, not by this schema validator.
 *
 * @type {Object}
 */
const assetClassSchema = {
    _propertyNames: [ 'name', 'description', 'columns', 'insightTypes' ],
    name: {
        type: 'string',
        required: true,
        validator: validators.identifier,
        error: 'Asset class name must be a valid identifier'
    },
    description: {
        type: 'string',
        required: false,
        default: ''
    },
    columns: {
        type: 'object',
        required: true,
        validator: validColumnsStructure,
        propertySchema: columnSchema,  // Delegate to columnSchema for each column
        error: 'Columns must be an object with at least one valid column definition'
    },
    insightTypes: {
        type: 'object',
        required: true,
        minProperties: 1,
        keyValidator: validators.identifier,
        propertySchema: {
            type: 'object',
            propertyNames: [ 'columns', 'designatedTimestamp', 'description' ],
            validator: validInsightType
        },
        error: 'InsightTypes is required and must have at least one insightType definition'
    }
};

// ============================================================================
// INSIGHTTYPE SCHEMA (for individual validation)
// ============================================================================

/**
 * Schema for individual insightType entries.
 *
 * Note: Actual validation is done by validInsightType() function.
 * This schema is exported for documentation and reference.
 *
 * @type {Object}
 */
const insightTypeSchema = {
    columns: {
        type: 'array',
        required: true,
        minLength: 1,
        error: 'InsightType must have at least one column'
    },
    designatedTimestamp: {
        type: 'string',
        required: true,
        error: 'designatedTimestamp is required (designates the row-ending timestamp for storage)'
    },
    description: {
        type: 'string',
        required: false,
        default: ''
    }
};

// ============================================================================
// EXPORTS
// ============================================================================

export {
    assetClassSchema,
    insightTypeSchema,
    validColumnsStructure,
    validInsightType,
    validInsightTypes
};

export default assetClassSchema;

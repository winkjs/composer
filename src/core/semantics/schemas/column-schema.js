// core/semantics/schemas/column-schema.js

/**
 * @fileoverview Column Schema Definition
 *
 * Defines the validation schema for individual columns within an asset class.
 * Columns represent measurements or computed values with full semantic context.
 *
 * Key design decisions:
 * - Three-tier limit hierarchy: physicalRange → operational → specification
 * - Intuitive naming: criticalLow/High, warningLow/High (not hiHi/loLo)
 * - Meaningful defaults: hysteresis=0, interpretation='informational'
 * - Context-dependent limits via `contexts` array
 *
 * Context Resolution Semantics:
 * - Contexts are evaluated in array order (first match wins)
 * - Each context's `when` clause is tested against current column values
 * - At most one `when: 'default'` context is allowed per column
 * - Default context serves as fallback when no other context matches
 * - Recommended ordering: specific conditions first, default last
 *
 * Example context ordering:
 *   contexts: [
 *     { when: { column: 'state', equals: 2 }, ... },  // Error state
 *     { when: { column: 'state', equals: 1 }, ... },  // Running
 *     { when: 'default', ... }                        // Fallback (Idle, etc.)
 *   ]
 *
 * Hysteresis Precedence (intended resolution order for consumers):
 *   operational.hysteresis → column.hysteresis → COLUMN_DEFAULTS.hysteresis (0)
 */

import { validators } from '../../utils/validate/index.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Valid data types for columns.
 * @type {string[]}
 */
const COLUMN_TYPES = [ 'float64', 'int64', 'string', 'bool', 'timestamp' ];

/**
 * LLM-native interpretation array.
 *
 * Column-level `interpretation` is an array of natural language strings
 * providing guidance to LLM consumers about how to interpret values.
 *
 * Recommended prefixes (convention, not validated):
 *   Severity:   - How to interpret magnitude
 *   Threshold:  - Key boundaries and meanings
 *   Correlate:  - Related tables/metrics
 *   Trend:      - Temporal pattern significance
 *   Pattern:    - Multi-signal signatures
 *   Action:     - Recommended response
 *   Context:    - Domain background
 *
 * Example:
 *   interpretation: [
 *       "Severity: higher values indicate more severe glitches",
 *       "Threshold: > 30 bar indicates communication dropout",
 *       "Correlate: with washCycleStats by timestamp"
 *   ]
 *
 * @see ADR-001 (interpretation arrays)
 */

/**
 * Default values for optional column properties.
 * @type {Object}
 */
const COLUMN_DEFAULTS = {
    unit: '',
    resolution: 1,
    description: '',
    interpretation: [],
    hysteresis: 0
};

/**
 * Allowed properties for 'when' clause (object form).
 * Used for unknown property detection in validWhen.
 * Note: 'when' has union type (string | object), so we can't use
 * schema-based propertyNames directly.
 * @type {Set<string>}
 */
const WHEN_ALLOWED_KEYS = new Set( [ 'column', 'equals', 'oneOf' ] );

// ============================================================================
// CUSTOM VALIDATORS
// ============================================================================

/**
 * Validates physical range object.
 *
 * @param {Object} range - Physical range with min/max
 * @returns {boolean} True if valid
 */
const validPhysicalRange = function ( range ) {
    if ( typeof range !== 'object' || range === null ) {
        return false;
    }
    if ( typeof range.min !== 'number' || typeof range.max !== 'number' ) {
        return false;
    }
    if ( !Number.isFinite( range.min ) || !Number.isFinite( range.max ) ) {
        return false;
    }
    return range.min < range.max;
};

/**
 * Validates operational limits object.
 * Limits must be in ascending order: criticalLow ≤ warningLow ≤ target ≤ warningHigh ≤ criticalHigh
 *
 * @param {Object} ops - Operational limits
 * @returns {boolean} True if valid
 */
const validOperational = function ( ops ) {
    if ( typeof ops !== 'object' || ops === null ) {
        return false;
    }

    // Validate individual fields if present
    const numericFields = [ 'criticalLow', 'warningLow', 'target', 'warningHigh', 'criticalHigh' ];
    for ( let i = 0; i < numericFields.length; i += 1 ) {
        const field = numericFields[ i ];
        if ( ops[ field ] !== undefined ) {
            if ( typeof ops[ field ] !== 'number' || !Number.isFinite( ops[ field ] ) ) {
                return false;
            }
        }
    }

    // Validate hysteresis if present (must be non-negative finite)
    if ( ops.hysteresis !== undefined ) {
        if ( !Number.isFinite( ops.hysteresis ) || ops.hysteresis < 0 ) {
            return false;
        }
    }

    // Validate ascending order of defined limits
    const limits = [];
    if ( ops.criticalLow !== undefined ) limits.push( ops.criticalLow );
    if ( ops.warningLow !== undefined ) limits.push( ops.warningLow );
    if ( ops.target !== undefined ) limits.push( ops.target );
    if ( ops.warningHigh !== undefined ) limits.push( ops.warningHigh );
    if ( ops.criticalHigh !== undefined ) limits.push( ops.criticalHigh );

    for ( let i = 1; i < limits.length; i += 1 ) {
        if ( limits[ i ] < limits[ i - 1 ] ) {
            return false;
        }
    }

    return true;
};

/**
 * Validates specification limits object.
 *
 * @param {Object} spec - Specification limits with lsl/usl/target
 * @returns {boolean} True if valid
 */
const validSpecification = function ( spec ) {
    if ( typeof spec !== 'object' || spec === null ) {
        return false;
    }

    // Validate individual fields if present
    const fields = [ 'lowerSpecLimit', 'upperSpecLimit', 'target' ];
    for ( let i = 0; i < fields.length; i += 1 ) {
        const field = fields[ i ];
        if ( spec[ field ] !== undefined ) {
            if ( typeof spec[ field ] !== 'number' || !Number.isFinite( spec[ field ] ) ) {
                return false;
            }
        }
    }

    // lowerSpecLimit must be less than upperSpecLimit
    if ( spec.lowerSpecLimit !== undefined && spec.upperSpecLimit !== undefined ) {
        if ( spec.lowerSpecLimit >= spec.upperSpecLimit ) {
            return false;
        }
    }

    // target must be between lowerSpecLimit and upperSpecLimit
    if ( spec.target !== undefined ) {
        if ( spec.lowerSpecLimit !== undefined && spec.target < spec.lowerSpecLimit ) {
            return false;
        }
        if ( spec.upperSpecLimit !== undefined && spec.target > spec.upperSpecLimit ) {
            return false;
        }
    }

    return true;
};

/**
 * Checks if a value is a JSON primitive (number, string, boolean, null).
 *
 * @param {*} value - Value to check
 * @returns {boolean} True if primitive
 */
const isPrimitive = function ( value ) {
    const type = typeof value;
    return value === null || type === 'number' || type === 'string' || type === 'boolean';
};

/**
 * Validates a 'when' clause in a context entry.
 * Supports:
 * - "default" - fallback when no other context matches
 * - { column, equals } - exact value match (any primitive)
 * - { column, oneOf } - value in set (array of primitives)
 * Extensible for future operators (greaterThan, between, etc.)
 *
 * @param {string|Object} when - When clause
 * @returns {boolean} True if valid
 */
const validWhen = function ( when ) {
    // "default" string for fallback
    if ( when === 'default' ) {
        return true;
    }

    // Object form with column and operator
    if ( typeof when !== 'object' || when === null ) {
        return false;
    }

    // Check for unknown properties
    const keys = Object.keys( when );
    for ( let i = 0; i < keys.length; i += 1 ) {
        if ( !WHEN_ALLOWED_KEYS.has( keys[ i ] ) ) {
            return false;
        }
    }

    // Must have column name
    if ( typeof when.column !== 'string' || when.column.length === 0 ) {
        return false;
    }

    // Check operators (mutually exclusive)
    const hasEquals = when.equals !== undefined;
    const hasOneOf = when.oneOf !== undefined;

    // Exactly one operator must be present (extensible for future operators)
    const operatorCount = ( hasEquals ? 1 : 0 ) + ( hasOneOf ? 1 : 0 );
    if ( operatorCount !== 1 ) {
        return false;
    }

    // Validate equals: must be a primitive
    if ( hasEquals && !isPrimitive( when.equals ) ) {
        return false;
    }

    // Validate oneOf: must be non-empty array of primitives
    if ( hasOneOf ) {
        if ( !Array.isArray( when.oneOf ) || when.oneOf.length === 0 ) {
            return false;
        }
        for ( let i = 0; i < when.oneOf.length; i += 1 ) {
            if ( !isPrimitive( when.oneOf[ i ] ) ) {
                return false;
            }
        }
    }

    return true;
};

/**
 * Validates column type.
 *
 * @param {string} type - Column type
 * @returns {boolean} True if valid
 */
const validColumnType = function ( type ) {
    return COLUMN_TYPES.includes( type );
};

/**
 * Validates interpretation array.
 * Must be an array of non-empty strings.
 *
 * @param {Array} interps - Interpretation array
 * @returns {boolean} True if valid
 */
const validInterpretation = function ( interps ) {
    if ( !Array.isArray( interps ) ) {
        return false;
    }
    for ( let i = 0; i < interps.length; i += 1 ) {
        if ( typeof interps[ i ] !== 'string' || interps[ i ].length === 0 ) {
            return false;
        }
    }
    return true;
};

/**
 * Validates a single context entry.
 * Each context must have:
 * - A valid 'when' clause
 * - At least one of 'operational', 'specification', or 'interpretation'
 *
 * Optional context-specific interpretation allows different "what's bad"
 * semantics per operating mode (e.g., pressure during idle vs operation).
 *
 * @param {Object} ctx - Context entry
 * @returns {boolean} True if valid
 */
const validContext = function ( ctx ) {
    if ( typeof ctx !== 'object' || ctx === null ) {
        return false;
    }

    // Validate 'when' clause
    if ( !validWhen( ctx.when ) ) {
        return false;
    }

    // Check what's present
    const hasOperational = ctx.operational !== undefined;
    const hasSpecification = ctx.specification !== undefined;
    const hasInterpretation = ctx.interpretation !== undefined;

    // Must have at least one of operational, specification, or interpretation
    if ( !hasOperational && !hasSpecification && !hasInterpretation ) {
        return false;
    }

    // Validate operational if present
    if ( hasOperational && !validOperational( ctx.operational ) ) {
        return false;
    }

    // Validate specification if present
    if ( hasSpecification && !validSpecification( ctx.specification ) ) {
        return false;
    }

    // Validate interpretation if present
    if ( hasInterpretation && !validInterpretation( ctx.interpretation ) ) {
        return false;
    }

    return true;
};

/**
 * Validates contexts array.
 * Ensures each context is valid and at most one default context exists.
 *
 * @param {Array} contexts - Array of context entries
 * @returns {boolean} True if valid
 */
const validContexts = function ( contexts ) {
    if ( !Array.isArray( contexts ) ) {
        return false;
    }

    let defaultCount = 0;
    for ( let i = 0; i < contexts.length; i += 1 ) {
        if ( !validContext( contexts[ i ] ) ) {
            return false;
        }
        // Count default contexts
        if ( contexts[ i ].when === 'default' ) {
            defaultCount += 1;
        }
    }

    // At most one default context allowed
    if ( defaultCount > 1 ) {
        return false;
    }

    return true;
};

// ============================================================================
// SCHEMA DEFINITION
// ============================================================================

/**
 * Cross-field validator for mutual exclusivity of contexts vs direct limits.
 * Rule: If contexts exists, operational/specification must NOT exist at column level.
 *       If operational/specification exists at column level, contexts must NOT exist.
 *
 * @param {Object} column - Column definition
 * @returns {boolean} True if valid
 */
const validLimitsMutualExclusivity = function ( column ) {
    const hasContexts = column.contexts !== undefined && column.contexts.length > 0;
    const hasDirectOperational = column.operational !== undefined;
    const hasDirectSpecification = column.specification !== undefined;

    // Mutual exclusivity: contexts XOR direct limits
    if ( hasContexts && ( hasDirectOperational || hasDirectSpecification ) ) {
        return false;
    }

    return true;
};

// Field names for operational and specification limit checks
const OPS_LIMIT_FIELDS = [ 'criticalLow', 'warningLow', 'target', 'warningHigh', 'criticalHigh' ];
const SPEC_LIMIT_FIELDS = [ 'lowerSpecLimit', 'target', 'upperSpecLimit' ];

/**
 * Checks if all defined fields in object are within [min, max] range.
 *
 * @param {Object} obj - Object containing limit fields
 * @param {string[]} fields - Field names to check
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @returns {boolean} True if all defined fields are within range
 */
const allFieldsWithinRange = function ( obj, fields, min, max ) {
    for ( let i = 0; i < fields.length; i += 1 ) {
        const val = obj[ fields[ i ] ];
        if ( val !== undefined && ( val < min || val > max ) ) {
            return false;
        }
    }
    return true;
}; // allFieldsWithinRange()

/**
 * Checks if specification limits are within operational critical bounds.
 *
 * @param {Object} ops - Operational limits with criticalLow/criticalHigh
 * @param {Object} spec - Specification with lowerSpecLimit/upperSpecLimit
 * @returns {boolean} True if spec is within ops bounds
 */
const specWithinOperational = function ( ops, spec ) {
    // lowerSpecLimit must be >= criticalLow (if both defined)
    if ( spec.lowerSpecLimit !== undefined && ops.criticalLow !== undefined ) {
        if ( spec.lowerSpecLimit < ops.criticalLow ) return false;
    }
    // upperSpecLimit must be <= criticalHigh (if both defined)
    if ( spec.upperSpecLimit !== undefined && ops.criticalHigh !== undefined ) {
        if ( spec.upperSpecLimit > ops.criticalHigh ) return false;
    }
    return true;
}; // specWithinOperational()

/**
 * Validates limits hierarchy: physicalRange ⊇ operational ⊇ specification.
 *
 * Rules:
 * 1. If physicalRange exists, operational limits must be within [min, max]
 * 2. If physicalRange exists, specification limits must be within [min, max]
 * 3. If operational + specification both exist (with or without physicalRange):
 *    - specification.lsl >= operational.criticalLow (if both defined)
 *    - specification.usl <= operational.criticalHigh (if both defined)
 *
 * @param {Object} column - Column definition
 * @returns {boolean} True if hierarchy is valid
 */
const validLimitsHierarchy = function ( column ) {
    const range = column.physicalRange;
    const ops = column.operational;
    const spec = column.specification;

    // Rule 1: Check operational within physicalRange
    if ( range && ops ) {
        if ( !allFieldsWithinRange( ops, OPS_LIMIT_FIELDS, range.min, range.max ) ) {
            return false;
        }
    }

    // Rule 2: Check specification within physicalRange
    if ( range && spec ) {
        if ( !allFieldsWithinRange( spec, SPEC_LIMIT_FIELDS, range.min, range.max ) ) {
            return false;
        }
    }

    // Rule 3: Check specification within operational bounds
    if ( ops && spec ) {
        if ( !specWithinOperational( ops, spec ) ) return false;
    }

    return true;
}; // validLimitsHierarchy()

/**
 * Validates context limits hierarchy: physicalRange ⊇ ctx.operational ⊇ ctx.specification.
 *
 * Rules (applied to each context):
 * 1. If column has physicalRange, context operational must be within [min, max]
 * 2. If column has physicalRange, context specification must be within [min, max]
 * 3. If context has both operational + specification:
 *    - specification.lsl >= operational.criticalLow (if both defined)
 *    - specification.usl <= operational.criticalHigh (if both defined)
 *
 * @param {Object} column - Column definition with contexts array
 * @returns {boolean} True if all context hierarchies are valid
 */
const validContextLimitsHierarchy = function ( column ) {
    const range = column.physicalRange;
    const contexts = column.contexts;

    // No contexts or empty contexts = valid
    if ( !contexts || contexts.length === 0 ) return true;

    for ( let i = 0; i < contexts.length; i += 1 ) {
        const ctx = contexts[ i ];
        const ops = ctx.operational;
        const spec = ctx.specification;

        // Rule 1: Check context operational within physicalRange
        if ( range && ops ) {
            if ( !allFieldsWithinRange( ops, OPS_LIMIT_FIELDS, range.min, range.max ) ) {
                return false;
            }
        }

        // Rule 2: Check context specification within physicalRange
        if ( range && spec ) {
            if ( !allFieldsWithinRange( spec, SPEC_LIMIT_FIELDS, range.min, range.max ) ) {
                return false;
            }
        }

        // Rule 3: Check context specification within context operational
        if ( ops && spec ) {
            if ( !specWithinOperational( ops, spec ) ) return false;
        }
    }

    return true;
}; // validContextLimitsHierarchy()

/**
 * Schema for individual column definitions.
 *
 * @type {Object}
 */
const columnSchema = {
    _propertyNames: [
        'type', 'unit', 'resolution', 'description', 'interpretation',
        'hysteresis', 'enumRef', 'physicalRange', 'operational',
        'specification', 'contexts'
    ],
    type: {
        type: 'string',
        required: true,
        validator: validColumnType,
        error: `Column type must be one of: ${COLUMN_TYPES.join( ', ' )}`
    },
    unit: {
        type: 'string',
        required: false,
        default: COLUMN_DEFAULTS.unit
    },
    resolution: {
        type: 'number',
        required: false,
        default: COLUMN_DEFAULTS.resolution,
        validator: validators.positive,
        error: 'Resolution must be a positive number'
    },
    description: {
        type: 'string',
        required: false,
        default: COLUMN_DEFAULTS.description
    },
    interpretation: {
        type: 'array',
        required: false,
        default: COLUMN_DEFAULTS.interpretation,
        validator: validInterpretation,
        error: 'Interpretation must be an array of non-empty strings'
    },
    hysteresis: {
        type: 'number',
        required: false,
        default: COLUMN_DEFAULTS.hysteresis,
        validator: validators.nonNegativeFinite,
        error: 'Hysteresis must be a non-negative finite number'
    },
    enumRef: {
        type: 'string',
        required: false,
        validator: validators.identifier,
        error: 'Enum reference must be a valid identifier'
    },
    physicalRange: {
        type: 'object',
        required: false,
        validator: validPhysicalRange,
        error: 'Physical range must have min < max (both finite numbers)'
    },
    operational: {
        type: 'object',
        required: false,
        validator: validOperational,
        error: 'Operational limits must be in ascending order: criticalLow ≤ warningLow ≤ target ≤ warningHigh ≤ criticalHigh'
    },
    specification: {
        type: 'object',
        required: false,
        validator: validSpecification,
        error: 'Specification must have lowerSpecLimit < upperSpecLimit and target within bounds (if present)'
    },
    contexts: {
        type: 'array',
        required: false,
        default: [],
        itemSchema: {
            type: 'object',
            propertyNames: [ 'when', 'operational', 'specification', 'interpretation' ],
            validator: validContext
        },
        validator: validContexts,
        error: 'Contexts must be an array of valid context entries'
    }
};

// ============================================================================
// EXPORTS
// ============================================================================

export {
    columnSchema,
    validPhysicalRange,
    validOperational,
    validSpecification,
    validWhen,
    validContext,
    validContexts,
    validColumnType,
    validInterpretation,
    validLimitsMutualExclusivity,
    validLimitsHierarchy,
    validContextLimitsHierarchy,
    COLUMN_TYPES,
    COLUMN_DEFAULTS
};

export default columnSchema;

/**
 * Type-specific validators
 * Each validator returns an array of error messages
 */

// ============================================================================
// DRY HELPERS - Shared validation logic
// ============================================================================

/**
 * Validates numeric value against schema constraints.
 * Used by number, numberOrFieldKeyed, numberOrFunction, etc.
 *
 * @param {number} value - Already type-checked number
 * @param {Object} schema - Schema with min, max, integer
 * @param {string} path - Error path
 * @returns {string[]} Array of error messages
 */
const validateNumericConstraints = function ( value, schema, path ) {
    const errors = [];

    if ( Number.isNaN( value ) ) {
        return [ `${path}: Value is NaN` ];
    }

    if ( schema.min !== undefined && value < schema.min ) {
        errors.push( `${path}: Minimum value is ${schema.min}, got ${value}` );
    }

    if ( schema.max !== undefined && value > schema.max ) {
        errors.push( `${path}: Maximum value is ${schema.max}, got ${value}` );
    }

    if ( schema.integer && !Number.isInteger( value ) ) {
        errors.push( `${path}: Expected integer, got ${value}` );
    }

    return errors;
}; // validateNumericConstraints()

/**
 * Validates function arity against schema.
 *
 * @param {Function} fn - Already type-checked function
 * @param {Object} schema - Schema with optional arity
 * @param {string} path - Error path
 * @returns {string[]} Array of error messages
 */
const validateFunctionArity = function ( fn, schema, path ) {
    if ( schema.arity !== undefined && fn.length !== schema.arity ) {
        const plural = schema.arity === 1 ? 'parameter' : 'parameters';
        return [ `${path}: Expected function with ${schema.arity} ${plural}, got ${fn.length}` ];
    }
    return [];
}; // validateFunctionArity()

/**
 * Validates array constraints.
 *
 * @param {Array} arr - Already type-checked array
 * @param {Object} schema - Schema with minItems, maxItems
 * @param {string} path - Error path
 * @returns {string[]} Array of error messages
 */
const validateArrayConstraints = function ( arr, schema, path ) {
    const errors = [];

    if ( schema.minItems !== undefined && arr.length < schema.minItems ) {
        errors.push( `${path}: Minimum items is ${schema.minItems}, got ${arr.length}` );
    }

    if ( schema.maxItems !== undefined && arr.length > schema.maxItems ) {
        errors.push( `${path}: Maximum items is ${schema.maxItems}, got ${arr.length}` );
    }

    return errors;
}; // validateArrayConstraints()

/**
 * Validates one nested object against an inner property schema.
 *
 * The inner shape is read from `schema.properties` — for a range that is
 * `{ min: { type: 'number', required: true }, max: { type: 'number', required: true } }`.
 * Each declared property is checked for presence when required, and numeric
 * properties are checked against their numeric constraints. The key names come
 * from the schema, so this is not tied to min/max — any nested object of
 * numbers works.
 *
 * @param {*} obj - The candidate nested object
 * @param {Object} schema - Schema whose `properties` declares the inner shape
 * @param {string} path - Error path
 * @returns {string[]} Array of error messages
 */
const validateNestedObjectShape = function ( obj, schema, path ) {
    if ( typeof obj !== 'object' || obj === null || Array.isArray( obj ) ) {
        const actual = obj === null ? 'null' : ( Array.isArray( obj ) ? 'array' : typeof obj );
        return [ `${path}: Expected object, got ${actual}` ];
    }

    const errors = [];
    const props = schema.properties || {};
    Object.entries( props ).forEach( ( [ key, propSchema ] ) => {
        const present = key in obj;
        if ( !present ) {
            if ( propSchema.required ) {
                errors.push( `${path}.${key}: Required field missing` );
            }
            return;
        }
        const val = obj[ key ];
        if ( propSchema.type === 'number' && typeof val !== 'number' ) {
            errors.push( `${path}.${key}: Expected number, got ${typeof val}` );
            return;
        }
        if ( propSchema.type === 'number' ) {
            errors.push( ...validateNumericConstraints( val, propSchema, `${path}.${key}` ) );
        }
    } );
    return errors;
}; // validateNestedObjectShape()

// ============================================================================
// TYPE VALIDATORS
// ============================================================================

/**
 * String type validator
 */
const string = function ( value, schema, path ) {
    const errors = [];

    if ( typeof value !== 'string' ) {
        return [ `${path}: Expected string, got ${typeof value}` ];
    }

    if ( schema.minLength !== undefined && value.length < schema.minLength ) {
        errors.push( `${path}: Minimum length is ${schema.minLength}, got ${value.length}` );
    }

    if ( schema.maxLength !== undefined && value.length > schema.maxLength ) {
        errors.push( `${path}: Maximum length is ${schema.maxLength}, got ${value.length}` );
    }

    if ( schema.pattern && !schema.pattern.test( value ) ) {
        errors.push( `${path}: Value does not match required pattern` );
    }

    return errors;
}; // string()

/**
 * Number type validator
 */
const number = function ( value, schema, path ) {
    if ( typeof value !== 'number' ) {
        return [ `${path}: Expected number, got ${typeof value}` ];
    }

    return validateNumericConstraints( value, schema, path );
}; // number()

/**
 * Boolean type validator
 */
const boolean = function ( value, schema, path ) {
    if ( typeof value !== 'boolean' ) {
        return [ `${path}: Expected boolean, got ${typeof value}` ];
    }
    return [];
}; // boolean()

/**
 * Function type validator
 */
const functionType = function ( value, schema, path ) {
    if ( typeof value !== 'function' ) {
        return [ `${path}: Expected function, got ${typeof value}` ];
    }

    return validateFunctionArity( value, schema, path );
}; // functionType()

/**
 * Array type validator
 */
const array = function ( value, schema, path ) {
    if ( !Array.isArray( value ) ) {
        return [ `${path}: Expected array, got ${typeof value}` ];
    }

    // Note: Item validation is handled in validateField to avoid circular dependency
    return validateArrayConstraints( value, schema, path );
}; // array()

const arrayOrString = function ( value, schema, path ) {
    const errors = [];

    if ( !( Array.isArray( value ) || typeof value === 'string' ) ) {
        return [ `${path}: Expected array or string, got ${typeof value}` ];
    }

    if ( schema.minItems !== undefined && value.length < schema.minItems ) {
        errors.push( `${path}: Minimum items is ${schema.minItems}, got ${value.length}` );
    }
    // Note: Item validation is handled in validateField to avoid circular dependency

    return errors;
}; // arrayOrString()

// ── Per-field map types (internally "field-keyed") ──────────────────────────
// The validators below accept an option written as a per-field map: an object
// from field name to that field's value, e.g. { temp: 5, pressure: 10 }. One
// node reading several fields can then give each field its own value.
//
// "field-keyed" is the internal name for this shape — the map's keys are field
// names. User-facing docs and the error strings below say "per-field map"
// instead: same thing, plainer words. Keep that wording in any new error text.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Number or field-keyed object containing numbers.
 * Accepts: 5, { temp: 5, pressure: 10 }
 * Used for tunable parameters that support per-field configuration.
 */
const numberOrFieldKeyed = function ( value, schema, path ) {
    // Direct number case
    if ( typeof value === 'number' ) {
        return number( value, schema, path );
    }

    // Field-keyed object case
    if ( typeof value === 'object' && value !== null && !Array.isArray( value ) ) {
        const errors = [];
        for ( const [ key, val ] of Object.entries( value ) ) {
            if ( typeof val === 'number' ) {
                errors.push( ...validateNumericConstraints( val, schema, `${path}.${key}` ) );
            } else {
                errors.push( `${path}.${key}: Expected number, got ${typeof val}` );
            }
        }
        return errors;
    }

    return [ `${path}: Expected number or per-field map of numbers, got ${typeof value}` ];
}; // numberOrFieldKeyed()

/**
 * Array or field-keyed object containing arrays.
 * Accepts: [1,2,3], { temp: [1,2], pressure: [3,4] }
 * Used for parameters like thresholds, categories that support per-field configuration.
 */
const arrayOrFieldKeyed = function ( value, schema, path ) {
    // Direct array case
    if ( Array.isArray( value ) ) {
        return array( value, schema, path );
    }

    // Field-keyed object case
    if ( typeof value === 'object' && value !== null ) {
        const errors = [];
        for ( const [ key, val ] of Object.entries( value ) ) {
            if ( Array.isArray( val ) ) {
                errors.push( ...validateArrayConstraints( val, schema, `${path}.${key}` ) );
            } else {
                errors.push( `${path}.${key}: Expected array, got ${typeof val}` );
            }
        }
        return errors;
    }

    return [ `${path}: Expected array or per-field map of arrays, got ${typeof value}` ];
}; // arrayOrFieldKeyed()

/**
 * String or field-keyed object containing strings.
 * Accepts: 'lowpass', { temp: 'lowpass', pressure: 'highpass' }
 * Used for parameters like filterType, preset that support per-field configuration.
 */
const stringOrFieldKeyed = function ( value, schema, path ) {
    // Direct string case
    if ( typeof value === 'string' ) {
        return string( value, schema, path );
    }

    // Field-keyed object case
    if ( typeof value === 'object' && value !== null && !Array.isArray( value ) ) {
        const errors = [];
        for ( const [ key, val ] of Object.entries( value ) ) {
            if ( typeof val === 'string' ) {
                // Apply schema constraints to each string
                if ( schema.minLength !== undefined && val.length < schema.minLength ) {
                    errors.push( `${path}.${key}: Minimum length is ${schema.minLength}, got ${val.length}` );
                }
                if ( schema.maxLength !== undefined && val.length > schema.maxLength ) {
                    errors.push( `${path}.${key}: Maximum length is ${schema.maxLength}, got ${val.length}` );
                }
                if ( schema.pattern && !schema.pattern.test( val ) ) {
                    errors.push( `${path}.${key}: Value does not match required pattern` );
                }
            } else {
                errors.push( `${path}.${key}: Expected string, got ${typeof val}` );
            }
        }
        return errors;
    }

    return [ `${path}: Expected string or per-field map of strings, got ${typeof value}` ];
}; // stringOrFieldKeyed()

/**
 * Number or function type validator.
 * Accepts: 5, (msg) => msg.stdev * 0.5
 * Used for tunable parameters that support dynamic (tunable) values.
 *
 * @param {*} value - Value to validate
 * @param {Object} schema - Schema with optional arity for function validation
 * @param {string} path - Path for error messages
 * @returns {string[]} Array of error messages
 */
const numberOrFunction = function ( value, schema, path ) {
    // Function case
    if ( typeof value === 'function' ) {
        return validateFunctionArity( value, schema, path );
    }

    // Number case
    if ( typeof value === 'number' ) {
        return number( value, schema, path );
    }

    return [ `${path}: Expected number or function, got ${typeof value}` ];
}; // numberOrFunction()

/**
 * Validate a single field value that can be number or function.
 * Helper for numberOrFunctionOrFieldKeyed to keep nesting manageable.
 */
const validateNumericOrFunctionField = function ( val, schema, fieldPath ) {
    if ( typeof val === 'function' ) {
        return validateFunctionArity( val, schema, fieldPath );
    }
    if ( typeof val !== 'number' ) {
        return [ `${fieldPath}: Expected number or function, got ${typeof val}` ];
    }
    return validateNumericConstraints( val, schema, fieldPath );
}; // validateNumericOrFunctionField()

/**
 * Number, function, or field-keyed object containing numbers/functions.
 * Accepts: 5, (msg) => msg.value, { temp: 5, pressure: (msg) => msg.baseline }
 * Used for tunable parameters that support both field-keying and tunables.
 */
const numberOrFunctionOrFieldKeyed = function ( value, schema, path ) {
    // Function case (top priority - dynamic at top level)
    if ( typeof value === 'function' ) {
        return validateFunctionArity( value, schema, path );
    }

    // Direct number case
    if ( typeof value === 'number' ) {
        return number( value, schema, path );
    }

    // Field-keyed object case (values can be numbers or functions)
    if ( typeof value === 'object' && value !== null && !Array.isArray( value ) ) {
        const errors = [];
        for ( const [ key, val ] of Object.entries( value ) ) {
            errors.push( ...validateNumericOrFunctionField( val, schema, `${path}.${key}` ) );
        }
        return errors;
    }

    return [ `${path}: Expected number, function, or per-field map of numbers/functions, got ${typeof value}` ];
}; // numberOrFunctionOrFieldKeyed()

/**
 * Validate a single field value that can be array or function.
 * Helper for arrayOrFunctionOrFieldKeyed to keep nesting manageable.
 */
const validateArrayOrFunctionField = function ( val, schema, fieldPath ) {
    if ( typeof val === 'function' ) {
        return validateFunctionArity( val, schema, fieldPath );
    }
    if ( !Array.isArray( val ) ) {
        return [ `${fieldPath}: Expected array or function, got ${typeof val}` ];
    }
    return validateArrayConstraints( val, schema, fieldPath );
}; // validateArrayOrFunctionField()

/**
 * Array, function, or field-keyed object containing arrays/functions.
 * Accepts: [1,2,3], (msg) => [...], { temp: [1,2], pressure: (msg) => [...] }
 * Used for parameters like thresholds that support field-keying and tunables.
 */
const arrayOrFunctionOrFieldKeyed = function ( value, schema, path ) {
    // Function case (top priority - dynamic at top level)
    if ( typeof value === 'function' ) {
        return validateFunctionArity( value, schema, path );
    }

    // Direct array case
    if ( Array.isArray( value ) ) {
        return array( value, schema, path );
    }

    // Field-keyed object case (values can be arrays or functions)
    if ( typeof value === 'object' && value !== null ) {
        const errors = [];
        for ( const [ key, val ] of Object.entries( value ) ) {
            errors.push( ...validateArrayOrFunctionField( val, schema, `${path}.${key}` ) );
        }
        return errors;
    }

    return [ `${path}: Expected array, function, or per-field map of arrays/functions, got ${typeof value}` ];
}; // arrayOrFunctionOrFieldKeyed()

/**
 * Nested object, function, or field-keyed map of nested objects.
 * Accepts: { min: 0, max: 100 },
 *          { temp: { min: -40, max: 85 }, pressure: { min: 0, max: 120 } },
 *          (msg) => ({ min: msg.lo, max: msg.hi })
 * Used for a structured option (like sanitize ranges) that the runtime resolver
 * already accepts in either a direct or a field-keyed shape. The inner shape
 * (which keys, numeric) comes from `schema.properties`.
 *
 * Direct and field-keyed are told apart the way the runtime resolver does
 * (`resolveNestedObject` in resolve-field-keyed.js): if the object itself
 * carries the inner keys it is direct; otherwise its values are the nested
 * objects. A field whose name collides with an inner key (a field literally
 * named "min") is the one ambiguous case; real field names do not.
 */
const nestedObjectOrFunctionOrFieldKeyed = function ( value, schema, path ) {
    // Function case (tunable) — dynamic at the top level
    if ( typeof value === 'function' ) {
        return validateFunctionArity( value, schema, path );
    }

    // The remaining two shapes must both be plain (non-array) objects
    if ( typeof value !== 'object' || value === null || Array.isArray( value ) ) {
        const actual = value === null ? 'null' : ( Array.isArray( value ) ? 'array' : typeof value );
        return [ `${path}: Expected object, function, or per-field map, got ${actual}` ];
    }

    // Direct shape: the object itself carries the inner keys (e.g. min/max)
    const innerKeys = Object.keys( schema.properties || {} );
    const isDirect = innerKeys.some( ( k ) => k in value );
    if ( isDirect ) {
        return validateNestedObjectShape( value, schema, path );
    }

    // Field-keyed shape: every value is a nested object
    const errors = [];
    Object.entries( value ).forEach( ( [ key, val ] ) => {
        errors.push( ...validateNestedObjectShape( val, schema, `${path}.${key}` ) );
    } );
    return errors;
}; // nestedObjectOrFunctionOrFieldKeyed()

/**
 * Object type validator
 */
const object = function ( value, schema, path ) {
    const errors = [];

    if ( typeof value !== 'object' || value === null ) {
        const actualType = value === null ? 'null' : typeof value;
        return [ `${path}: Expected object, got ${actualType}` ];
    }

    if ( Array.isArray( value ) ) {
        return [ `${path}: Expected object, got array` ];
    }

    const keyCount = Object.keys( value ).length;

    if ( schema.minProperties !== undefined && keyCount < schema.minProperties ) {
        errors.push( `${path}: Minimum properties is ${schema.minProperties}, got ${keyCount}` );
    }

    if ( schema.maxProperties !== undefined && keyCount > schema.maxProperties ) {
        errors.push( `${path}: Maximum properties is ${schema.maxProperties}, got ${keyCount}` );
    }

    // Note: Property validation is handled in validateField to avoid circular dependency

    return errors;
}; // object()

/**
 * Object or function type validator.
 * Accepts: { min: 0, max: 100 }, (msg) => ({ min: msg.minVal, max: msg.maxVal })
 * Used for nested object parameters that support tunable values (e.g., ranges).
 */
const objectOrFunction = function ( value, schema, path ) {
    // Function case
    if ( typeof value === 'function' ) {
        return validateFunctionArity( value, schema, path );
    }

    // Object case - delegate to object validator
    return object( value, schema, path );
}; // objectOrFunction()

// Types whose DIRECT form is never a plain (non-array) object, so a plain object
// value is unambiguously the field-keyed shape ({ field: value, ... }). The
// validation engine uses this to decide when a custom validator must run per entry
// of a field-keyed map rather than on the whole map.
//
// Deliberately excludes nestedObjectOrFunctionOrFieldKeyed: its direct form IS an
// object, so a plain object cannot be told apart from a field-keyed map by shape
// alone. (It carries no custom validator today, so per-entry dispatch is moot.)
export const FIELD_KEYED_TYPES = new Set( [
    'numberOrFieldKeyed',
    'stringOrFieldKeyed',
    'arrayOrFieldKeyed',
    'numberOrFunctionOrFieldKeyed',
    'arrayOrFunctionOrFieldKeyed'
] );

// Export all type validators
export const typeValidators = {
    string,
    number,
    boolean,
    function: functionType,
    array,
    object,
    arrayOrString,
    numberOrFieldKeyed,
    arrayOrFieldKeyed,
    stringOrFieldKeyed,
    numberOrFunction,
    numberOrFunctionOrFieldKeyed,
    arrayOrFunctionOrFieldKeyed,
    nestedObjectOrFunctionOrFieldKeyed,
    objectOrFunction
};

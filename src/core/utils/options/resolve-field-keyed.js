/**
 * @fileoverview Utility for resolving field-keyed options in node init.
 *
 * Supports uniform DX where parameters can be specified as either:
 * - Direct values (same for all expanded fields)
 * - Field-keyed objects (per-field values, extracted at init time)
 *
 * Three resolution patterns:
 * 1. resolveScalar — for simple values (number, string, boolean, function)
 * 2. resolveNestedObject — for structured objects (like { min, max })
 * 3. resolveArray — for array values (like thresholds, categories)
 *
 * @example
 * // Direct scalar
 * resolveScalar( 20, 'temp' )  // → 20
 *
 * // Field-keyed scalar
 * resolveScalar( { temp: 5, pressure: 20 }, 'temp' )  // → 5
 *
 * // Direct nested object
 * resolveNestedObject( { min: 0, max: 100 }, 'temp', [ 'min', 'max' ] )  // → { min: 0, max: 100 }
 *
 * // Field-keyed nested object
 * resolveNestedObject(
 *     { temp: { min: -40, max: 85 }, pressure: { min: 0, max: 120 } },
 *     'temp',
 *     [ 'min', 'max' ]
 * )  // → { min: -40, max: 85 }
 *
 * // Direct array
 * resolveArray( [ 10, 50, 90 ], 'temp' )  // → [ 10, 50, 90 ]
 *
 * // Field-keyed array
 * resolveArray( { temp: [ 10, 50, 90 ], pressure: [ 5, 25, 75 ] }, 'temp' )  // → [ 10, 50, 90 ]
 */

/**
 * Resolve scalar option (number, string, boolean, function).
 *
 * @param {*} option - The option value from spec
 * @param {string} fieldName - The node's input field (state.x)
 * @returns {*} Resolved scalar value or undefined
 */
export const resolveScalar = function ( option, fieldName ) {
    // Null/undefined passthrough
    if ( option === null || option === undefined ) return undefined;

    // Scalar or function — return directly
    if ( typeof option !== 'object' ) return option;

    // Array — not a scalar, return undefined (use resolveArray instead)
    if ( Array.isArray( option ) ) return undefined;

    // Object — try field-keyed extraction
    if ( fieldName in option ) {
        const value = option[ fieldName ];
        // Accept scalar or function, reject nested objects (unless function)
        if ( typeof value !== 'object' || typeof value === 'function' ) {
            return value;
        }
    }

    // Object without field key — not a valid scalar spec
    return undefined;
};

/**
 * Resolve nested object option (like ranges: { min, max }).
 *
 * @param {*} option - The option value from spec
 * @param {string} fieldName - The node's input field (state.x)
 * @param {string[]} expectedKeys - Keys that identify direct spec (e.g., [ 'min', 'max' ])
 * @returns {Object|undefined} Resolved object or undefined
 */
export const resolveNestedObject = function ( option, fieldName, expectedKeys ) {
    // Null/undefined/non-object passthrough
    if ( option === null || option === undefined ) return undefined;
    if ( typeof option !== 'object' || Array.isArray( option ) ) return undefined;

    // Try field-keyed first: option[fieldName] is object with expected keys
    const fieldKeyed = option[ fieldName ];
    if ( fieldKeyed && typeof fieldKeyed === 'object' && !Array.isArray( fieldKeyed ) ) {
        const hasExpectedKey = expectedKeys.some( ( k ) => k in fieldKeyed );
        if ( hasExpectedKey ) return fieldKeyed;
    }

    // Fall back to direct: option itself has expected keys
    const hasDirect = expectedKeys.some( ( k ) => k in option );
    if ( hasDirect ) return option;

    return undefined;
};

/**
 * Resolve array option (like thresholds, categories, valueList).
 *
 * @param {*} option - The option value from spec
 * @param {string} fieldName - The node's input field (state.x)
 * @returns {Array|undefined} Resolved array or undefined
 */
export const resolveArray = function ( option, fieldName ) {
    // Null/undefined passthrough
    if ( option === null || option === undefined ) return undefined;

    // Direct array — return as-is
    if ( Array.isArray( option ) ) return option;

    // Object — try field-keyed extraction
    if ( typeof option === 'object' ) {
        const fieldValue = option[ fieldName ];
        if ( Array.isArray( fieldValue ) ) return fieldValue;
    }

    return undefined;
};

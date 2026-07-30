/**
 * @fileoverview Tunable resolution for groupBy expansion.
 *
 * When a tunable (function with `.semantics`) has `semantics.field` matching
 * the groupBy field, we resolve it to the concrete value for that group.
 *
 * Example:
 *   lookupByField( 'rpmBand', { idle: 3.4, low: 3.2 } )
 *   For group 'idle' → resolves to 3.4
 *   For group 'low'  → resolves to 3.2
 *
 * Tunables with different fields are preserved for runtime evaluation:
 *   lookupByField( 'tempRegime', { warm: 0.02, hot: 0.05 } )
 *   Preserved as-is regardless of groupBy field
 *
 * @see ADR-006: Tunable Pattern for Dynamic Parameters
 * @see ADR-007: groupBy DSL Construct
 */

/**
 * Recursively resolves tunables in a value structure.
 *
 * For `lookupByField` tunables where `semantics.field === groupByField`:
 * - Resolves to the mapped value for the group
 * - Falls back to semantics.default if group value not in map
 *
 * All other values pass through unchanged (including non-matching tunables).
 *
 * @param {*} value - Value to process (may contain tunables)
 * @param {string} groupByField - The field used for grouping (e.g., 'rpmBand')
 * @param {string|number} groupValue - The group value to resolve for (e.g., 'idle')
 * @returns {*} Value with matching tunables resolved
 */
const resolveTunablesInValue = function ( value, groupByField, groupValue ) {
    // Check if this is a resolvable tunable
    if ( typeof value === 'function' && value.semantics ) {
        const { type, field, map } = value.semantics;
        if ( type === 'lookupByField' && field === groupByField ) {
            // Resolve: map[groupValue] or default
            return map[ groupValue ] ?? value.semantics.default;
        }
        // Non-matching tunable - preserve for runtime
        return value;
    }

    // Functions without semantics - preserve for runtime
    if ( typeof value === 'function' ) {
        return value;
    }

    // Null/undefined/primitives pass through
    if ( value === null || value === undefined || typeof value !== 'object' ) {
        return value;
    }

    // Arrays - recurse into each element
    if ( Array.isArray( value ) ) {
        const result = [];
        for ( let i = 0; i < value.length; i += 1 ) {
            result.push( resolveTunablesInValue( value[ i ], groupByField, groupValue ) );
        }
        return result;
    }

    // Objects - recurse into each property
    const result = Object.create( null );
    const keys = Object.keys( value );
    for ( let i = 0; i < keys.length; i += 1 ) {
        const key = keys[ i ];
        result[ key ] = resolveTunablesInValue( value[ key ], groupByField, groupValue );
    }

    return result;
};

export { resolveTunablesInValue };

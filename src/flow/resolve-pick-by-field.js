/**
 * @fileoverview Build-time resolver for `pickByField` markers inside a `forEach`.
 *
 * A `pickByField( map )` marker is a function carrying
 * `.semantics = { type: 'pickByField', map }`; it stands for "the value for the
 * current fan channel". When a `forEach` expands a chain for one field, this walker
 * replaces every such marker in that node's options with `map[ field ]` — a plain
 * value baked into the spec before the node is initialized. After it runs, nothing
 * of `pickByField` survives into the wired pipeline, so it costs nothing per message.
 *
 * It mirrors `resolve-tunables.js` (the groupBy resolver) on every pass-through:
 * other tunables and plain predicates are preserved for runtime, primitives pass
 * straight through, and arrays and plain objects are rebuilt with their entries
 * resolved. It differs only at the leaf — it resolves `pickByField` by the current
 * field (throwing on a missing key), where the groupBy resolver resolves
 * `lookupByField` by the group value (with a default). The two leaf rules diverge,
 * which is why this is a separate module rather than a shared walker.
 *
 * @see resolve-tunables.js - the groupBy sibling resolver
 * @see ADR-006 - Tunable Pattern for Dynamic Parameters
 */

/**
 * Recursively resolves `pickByField` markers in an options value for one fan field.
 *
 * @param {*} value - The value to process (an option, or a nested part of one)
 * @param {string} field - The current fan channel's field name (each.field)
 * @returns {*} The value with every pickByField marker replaced by map[ field ]
 * @throws {Error} If a pickByField map has no entry for `field`
 */
export const resolvePickByField = function ( value, field ) {
    // A pickByField marker: resolve to map[ field ]. A missing key is a build error,
    // not a silent undefined that would slip through to the first message.
    if ( typeof value === 'function' && value.semantics && value.semantics.type === 'pickByField' ) {
        const map = value.semantics.map;
        if ( !Object.prototype.hasOwnProperty.call( map, field ) ) {
            throw new Error(
                `WinkComposer/flow: pickByField has no entry for field '${field}' ` +
                `(map keys: ${Object.keys( map ).join( ', ' )}).`
            );
        }
        // Return the resolved value as-is; do not recurse into it, so a resolved
        // field-keyed object (e.g. a sanitize range) reaches the node's own resolver
        // intact.
        return map[ field ];
    }

    // Any other function - a plain predicate, or a different tunable like
    // lookupByField - is preserved for runtime. pickByField is the only marker this
    // resolver owns.
    if ( typeof value === 'function' ) {
        return value;
    }

    // Null/undefined/primitives pass through unchanged.
    if ( value === null || value === undefined || typeof value !== 'object' ) {
        return value;
    }

    // Arrays - resolve each element into a new array.
    if ( Array.isArray( value ) ) {
        const result = [];
        for ( let i = 0; i < value.length; i += 1 ) {
            result.push( resolvePickByField( value[ i ], field ) );
        }
        return result;
    }

    // Objects - resolve each property into a clean object.
    const result = Object.create( null );
    const keys = Object.keys( value );
    for ( let i = 0; i < keys.length; i += 1 ) {
        result[ keys[ i ] ] = resolvePickByField( value[ keys[ i ] ], field );
    }

    return result;
}; // resolvePickByField()

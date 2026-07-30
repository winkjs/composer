/**
 * @fileoverview Fail-fast trigger validation for Flow DSL.
 *
 * Validates trigger specifications at transpile/load time before runtime:
 * - R1: Target node existence (all targets must reference existing nodes)
 * - R2: Circular reference detection (no trigger cycles)
 * - R3: Control method validation (method must be supported by target node)
 *
 * Design: Errors are accumulated (not fail-fast within validation) to report
 * all issues at once. Runtime checks in partition-manager remain as second
 * line of defense.
 *
 * Supports two trigger locations:
 * - Direct: spec.triggers (inline triggers on any node)
 * - Controller: spec.logic[].triggers (Controller node's logic array)
 */

import nodeTypeToModule from '../core/wiring/node-type-to-module.js';

/**
 * Extracts all triggers from a spec, handling both direct triggers
 * and Controller node's nested logic[].triggers.
 *
 * @param {Object} spec - Node specification
 * @returns {Array<Object>} Array of trigger objects
 */
const extractTriggers = function ( spec ) {
    const triggers = [];

    // Direct triggers (inline on any node)
    if ( Array.isArray( spec.triggers ) ) {
        triggers.push( ...spec.triggers );
    }

    // Controller node's nested triggers in logic array
    if ( Array.isArray( spec.logic ) ) {
        for ( let i = 0; i < spec.logic.length; i += 1 ) {
            const logicItem = spec.logic[ i ];
            if ( Array.isArray( logicItem.triggers ) ) {
                triggers.push( ...logicItem.triggers );
            }
        }
    }

    return triggers;
};

/**
 * Builds an index of node names to their position and spec.
 * @param {Array} specs - Node specifications
 * @returns {Map<string, {index: number, spec: object}>} Node index map
 */
const buildNodeIndex = function ( specs ) {
    const index = new Map();
    for ( let i = 0; i < specs.length; i += 1 ) {
        index.set( specs[ i ].name, { index: i, spec: specs[ i ] } );
    }
    return index;
};

/**
 * R1: Validates that all trigger targets reference existing nodes.
 * @param {Array} specs - Node specifications
 * @param {Map} nodeIndex - Node name to index map
 * @returns {Array<string>} Array of error messages (empty if valid)
 */
const validateTargetExists = function ( specs, nodeIndex ) {
    const errors = [];

    for ( let i = 0; i < specs.length; i += 1 ) {
        const spec = specs[ i ];
        const triggers = extractTriggers( spec );

        for ( let t = 0; t < triggers.length; t += 1 ) {
            const trigger = triggers[ t ];
            const targets = trigger.targets || [];

            for ( let j = 0; j < targets.length; j += 1 ) {
                const targetName = targets[ j ];
                if ( !nodeIndex.has( targetName ) ) {
                    errors.push(
                        `Node '${spec.name}' trigger[${t}] references unknown target '${targetName}'`
                    );
                }
            }
        }
    }

    return errors;
};

/**
 * R2: Detects circular references in trigger graph.
 * Uses DFS with coloring: 0=unvisited, 1=visiting, 2=visited.
 * @param {Array} specs - Node specifications
 * @param {Map} nodeIndex - Node name to index map
 * @returns {Array<string>} Array of error messages (empty if valid)
 */
const detectCycles = function ( specs, nodeIndex ) {
    const errors = [];
    const color = new Array( specs.length ).fill( 0 );
    const path = [];

    const dfs = function ( nodeIdx ) {
        if ( color[ nodeIdx ] === 2 ) return false; // Already fully processed
        if ( color[ nodeIdx ] === 1 ) return true;  // Cycle detected

        color[ nodeIdx ] = 1;
        path.push( specs[ nodeIdx ].name );

        const triggers = extractTriggers( specs[ nodeIdx ] );
        for ( let t = 0; t < triggers.length; t += 1 ) {
            const targets = triggers[ t ].targets || [];
            for ( let j = 0; j < targets.length; j += 1 ) {
                const targetEntry = nodeIndex.get( targets[ j ] );
                if ( targetEntry && dfs( targetEntry.index ) ) {
                    return true;
                }
            }
        }

        path.pop();
        color[ nodeIdx ] = 2;
        return false;
    };

    for ( let i = 0; i < specs.length; i += 1 ) {
        if ( color[ i ] === 0 && dfs( i ) ) {
            errors.push( `Circular trigger reference detected: ${path.join( ' → ' )}` );
            // Reset for next potential cycle (though one is usually enough)
            break;
        }
    }

    return errors;
};

/**
 * Validates a single trigger's control method against its target.
 * @param {Object} sourceSpec - Source node spec
 * @param {number} triggerIdx - Trigger index for error messages
 * @param {string} controlMethod - Control method name
 * @param {string} targetName - First target node name
 * @param {Map} nodeIndex - Node name to index map
 * @param {Object} nodeModules - Map of module name to node module
 * @returns {string|null} Error message or null if valid
 */
const validateSingleTriggerMethod = function (
    sourceSpec, triggerIdx, controlMethod, targetName, nodeIndex, nodeModules
) {
    const targetEntry = nodeIndex.get( targetName );
    if ( !targetEntry ) return null; // R1 will catch this

    const targetSpec = targetEntry.spec;
    const moduleName = nodeTypeToModule( targetSpec.nodeType );
    const nodeModule = nodeModules[ moduleName ];

    if ( !nodeModule ) {
        return `Node '${sourceSpec.name}' trigger[${triggerIdx}] targets node type ` +
               `'${targetSpec.nodeType}' but module '${moduleName}' not found`;
    }

    const getSupportedControlMethods = nodeModule.getSupportedControlMethods;
    if ( typeof getSupportedControlMethods !== 'function' ) {
        return `Node module '${moduleName}' missing getSupportedControlMethods() introspection`;
    }

    const supportedMethods = getSupportedControlMethods();
    if ( !Object.prototype.hasOwnProperty.call( supportedMethods, controlMethod ) ) {
        const validMethods = Object.keys( supportedMethods ).join( ', ' ) || '(none)';
        return `Node '${sourceSpec.name}' trigger[${triggerIdx}] uses control method ` +
               `'${controlMethod}' but '${targetSpec.nodeType}' only supports: ${validMethods}`;
    }

    return null;
};

/**
 * R3: Validates that control methods are supported by target nodes.
 * @param {Array} specs - Node specifications
 * @param {Map} nodeIndex - Node name to index map
 * @param {Object} nodeModules - Map of module name to node module
 * @returns {Array<string>} Array of error messages (empty if valid)
 */
const validateControlMethod = function ( specs, nodeIndex, nodeModules ) {
    const errors = [];

    for ( let i = 0; i < specs.length; i += 1 ) {
        const spec = specs[ i ];
        const triggers = extractTriggers( spec );

        for ( let t = 0; t < triggers.length; t += 1 ) {
            const trigger = triggers[ t ];
            const targets = trigger.targets || [];

            // Validate against first target (homogeneity enforced at runtime)
            if ( targets.length > 0 ) {
                const err = validateSingleTriggerMethod(
                    spec, t, trigger.control, targets[ 0 ], nodeIndex, nodeModules
                );
                if ( err ) {
                    errors.push( err );
                }
            }
        }
    }

    return errors;
};

/**
 * Validates all trigger specifications in a flow.
 *
 * @param {Array} specs - Node specifications from flow DSL
 * @param {Object} nodeModules - Map of module name to node module
 * @returns {{valid: boolean, errors: Array<string>}} Validation result
 *
 * @example
 * const result = validateTriggers(specs, nodeModules);
 * if (!result.valid) {
 *     console.error('Trigger validation failed:', result.errors);
 * }
 */
export const validateTriggers = function ( specs, nodeModules ) {
    const errors = [];

    // Build node index for O(1) lookups
    const nodeIndex = buildNodeIndex( specs );

    // R1: Target existence
    errors.push( ...validateTargetExists( specs, nodeIndex ) );

    // R2: Circular references (only if R1 passed to avoid confusion)
    if ( errors.length === 0 ) {
        errors.push( ...detectCycles( specs, nodeIndex ) );
    }

    // R3: Control method validation (only if R1 passed)
    if ( errors.length === 0 ) {
        errors.push( ...validateControlMethod( specs, nodeIndex, nodeModules ) );
    }

    return {
        valid: errors.length === 0,
        errors
    };
};

// Export helpers for testing
export { extractTriggers, buildNodeIndex, validateTargetExists, detectCycles, validateControlMethod };

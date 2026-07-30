/**
 * @fileoverview Introspection metadata for categorize node.
 *
 * Defines supported stats (category, index), control methods, capabilities,
 * DSL schema with cross-field validators, and tunable params (thresholds).
 * All getters return defensive copies.
 */

import { validators } from '../../core/utils/validate/index.js';
import { resolveArray } from '../../core/utils/options/resolve-field-keyed.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'category',  // Assigned category name (string)
    'index'      // Category index (number: 0, 1, 2, ...)
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    category: 'Assigned category name based on threshold comparison',
    index: 'Zero-based index of the assigned category for efficient comparisons'
};

/** Control methods available for triggers */
const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears accumulated state and restarts computation',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause'
};

/** The type of this node */
const NODE_TYPE = 'Categorize';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Assigns numeric values to discrete categories using threshold boundaries',
    features: [
        'Deterministic threshold-based categorization',
        'Outputs both category name and numeric index',
        'O(n) linear search for typical threshold counts',
        'Validates threshold ordering at initialization',
        'Handles out-of-range values gracefully'
    ]
};

/** Spec default values */
export const DEFAULT_OPTIONS = {
    // No defaults needed for this node
};

/** Parameters that support tunable (dynamic) values */
export const TUNABLE_PARAMS = [ 'thresholds' ];

// Export functions for accessing metadata
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

// DSL Metadata for transpilation
const DSL_METADATA = {
    // Spec schema for validation
    specSchema: {
        nodeType: {
            type: 'string',
            required: true,
            value: NODE_TYPE
        },
        name: {
            type: 'string',
            required: true,
            validator: validators.identifier,
            error: 'Name must be a valid identifier'
        },
        from: {
            type: 'object',
            required: true,
            properties: {
                x: {
                    type: 'string',
                    required: true,
                    validator: validators.noSpaces,
                    error: 'Field name cannot contain spaces'
                }
            }
        },
        thresholds: {
            type: 'arrayOrFunctionOrFieldKeyed',
            required: true,
            minItems: 1,
            // Supports tunable for shift/mode-based category boundaries
            itemSchema: {
                type: 'number',
                validator: validators.isFinite,
                error: 'Threshold values must be finite numbers'
            }
        },
        categories: {
            type: 'arrayOrFieldKeyed',
            required: true,
            minItems: 2,
            itemSchema: {
                type: 'string',
                minLength: 1,
                error: 'Category names must be non-empty strings'
            }
        },
        stats: {
            type: 'object',
            required: true,
            minProperties: 1,
            propertyNames: SUPPORTED_STATS,
            propertySchema: {
                type: 'object',
                required: true,
                properties: {
                    storeAs: {
                        type: 'string',
                        required: true,
                        validator: validators.identifier,
                        error: 'storeAs must be a valid identifier'
                    }
                }
            }
        }
    },

    // Cross-field validators
    crossFieldValidators: [
        {
            fields: [ 'thresholds', 'categories' ],
            // Must have exactly n+1 categories for n thresholds (skip if thresholds is function).
            // Resolve both for the node's field the way the runtime does, so a direct
            // array and a field-keyed map are checked the same way.
            validator: ( spec ) => {
                if ( typeof spec.thresholds === 'function' ) return true;
                const t = resolveArray( spec.thresholds, spec.from?.x );
                const c = resolveArray( spec.categories, spec.from?.x );
                if ( !Array.isArray( t ) || !Array.isArray( c ) ) return false;
                return c.length === ( t.length + 1 );
            },
            error: 'Categories array must have exactly one more element than thresholds array'
        },
        {
            fields: [ 'thresholds' ],
            validator: ( spec ) => {
                // If thresholds is a function, validation deferred to runtime
                if ( typeof spec.thresholds === 'function' ) return true;
                // Resolve for the node's field; the count validator owns the
                // "did not resolve to an array" error, so defer here.
                const t = resolveArray( spec.thresholds, spec.from?.x );
                if ( !Array.isArray( t ) ) return true;
                // Thresholds must be in strictly ascending order
                for ( let i = 1; i < t.length; i += 1 ) {
                    if ( t[ i ] <= t[ i - 1 ] ) return false;
                }
                return true;
            },
            error: 'Thresholds must be in strictly ascending order with no duplicates'
        }
    ],

    // How to build the spec from DSL params
    buildSpec: ( name, x, stats, options ) => ( {
            nodeType: NODE_TYPE,
            name,
            from: { x },
            stats,
            ...options
    } ),

};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );

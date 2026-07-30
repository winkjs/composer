/**
 * @fileoverview Introspection metadata for diff node.
 *
 * Defines supported stats, control methods, capabilities, DSL schema,
 * and default options. All getters return defensive copies.
 */

import { validators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'diff'
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    diff: 'Difference between two message values (x - y)',
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
const NODE_TYPE = 'Diff';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Computes the difference between two numeric fields in a message',
    features: [
        'Simple arithmetic difference (x - y)',
        'Optional absolute value mode |x - y|',
        'Useful for computing spreads, or deviations'
    ]
};

// Attach static metadata once, from our constants by making a shallow copy.
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

export const DEFAULT_OPTIONS = {
    absolute: false
};

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
                },
                y: {
                    type: 'string',
                    required: true,
                    validator: validators.noSpaces,
                    error: 'Field name cannot contain spaces'
                }
            }
        },
        absolute: {
            type: 'boolean',
            required: false,
            default: false
        },
        stats: {
            type: 'object',
            required: true,
            propertyNames: SUPPORTED_STATS,
            propertySchema: {
                type: 'object',
                required: true,
                properties: {
                    storeAs: {
                        type: 'string',
                        required: true,
                        minLength: 1,
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
            fields: [ 'from.x', 'from.y' ],
            validator: ( spec ) => spec.from.x !== spec.from.y,
            error: 'from.x and from.y must be different fields'
        }
    ],

    // How to build the spec from DSL params
    buildSpec: ( name, x, y, stats, options ) => ( {
            nodeType: NODE_TYPE,
            name,
            from: { x, y },
            stats,
            ...options
    } ),

};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );


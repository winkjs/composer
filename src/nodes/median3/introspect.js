/**
 * @fileoverview Introspection metadata for median3 node.
 *
 * Defines supported stats, control methods, capabilities, DSL schema,
 * and default options. All getters return defensive copies.
 */

import { validators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'median3'
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    median3: 'Fast median filter over last 3 values'
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
const NODE_TYPE = 'Median3';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Computes the median of the last 3 values for noise reduction',
    features: [
        'Rolling window of exactly 3 values',
        'Efficient sorting algorithm for small fixed window',
        'Handles partial windows gracefully (1-2 values)',
        'Ideal for removing spike noise from sensor data'
    ]
};

/** Default options — median3 has no optional parameters */
export const DEFAULT_OPTIONS = {};

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
                        minLength: 1,
                        validator: validators.identifier,
                        error: 'storeAs must be a valid identifier'
                    }
                }
            }
        }
    },

    // Cross-field validators (none needed for median3)
    crossFieldValidators: [],

    // How to build the spec from DSL params
    // Pattern: NAME_X_OUTPUTS_OPTIONS -> (name, x, stats, options)
    buildSpec: ( name, x, stats, options ) => ( {
        nodeType: NODE_TYPE,
        name,
        from: { x },
        stats,
        ...options
    } ),

};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );

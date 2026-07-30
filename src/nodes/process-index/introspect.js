// nodes/process-index/introspect.js

/**
 * @fileoverview Introspection metadata for processIndex node.
 *
 * Computes process capability/performance index from mean and standard deviation
 * with specification limits. Uses neutral terminology since interpretation as
 * Cpk vs Ppk depends on upstream window configuration.
 *
 * Formulas:
 * - upper = (upperSpecLimit - mean) / (3 * stddev)
 * - lower = (mean - lowerSpecLimit) / (3 * stddev)
 * - index = min(upper, lower) for two-sided, or the applicable one for one-sided
 *
 * DSL: .processIndex( 'tempPI', 'tempMean', 'tempStddev', { index: {...} }, { upperSpecLimit, lowerSpecLimit } )
 */

import { validators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'index',
    'upper',
    'lower',
    'status'
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    index: 'Process index: min(upper, lower) for two-sided specs',
    upper: 'Upper process index: (upperSpecLimit - mean) / (3 * stddev)',
    lower: 'Lower process index: (mean - lowerSpecLimit) / (3 * stddev)',
    status: 'Classification: capable, marginal, or incapable'
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
const NODE_TYPE = 'Process Index';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Computes process capability/performance index from mean and stddev',
    features: [
        'Two-sided specs: index = min(upper, lower)',
        'One-sided specs: upperSpecLimit only or lowerSpecLimit only supported',
        'Status classification: capable (>=1.33), marginal (1.0-1.33), incapable (<1.0)',
        'Configurable thresholds for status classification',
        'Caps index at maxIndex (default 12) for near-zero stddev'
    ]
};

// Attach static metadata once, from our constants by making a shallow copy.
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

export const DEFAULT_OPTIONS = {
    epsilon: 1e-12,
    maxIndex: 12,
    capableThreshold: 1.33,
    marginalThreshold: 1.0
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
                    error: 'Mean field name cannot contain spaces'
                },
                y: {
                    type: 'string',
                    required: true,
                    validator: validators.noSpaces,
                    error: 'Stddev field name cannot contain spaces'
                }
            }
        },
        upperSpecLimit: {
            type: 'number',
            required: false
        },
        lowerSpecLimit: {
            type: 'number',
            required: false
        },
        epsilon: {
            type: 'number',
            required: false,
            default: DEFAULT_OPTIONS.epsilon
        },
        maxIndex: {
            type: 'number',
            required: false,
            default: DEFAULT_OPTIONS.maxIndex
        },
        capableThreshold: {
            type: 'number',
            required: false,
            default: DEFAULT_OPTIONS.capableThreshold
        },
        marginalThreshold: {
            type: 'number',
            required: false,
            default: DEFAULT_OPTIONS.marginalThreshold
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
            fields: [ 'upperSpecLimit', 'lowerSpecLimit' ],
            validator: ( spec ) => spec.upperSpecLimit !== undefined || spec.lowerSpecLimit !== undefined,
            error: 'At least one of upperSpecLimit or lowerSpecLimit must be provided'
        },
        {
            fields: [ 'from.x', 'from.y' ],
            validator: ( spec ) => spec.from.x !== spec.from.y,
            error: 'from.x (mean) and from.y (stddev) must be different fields'
        }
    ],

    // How to build the spec from DSL params
    // DSL: .processIndex( 'tempPI', 'tempMean', 'tempStddev', { index: {...} }, { upperSpecLimit, lowerSpecLimit } )
    buildSpec: ( name, x, y, stats, options ) => ( {
        nodeType: NODE_TYPE,
        name,
        from: { x, y },
        stats,
        ...options
    } ),

};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );


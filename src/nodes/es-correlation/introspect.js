/**
 * @fileoverview Single source of truth for the es-correlation node's supported
 * stats, control methods, capabilities, default options, and DSL schema.
 * All getters return defensive copies to prevent caller mutation.
 */
// nodes/es-correlation/introspect.js

import { validators, composerValidators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'correlation',
    'covariance',
    'r2',
    'fisherZT'
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    correlation: 'Pearson correlation coefficient between x and y using EWMA, range [-1, 1]',
    covariance: 'Covariance between x and y using EWMA',
    r2: 'Coefficient of determination (r-squared), proportion of variance explained, range [0, 1]',
    fisherZT: 'Fisher Z transformation of correlation to normalize it'
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
const NODE_TYPE = 'ES Correlation';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Computes exponentially smoothed correlation and covariance between two variables',
    features: [
        'Numerically stable Welford-style algorithm',
        'Exponential weighting for dynamic tracking',
        'Handles near-zero variance gracefully',
        'Supports correlation, covariance, and r² output',
        'Half-life (samples) supported for intuitive tuning'
    ]
};

// Attach static metadata once, from our constants by making a shallow copy.
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

export const DEFAULT_OPTIONS = {
    // halfLife roughly equivalent to alpha = 0.05
    halfLife: 13.5,
    minVariance: 1e-12
};

// DSL Metadata for transpilation
const DSL_METADATA = {
    // Full spec schema for validation
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
        halfLife: {
            type: 'number',
            required: false,
            default: DEFAULT_OPTIONS.halfLife,
            validator: composerValidators.halfLife,
            error: 'halfLife must be > 0 and < 999999'
        },
        minVariance: {
            type: 'number',
            required: false,
            default: DEFAULT_OPTIONS.minVariance,
            min: 0,
            validator: validators.positive,
            error: 'Minimum variance must be positive'
        },
        minSamples: {
            type: 'number',
            required: false,
            default: 10,
            integer: true,
            min: 1,
            validator: validators.positiveInteger,
            error: 'Minimum samples must be a positive integer'
        },
        fisherZT: {
            type: 'boolean',
            required: false,
            default: false
        },
        stats: {
            type: 'object',
            required: true,
            minProperties: 1,
            propertyNames: SUPPORTED_STATS,
            propertySchema: {
                type: 'object',
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
            fields: [ 'from.x', 'from.y' ],
            validator: ( spec ) => spec.from.x !== spec.from.y,
            error: 'from.x and from.y must be different fields'
        },
        {
            fields: [ 'fisherZT', 'stats.fisherZT' ],
            validator: ( spec ) => {
                // If fisherZT stat is requested, fisherZT must be enabled
                if ( spec.stats && spec.stats.fisherZT ) {
                    return spec.fisherZT === true;
                }
                return true; // No fisherZT stat requested, so no constraint
            },
            error: 'stats.fisherZT requires fisherZT to be enabled'
        }
    ],

    // Build spec from DSL parameters
    // Pattern: NAME_X_Y_OUTPUTS_OPTIONS -> (name, x, y, stats, options)
    buildSpec: ( name, x, y, stats, options ) => ( {
        nodeType: NODE_TYPE,
        name,
        from: { x, y },
        stats,
        ...options
    } ),

};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );

/**
 * @fileoverview Single source of truth for the es-pairwise-correlation node's
 * supported stats, control methods, capabilities, default options, and DSL schema.
 * All getters return defensive copies to prevent caller mutation.
 */
// nodes/es-pairwise-correlation/introspect.js

import { validators, composerValidators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'correlations',      // Raw correlation coefficients vector
    'fisherZT',   // Fisher Z transformed correlations
    'covariances',       // Raw covariances vector
    'pairNames',        // Pair identifiers (e.g., "temp-pressure")
    'varNames'           // Original input variable names
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    correlations: 'Pairwise correlation coefficients (upper triangle)',
    fisherZT: 'Fisher Z transformed correlation values',
    covariances: 'Pairwise covariances (upper triangle)',
    pairNames: 'Labels identifying each variable pair',
    varNames: 'Original variable names in order'
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
const NODE_TYPE = 'ES Pairwise Correlation';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Computes all pairwise correlations between multiple variables using exponential smoothing',
    features: [
        'Single-pass correlation computation for up to 12 variables',
        'Numerically stable exponentially smoothed (Welford-style) algorithm',
        'Zero-allocation operation after initialization',
        'Vector-native processing (no matrix overhead)',
        'Cache-efficient memory layout',
        'O(n²/2) optimal complexity for upper triangle',
        'Fisher Z transformation support',
        'Handles missing/invalid data gracefully',
        'Half-life (samples) supported for intuitive tuning'
    ]
};

// Introspection accessors (return safe copies)
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
// Deep-enough copy: clone root object and clone the features array
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

/** Defaults (aligned with pair node) */
export const DEFAULT_OPTIONS = {
    // halfLife roughly equivalent to alpha ≈ 0.05
    halfLife: 13.5,
    minVariance: 1e-12
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
                    type: 'array',
                    required: true,
                    minItems: 2,
                    maxItems: 12,
                    itemSchema: {
                        type: 'string',
                        validator: validators.noSpaces,
                        error: 'Field names cannot contain spaces'
                    }
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
        minSamples: {
            type: 'number',
            required: false,
            default: 10,
            integer: true,
            min: 1,
            validator: validators.positiveInteger,
            error: 'Minimum samples must be a positive integer'
        },
        minVariance: {
            type: 'number',
            required: false,
            default: 1e-12,
            validator: validators.positive,
            error: 'Minimum variance must be positive'
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
            fields: [ 'from.x' ],
            validator: ( spec ) => {
                const fields = spec.from.x;
                const uniqueFields = new Set( fields );
                return uniqueFields.size === fields.length;
            },
            error: 'Field names must be unique'
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

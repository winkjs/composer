// nodes/tw-stats/introspect.js

/**
 * @fileoverview Introspection module for twStats node.
 *
 * Tumbling window statistics: accumulates Pébay moments over a count-based
 * window, publishes computed statistics (mean, variance, stddev, cv, skew,
 * kurtosis, min, max, n) on window completion or flush.
 *
 * Selective accumulation: only the moments needed by demanded stats are
 * computed on the hot path. The maxMoment tier (1–4) is resolved at init.
 */

import { validators } from '../../core/utils/validate/index.js';

/** Single source of truth for what statistics this node can compute */
const SUPPORTED_STATS = [
    'n',
    'mean',
    'variance',
    'stddev',
    'cv',
    'skew',
    'kurtosis',
    'min',
    'max',
    'rms',
    'crestFactor'
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    n: 'Number of valid samples in the completed window',
    mean: 'Arithmetic mean (first moment M1)',
    variance: 'Sample variance: M2 / (n - 1) for unbiased, M2 / n for biased',
    stddev: 'Sample standard deviation: sqrt(variance)',
    cv: 'Coefficient of variation: stddev / |mean|',
    skew: 'Population skewness: m3 / m2^1.5',
    kurtosis: 'Population excess kurtosis: m4 / m2^2 - 3',
    min: 'Minimum value across all samples in the window',
    max: 'Maximum value across all samples in the window',
    rms: 'Root mean square: sqrt(M2/n + M1²)',
    crestFactor: 'Crest factor: peak / RMS — max(|min|, |max|) / rms'
};

/** Control methods available for triggers */
const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears accumulated state and restarts computation',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses update processing while allowing publishTo to continue',
    unpause: 'Resumes update processing after a pause',
    flush: 'Forces immediate output of partial window'
};

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Tumbling window statistics using Pébay\'s numerically stable algorithm',
    features: [
        'Configurable window-based aggregation (4 to 1,000,000 samples)',
        'Selective moment accumulation: only computes moments needed by demanded stats',
        'Deferred stat conversion: formulas applied only at publish time',
        'Numerically stable incremental computation (Pébay 2008)',
        'Invalid samples skipped without corrupting statistics',
        'Flush support for graceful shutdown with partial windows',
        'Zero allocations in hot path for maximum throughput',
        'O(1) memory regardless of window size'
    ]
};

/** The type of this node */
const NODE_TYPE = 'TW Stats';

// Attach static metadata once, from our constants by making a shallow copy.
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

export const DEFAULT_OPTIONS = {
    windowSize: 100,
    biased: false,
    epsilon: 1e-12
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
                }
            }
        },
        windowSize: {
            type: 'numberOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.windowSize,
            integer: true,
            min: 4,
            max: 1000000,
            validator: validators.positiveInteger,
            error: 'Window size must be a positive integer; minimum 4, maximum 1,000,000'
        },
        biased: {
            type: 'boolean',
            required: false,
            default: DEFAULT_OPTIONS.biased
        },
        epsilon: {
            type: 'number',
            required: false,
            default: DEFAULT_OPTIONS.epsilon,
            min: 0,
            error: 'Epsilon must be a non-negative number'
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

    // Cross-field validators (none needed for twStats)
    crossFieldValidators: [],

    // How to build the spec from DSL params
    // Pattern: NAME_X_OUTPUTS_OPTIONS -> (name, x, stats, options)
    buildSpec: ( name, x, stats, options ) => ( {
        nodeType: NODE_TYPE,
        name,
        from: { x },
        stats,
        ...options
    } )
};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );

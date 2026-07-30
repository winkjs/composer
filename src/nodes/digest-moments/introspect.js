// nodes/digest-moments/introspect.js

/**
 * @fileoverview Introspection module for digestMoments node.
 *
 * Converts raw moments (n, M1-M4, min, max) from momentsDigest into
 * displayable statistics (mean, variance, stddev, skew, kurtosis, cv, min, max).
 *
 * Skewness and kurtosis use population moments (m3/m2^1.5 and m4/m2^2 - 3).
 * Variance uses Bessel's correction by default (M2/(n-1)).
 * Epsilon threshold ensures numerical stability in division operations.
 */

import { validators } from '../../core/utils/validate/index.js';

/** Single source of truth for what statistics this node can compute */
const SUPPORTED_STATS = [
    'n',         // Sample count (pass-through)
    'mean',      // Arithmetic mean (M1)
    'variance',  // Sample variance (unbiased by default)
    'stddev',    // Sample standard deviation
    'skew',      // Population skewness: m3 / m2^1.5
    'kurtosis',  // Excess kurtosis
    'cv',        // Coefficient of variation
    'min',       // Minimum (pass-through)
    'max'        // Maximum (pass-through)
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    n: 'Sample count (pass-through from moments)',
    mean: 'Arithmetic mean (M1)',
    variance: 'Sample variance: M2 / (n - 1) for unbiased, M2 / n for biased',
    stddev: 'Sample standard deviation: sqrt(variance)',
    skew: 'Population skewness: m3 / m2^1.5 (requires n >= 3)',
    kurtosis: 'Population excess kurtosis: m4 / m2^2 - 3 (requires n >= 4)',
    cv: 'Coefficient of variation: stddev / |mean|',
    min: 'Minimum value (pass-through from moments)',
    max: 'Maximum value (pass-through from moments)'
};

/** Control methods available for triggers */
const SUPPORTED_CONTROL_METHODS = {
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause'
};

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Stateless node that converts raw moments into displayable statistics',
    features: [
        'Computes n, mean, variance, stddev, skew, kurtosis, cv, min, max',
        'Population skewness and excess kurtosis from central moments',
        'Configurable biased/unbiased variance (sample vs population)',
        'Epsilon threshold for numerical stability in divisions',
        'Graceful NaN handling for edge cases (n < 2, variance ≈ 0, mean ≈ 0)',
        'Zero allocations in hot path',
        'Stateless design - no reset/recompute needed'
    ]
};

/** The type of this node */
const NODE_TYPE = 'Digest Moments';

// Attach static metadata once, from our constants by making a shallow copy.
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

export const DEFAULT_OPTIONS = {
    biased: false,    // Use sample (unbiased) statistics by default
    epsilon: 1e-12    // Numerical stability threshold for division
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
                    error: 'Prefix (from upstream momentsDigest) cannot contain spaces'
                }
            }
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
            },
            error: `stats keys must be one of: ${SUPPORTED_STATS.join( ', ' )}`
        }
    },

    // Cross-field validators (none needed for digestMoments)
    crossFieldValidators: [],

    // How to build the spec from DSL params
    // DSL: .digestMoments( 'myStats', 'vibSD', { mean: {...} }, options )
    // Pattern: nameXOutputsOptions
    buildSpec: ( name, x, stats, options ) => ( {
        nodeType: NODE_TYPE,
        name,
        from: { x },
        stats,
        ...options
    } )
};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );

/**
 * @fileoverview Single source of truth for esStats node metadata.
 *
 * Exports supported stats (11 metrics across Welford, envelope, and
 * signal-quality categories), human-readable stat descriptions, control
 * methods, node capabilities, default options, and the DSL spec schema
 * with validators. All getter functions return defensive copies.
 */
// nodes/es-stats/introspect.js

import { validators, composerValidators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    // Core Statistics (Welford's algorithm)
    'mean',
    'variance',
    'stdev',

    // Envelope Statistics (Leaky min/max)
    'floor',
    'ceiling',
    'envelope',
    'mid',

    // Signal Quality Metrics
    'snrDB',
    'cv',

    // Current Value Scores (computed per sample)
    'zScore',
    'envScore'
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    mean: 'Exponentially smoothed mean',
    variance: 'Exponentially smoothed variance (Welford\'s algorithm)',
    stdev: 'Square root of variance',
    floor: 'Recent minimum with exponential decay (envelope follower)',
    ceiling: 'Recent maximum with exponential decay (envelope follower)',
    envelope: 'Signal envelope width (ceiling - floor)',
    mid: 'Envelope midpoint ((floor + ceiling) / 2)',
    snrDB: 'Signal-to-noise ratio in dB (20*log10(|mean|/stdev))',
    cv: 'Coefficient of variation (stdev/|mean|)',
    zScore: 'Normalized deviation of current value ((x - mean)/stdev)',
    envScore: 'Envelope-normalized score ((x - mid)/(envelope/2))'
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
const NODE_TYPE = 'ES Stats';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Comprehensive exponentially weighted statistics for streaming signals',
    features: [
        'Numerically stable Welford\'s algorithm for mean/variance',
        'Leaky envelope tracking (floor/ceiling) with fast attack/slow release',
        'Signal quality metrics (SNR, CV)',
        'Real-time anomaly scores (z-score, envelope score)',
        'No allocations in hot path',
        'Single half-life for consistent weighting'
    ]
};

// Export functions for accessing metadata
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

export const DEFAULT_OPTIONS = {
    halfLife: 10,
    biased: false
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
                }
            }
        },
        halfLife: {
            type: 'numberOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.halfLife,
            validator: composerValidators.halfLife,
            error: 'halfLife must be > 0 and < 999999'
        },
        biased: {
            type: 'boolean',
            required: false,
            default: DEFAULT_OPTIONS.biased
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

    // Build spec from DSL parameters
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

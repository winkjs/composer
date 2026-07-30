// nodes/trend/introspect.js

import { validators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'trend',
    'confidence',
    'rocMean',
    'accelerationHint'
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    trend: 'Trend direction: learning, stable, rising, or falling',
    confidence: 'Confidence score between 0 and 1',
    rocMean: 'Mean Rate of change (first derivative)',
    accelerationHint: 'Acceleration hint: likely_accelerating, likely_decelerating, or null'
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
const NODE_TYPE = 'Trend';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Rate Of Change-domain (first-difference) trend detection with exponentially smoothed roc statistics; no internal smoothing for clean composability.',
    features: [
        'States: learning, stable, rising, falling',
        'Confidence: SNR × persistence (tanh mapping)',
        'Domain knob: rocThreshold (set ≳ noise of the roc signal)',
        'Optional acceleration hint (fast/slow EWMAs on roc, gated)',
        'Warm-up derived from roc half-life'
    ]
};

// Export functions for accessing metadata
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

// Spec default values
export const DEFAULT_OPTIONS = {
    rocStatsHalfLife: 9,
    rocThreshold: 0.1,
    speedUp: 2
};

/** Parameters that support tunable (dynamic) values */
export const TUNABLE_PARAMS = [ 'rocThreshold' ];

// DSL Metadata for transpilation
const DSL_METADATA = {
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
                properties: {
                    storeAs: {
                        type: 'string',
                        required: true,
                        validator: validators.identifier,
                        error: 'storeAs must be a valid identifier'
                    }
                }
            }
        },
        rocStatsHalfLife: {
            type: 'numberOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.rocStatsHalfLife,
            min: 2,
            validator: validators.positive,
            error: 'roc stats half-life must be minimum 2'
        },
        rocThreshold: {
            type: 'numberOrFunctionOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.rocThreshold,
            // Supports tunable for phase-dependent sensitivity (warmup vs steady-state)
            validator: validators.nonNegativeOrFunction,
            error: 'Threshold must be non-negative or function'
        },
        warmupSamples: {
            type: 'numberOrFieldKeyed',
            required: false,
            integer: true,
            min: 3,
            validator: validators.positiveInteger,
            error: 'Warmup samples must be at least 3'
        },
        speedUp: {
            type: 'numberOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.speedUp,
            validator: validators.inRange( 1.5, 3 ),
            error: 'speedUp must be between 1.5 and 3'
        }
    },

    crossFieldValidators: [],

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

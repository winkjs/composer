// nodes/sw-stats/introspect.js

import { validators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
  'mean',
  'variance',
  'stdev',
  'skewness',
  'kurtosis',
  'rms'
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
  mean: 'Average of the last N samples',
  variance: 'Sample variance (denominator N–1)',
  stdev: 'Sample standard deviation',
  skewness: 'Normalized third central moment',
  kurtosis: 'Excess kurtosis (μ₄/σ⁴ – 3)',
  rms: 'Root mean square'
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
const NODE_TYPE = 'SW Stats';

/** Node capabilities for documentation */
const CAPABILITIES = {
  description: 'Computes running statistics over a sliding window',
  features: [
    'Efficient incremental computation',
    'Configurable window size',
    'Multiple statistics in single pass',
    'Numerically stable algorithms'
  ]
};

// Attach static metadata once, from our constants by making a shallow copy.
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

export const DEFAULT_OPTIONS = {
    windowSize: 10
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
            default: 10,
            integer: true,
            min: 4,
            validator: validators.positiveInteger,
            error: 'Window size must be a positive integer; minimum 4'
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

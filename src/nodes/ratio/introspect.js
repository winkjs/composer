// nodes/ratio/introspect.js

import { validators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
  'ratio'
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    ratio: 'Ratio of x to y (x/y), optionally scaled or in decibels'
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
const NODE_TYPE = 'Ratio';

/** Node capabilities for documentation */
const CAPABILITIES = {
   description: 'Computes the ratio of two numeric fields with optional logarithmic scale',
    features: [
        'Linear ratio computation (x/y)',
        'Linear scaling of ratio output (x/y × k) for unit conversion',
        'Decibel scale output (20*log₁₀(x/y)) for SNR and gain measurements',
        'Numerically stable logarithm implementation',
        'Division-by-zero protection with configurable minimum threshold',
        'NaN propagation for invalid inputs'
    ]
};

// Attach static metadata once, from our constants by making a shallow copy.
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

export const DEFAULT_OPTIONS = {
    logScale: false,
    minY: 1e-10,
    scaleBy: 1
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
        logScale: {
            type: 'boolean',
            required: false,
            default: false
        },
        minY: {
            type: 'number',
            required: false,
            default: 1e-10,  // Prevents division by extremely small numbers
            validator: (value) => value >= 0,
            error: 'minY must be non-negative'
        },
        scaleBy: {
            type: 'number',
            required: false,
            default: 1,
            validator: ( value ) => value > 0,
            error: 'scaleBy must be a positive number'
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
        },
        {
            fields: [ 'logScale', 'scaleBy' ],
            validator: ( spec ) => {
                const hasLogScale = spec.logScale === true;
                const hasScaleBy = spec.scaleBy !== undefined;
                return !( hasLogScale && hasScaleBy );
            },
            error: 'logScale and scaleBy are mutually exclusive'
        }
    ],

    // How to build the spec from DSL params
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

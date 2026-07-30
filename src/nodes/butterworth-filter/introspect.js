/**
 * @fileoverview Introspection metadata for butterworth-filter node.
 *
 * Defines supported stats, control methods, capabilities, DSL schema,
 * and default options. All getters return defensive copies.
 */

import { validators } from '../../core/utils/validate/index.js';

/** Single source of truth for capabilities */
const SUPPORTED_STATS = [ 'filtered' ];

const STAT_DESCRIPTIONS = {
    filtered: 'Butterworth filtered signal'
};

/** Control methods available for triggers */
const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears accumulated state and restarts computation',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause'
};

const NODE_TYPE = 'Butterworth Filter';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'High-performance 2nd-order Butterworth filter for real-time streaming',
    features: [
        'Lowpass and highpass filtering',
        'Multiple cutoff specification methods',
        'DC initialization for transient reduction',
        'Cascade adjustment for multi-stage filtering'
    ]
};

// Static metadata exports
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

export const DEFAULT_OPTIONS = {
    filterType: 'lowpass',
    acceptNumericalRisk: false
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
        filterType: {
            type: 'stringOrFieldKeyed',
            required: false,
            default: 'lowpass',
            validator: validators.oneOf([ 'lowpass', 'highpass' ]),
            error: 'filterType must be "lowpass" or "highpass"'
        },
        sampleRateHz: {
            type: 'number',
            required: true,
            validator: validators.positive,
            error: 'sampleRateHz must be positive'
        },
        // One of these cutoff specifications is required
        cutoffHz: {
            type: 'numberOrFieldKeyed',
            required: false,
            validator: validators.positive,
            error: 'cutoffHz must be positive'
        },
        settlingTimeMs: {
            type: 'numberOrFieldKeyed',
            required: false,
            validator: validators.positive,
            error: 'settlingTimeMs must be positive'
        },
        cutoffRatio: {
            type: 'numberOrFieldKeyed',
            required: false,
            validator: validators.inRange(0, 1),
            error: 'cutoffRatio must be between 0 and 1'
        },
        adjustForCascade: {
            type: 'number',
            required: false,
            integer: true,
            min: 2,
            validator: validators.positiveInteger,
            error: 'adjustForCascade must be an integer >= 2'
        },
        initStrategy: {
            type: 'string',
            required: false,
            validator: validators.oneOf([ 'dc' ]),
            error: 'initStrategy must be "dc" if specified'
        },
        dcEstimate: {
            type: 'number',
            required: false
        },
        acceptNumericalRisk: {
            type: 'boolean',
            required: false,
            default: false
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
            fields: [ 'cutoffHz', 'settlingTimeMs', 'cutoffRatio' ],
            // At least one cutoff specification method must be provided
            validator: ( spec ) => ( spec.cutoffHz || spec.settlingTimeMs || spec.cutoffRatio ),
            error: 'Must specify cutoffHz, settlingTimeMs, or cutoffRatio'
        },
        {
            fields: [ 'cutoffHz', 'settlingTimeMs', 'cutoffRatio' ],
            validator: ( spec ) => {
                // Only one cutoff specification method should be provided
                const methods = [ spec.cutoffHz, spec.settlingTimeMs, spec.cutoffRatio ].filter( Boolean );
                return methods.length === 1;
            },
            error: 'Specify only one of: cutoffHz, settlingTimeMs, or cutoffRatio'
        },
        {
            fields: [ 'initStrategy', 'dcEstimate' ],
            validator: ( spec ) => {
                // If initStrategy is 'dc', dcEstimate must be provided
                if ( spec.initStrategy === 'dc' ) {
                    return spec.dcEstimate !== undefined;
                }
                return true;
            },
            error: 'dcEstimate is required when initStrategy is "dc"'
        },
        {
            fields: [ 'initStrategy', 'dcEstimate' ],
            validator: ( spec ) => {
                // If dcEstimate is provided, initStrategy must be 'dc'
                if ( spec.dcEstimate !== undefined ) {
                    return spec.initStrategy === 'dc';
                }
                return true;
            },
            error: 'initStrategy must be "dc" when dcEstimate is provided'
        }
    ],

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

// Performance and design info exports
export const getPerformance = ( state ) => ( { ...state.performance } );

export const getDesignInfo = ( state ) => ( {
    filterType: state.filterType,
    actualCutoffHz: state.config.cutoffHz,
    sampleRateHz: state.config.sampleRateHz,
    configMethod: state.config.intent,
    normalized3dBFreq: state.config.normalizedCutoff,
    cascadeAdjustment: state.config.cascadeAdjustment,
    // Phase delay at cutoff in ms
    phaseDelayMs: ( state.performance.groupDelaySamples / state.config.sampleRateHz ) * 1000,
    // Settling time in ms
    settlingTimeMs: ( state.performance.settlingTimeSamples / state.config.sampleRateHz ) * 1000
} );

// Human-readable description
export const describe = ( state ) => {
    const info = getDesignInfo( state );
    return `${state.filterType} filter: ${info.actualCutoffHz.toFixed(1)}Hz @ ${info.sampleRateHz}Hz ` +
           `(settles in ~${info.settlingTimeMs.toFixed(0)}ms, delay ~${info.phaseDelayMs.toFixed(1)}ms)`;
};

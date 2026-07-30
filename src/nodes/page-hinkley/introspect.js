/**
 * @fileoverview Page-Hinkley node introspection metadata.
 *
 * Defines supported stats (phShift, phTestStatistic, phMean), control methods,
 * default options, DSL spec schema with validators, and the buildSpec function
 * for DSL transpilation. Single source of truth for the node's public contract.
 */

import { validators, composerValidators } from '../../core/utils/validate/index.js';
import { resolveScalar } from '../../core/utils/options/resolve-field-keyed.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'phTestStatistic',
    'phMean',
    'phShift'
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    phTestStatistic: 'Page-Hinkley change detection statistic',
    phMean: 'Running mean or EWMA based on value of alpha',
    phShift: 'Boolean indicator of detected shift'
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
const NODE_TYPE = 'Page Hinkley';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Detects changes in data distribution using the Page-Hinkley test',
    features: [
        'Sequential change point detection algorithm',
        'Configurable sensitivity via lambda threshold',
        'Adaptive baseline with running mean or EWMA',
        'Can detect both increases and decreases in mean'
    ]
};

// Export functions for accessing metadata
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

export const DEFAULT_OPTIONS = {
    delta: 0.005,
    lambda: 45,
    // halfLife: not specified → running mean (alpha=0). When specified,
    // init.js converts halfLife → alpha via halfLifeToAlpha().
    detectDrop: false,
    minWarmUpSamples: 10
};

/** Parameters that support tunable (dynamic) values.
 *  halfLife is structural (selects running mean vs exponentially smoothed
 *  baseline at init time), not tunable per-message. */
export const TUNABLE_PARAMS = [ 'delta', 'lambda' ];

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
        delta: {
            type: 'numberOrFunctionOrFieldKeyed',
            required: false,
            default: 0.005,
            validator: validators.positiveOrFunction,
            error: 'Delta must be a positive number or function'
        },
        lambda: {
            type: 'numberOrFunctionOrFieldKeyed',
            required: false,
            default: 45,
            validator: validators.positiveOrFunction,
            error: 'Lambda must be a positive number or function'
        },
        halfLife: {
            type: 'numberOrFieldKeyed',
            required: false,
            validator: composerValidators.halfLife,
            error: 'halfLife must be > 0 and < 999999'
        },
        detectDrop: {
            type: 'boolean',
            required: false,
            default: false
        },
        minWarmUpSamples: {
            type: 'number',
            required: false,
            default: 10,
            integer: true,
            validator: validators.positiveInteger,
            error: 'Minimum warm-up samples must be a positive integer'
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
        triggers: {
            type: 'array',
            required: false,
            itemSchema: {
                type: 'object',
                validator: composerValidators.trigger,
                error: 'Invalid trigger specification'
            }
        }
    },

    // Cross-field validators
    crossFieldValidators: [
        {
            fields: [ 'delta', 'lambda' ],
            validator: ( spec ) => {
                // Resolve each for the node's field so a direct value and a
                // field-keyed map are compared the same way (each resolves to a
                // number, a function, or undefined).
                const delta = resolveScalar( spec.delta, spec.from?.x );
                const lambda = resolveScalar( spec.lambda, spec.from?.x );
                // If either is a function (tunable), defer validation to runtime
                if ( typeof delta === 'function' || typeof lambda === 'function' ) {
                    return true;
                }
                // Delta should be small relative to lambda for proper sensitivity
                if ( !delta || !lambda ) return true; // Use defaults
                return delta < lambda * 0.1;
            },
            error: 'Delta should be less than 10% of lambda for proper sensitivity'
        },
        composerValidators.noSelfTriggers
    ],

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

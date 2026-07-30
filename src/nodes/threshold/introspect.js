// nodes/threshold/introspect.js

import { validators, composerValidators } from '../../core/utils/validate/index.js';
import { resolveScalar } from '../../core/utils/options/resolve-field-keyed.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'active'       // Current state - the only output
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    active: 'Boolean state indicating if threshold condition is currently met'
};

/** Supported threshold modes */
const THRESHOLD_MODES = [ 'above', 'below', 'inside', 'outside' ];

/** Control methods available for triggers */
const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears accumulated state and restarts computation',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause'
};

/** The type of this node */
const NODE_TYPE = 'Threshold';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Multi-mode threshold detection with optional hysteresis for stable state transitions',
    features: [
        'Mode: above - Activates when value exceeds threshold',
        'Mode: below - Activates when value falls below threshold',
        'Mode: inside - Activates when value is within range',
        'Mode: outside - Activates when value is outside range',
        'Hysteresis support for chatter-free operation'
    ]
};

// Export functions for accessing metadata
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );
export const getThresholdModes = () => THRESHOLD_MODES.slice();

export const DEFAULT_OPTIONS = {
    hysteresis: 0
};

/** Parameters that support tunable (dynamic) values */
export const TUNABLE_PARAMS = [ 'threshold', 'min', 'max', 'hysteresis' ];

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
        mode: {
            type: 'string',
            required: true,
            validator: validators.oneOf(THRESHOLD_MODES),
            error: `Mode must be one of: ${THRESHOLD_MODES.join(', ')}`
        },
        // For 'above' and 'below' modes (supports tunable for adaptive thresholds)
        threshold: {
            type: 'numberOrFunctionOrFieldKeyed',
            required: false,  // Validated by cross-field validator
            validator: ( value ) => typeof value === 'function' || ( !isNaN( value ) && isFinite( value ) ),
            error: 'Threshold must be a finite number or function'
        },
        // For 'inside' and 'outside' modes (supports tunable for adaptive ranges)
        min: {
            type: 'numberOrFunctionOrFieldKeyed',
            required: false,  // Validated by cross-field validator
            validator: ( value ) => typeof value === 'function' || ( !isNaN( value ) && isFinite( value ) ),
            error: 'Min must be a finite number or function'
        },
        max: {
            type: 'numberOrFunctionOrFieldKeyed',
            required: false,  // Validated by cross-field validator
            validator: ( value ) => typeof value === 'function' || ( !isNaN( value ) && isFinite( value ) ),
            error: 'Max must be a finite number or function'
        },
        // Optional hysteresis for all modes (supports tunable for adaptive hysteresis)
        hysteresis: {
            type: 'numberOrFunctionOrFieldKeyed',
            required: false,
            default: 0,
            validator: validators.nonNegativeOrFunction,
            error: 'Hysteresis must be a non-negative finite number or function'
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
            fields: [ 'mode', 'threshold', 'min', 'max' ],
            validator: ( spec ) => {
                // For 'above' and 'below' modes, require threshold
                if ( spec.mode === 'above' || spec.mode === 'below' ) {
                    if ( spec.threshold === undefined ) return false;
                    // These modes should not have min/max
                    if ( spec.min !== undefined || spec.max !== undefined ) return false;
                }
                // For 'inside' and 'outside' modes, require min and max
                if ( spec.mode === 'inside' || spec.mode === 'outside' ) {
                    if ( spec.min === undefined || spec.max === undefined ) return false;
                    // These modes should not have threshold
                    if ( spec.threshold !== undefined ) return false;
                    // Resolve for the node's field so a direct value and a field-keyed
                    // map are compared the same way; min must be less than max
                    // (skip the comparison when either resolves to a function).
                    const min = resolveScalar( spec.min, spec.from?.x );
                    const max = resolveScalar( spec.max, spec.from?.x );
                    if ( typeof min !== 'function' && typeof max !== 'function' ) {
                        if ( min >= max ) return false;
                    }
                }
                return true;
            },
            error: 'Invalid parameters for mode. Above/below need threshold. Inside/outside need min and max (min < max).'
        },
        composerValidators.noSelfTriggers
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

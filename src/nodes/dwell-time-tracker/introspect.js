// nodes/dwell-time-tracker/introspect.js

import { validators, composerValidators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'active',        // Current boolean state (passthrough)
    'dwellTime',     // Duration of previous state (milliseconds)
    'dwellSamples',  // Number of samples in previous state
    'dutyCycle'      // Duty cycle ( active / ( active + inactive ) )
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    active: 'Current boolean state of the tracked predicate condition.',
    dwellTime: 'Duration in milliseconds for which the previous state was maintained; populated only at the moment of state transition, otherwise null.',
    dwellSamples: 'Number of samples processed while in the previous state; populated only at the moment of state transition, otherwise null.',
     dutyCycle: 'Fraction of time spent in true state over one complete cycle (true time / total time); populated after completing a full cycle (two consecutive transitions), otherwise null.'
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
const NODE_TYPE = 'Dwell Time Tracker';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Tracks boolean state transitions with edge detection and dwell time measurement.',
    features: [
        'Evaluates a predicate function to detect state changes based on user-defined logic.',
        'Measures dwell time in the previous state (in milliseconds).',
        'Counts dwell samples in the previous state.',
        'Identifies rising and falling edges using `dwellTime !== null` or `dwellSamples !== null` checks.',
        'Enables easy computation of the previous toggle time via `timestamp - dwellTime`.',
        'Supports both message timestamps and system time for flexible timing sources.'
    ]
};


/** Spec default values */
export const DEFAULT_OPTIONS = {
    // No defaults needed for this node
};

// Export functions for accessing metadata
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( {
    ...CAPABILITIES,
    features: CAPABILITIES.features.slice()
} );

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
        predicate: {
            type: 'function',
            required: true,
            arity: 1,
            validator: composerValidators.predicate,
            error: 'Predicate must be a function accepting one parameter (msg)'
        },
        timestampField: {
            type: 'string',
            required: false,
            validator: validators.noSpaces,
            error: 'Timestamp field name cannot contain spaces'
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
        composerValidators.noSelfTriggers
    ],

    // How to build the spec from DSL params
    buildSpec: ( name, predicate, stats, options ) => ( {
            nodeType: NODE_TYPE,
            name,
            predicate,
            stats,
            ...options
    } ),

};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );

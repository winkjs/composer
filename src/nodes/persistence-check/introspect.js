// nodes/persistence-check/introspect.js

import { validators, composerValidators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'persistenceConfirmed'
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    persistenceConfirmed: 'True if a predicate meets or exceeds the minimum votes out of a given total'
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
const NODE_TYPE = 'Persistence Check';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Confirms persistence when a predicate satisfies a minimum threshold within a window',
    features: [
        'Evaluates predicate with filtered inputs and counter arguments',
        'Voting mechanism for stability confirmation',
        'Configurable minimum votes and window size',
        'Automatic reset after publishing confirmation'
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
    minVotes: 3,
    outOfTotal: 5
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
        predicate: {
            type: 'function',
            required: true,
            arity: 1,
            error: 'Predicate must be a function with exactly one parameters (msg)'
        },
        minVotes: {
            type: 'number',
            required: false,
            default: 3,
            integer: true,
            min: 1,
            validator: validators.positiveInteger,
            error: 'minVotes must be a positive integer'
        },
        outOfTotal: {
            type: 'number',
            required: false,
            default: 5,
            integer: true,
            min: 1,
            validator: validators.positiveInteger,
            error: 'outOfTotal must be a positive integer'
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
            fields: [ 'minVotes', 'outOfTotal' ],
            validator: (spec) => {
                const minVotes = spec.minVotes || 3;
                const outOfTotal = spec.outOfTotal || 5;
                return outOfTotal >= minVotes;
            },
            error: 'outOfTotal must be greater than or equal to minVotes'
        },
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

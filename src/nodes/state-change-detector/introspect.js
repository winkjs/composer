import { validators, composerValidators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this node can do */
const SUPPORTED_STATS = [
    'dwellTime',
    'dwellSamples'
];

/** Human-readable descriptions */
const STAT_DESCRIPTIONS = {
    dwellTime: 'Duration in milliseconds spent in previous state (never negative — a backward clock step reports 0)',
    dwellSamples: 'Number of samples observed in previous state'
};

/** The type of this node */
const NODE_TYPE = 'State Change Detector';

/** Control methods available for triggers */
const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears accumulated state and restarts computation',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause'
};

/** Default configuration options */
const DEFAULT_OPTIONS = {
    debounce: 3,
    changeMode: 'any'
};

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Detects and confirms transitions between categorical states with debounce filtering',
    features: [
        'Multi-field state monitoring with any/all logic',
        'Debounce protection against boundary oscillation',
        'Dwell time and sample count tracking',
        'Trigger support for adaptive behavior'
    ]
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
export { DEFAULT_OPTIONS };

// DSL Metadata
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
                    type: 'array',
                    required: true,
                    minItems: 1,
                    itemSchema: {
                        type: 'string',
                        validator: validators.noSpaces,
                        error: 'Field names must not contain spaces'
                    }
                }
            }
        },
        debounce: {
            type: 'number',
            required: false,
            default: 3,
            validator: composerValidators.windowSize,
            error: 'Debounce must be a positive integer'
        },
        changeMode: {
            type: 'string',
            required: false,
            default: 'any',
            validator: validators.oneOf( [ 'any', 'all' ] ),
            error: 'changeMode must be "any" or "all"'
        },
        timestampField: {
            type: 'string',
            required: false,
            validator: validators.identifier,
            error: 'timestampField must be a valid identifier'
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

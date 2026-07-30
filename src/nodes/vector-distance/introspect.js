// nodes/vector-distance/introspect.js

import { validators } from '../../core/utils/validate/index.js';

/** The type of this node */
const NODE_TYPE = 'Vector Distance';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'mad',        // Mean Absolute Distance
    'rms',        // Root Mean Square Distance
    'maximum',    // Maximum Distance (L∞)
    'cosine',     // Cosine Distance
    'angular'     // Angular Distance (radians)
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    mad: 'Mean absolute distance between vectors',
    // For correlations [-1,1]: bounded [0,2]
    // For general vectors: bounded [0, ∞]

    rms: 'Root mean square distance between vectors',
    // For correlations [-1,1]: bounded [0,2]
    // For general vectors: bounded [0, ∞]

    maximum: 'Maximum single element difference',
    // For correlations [-1,1]: bounded [0,2]
    // For general vectors: bounded [0, ∞]

    cosine: 'Cosine distance [0,2]',     // Always [0,2] regardless of input
    angular: 'Angular distance [0,π]'     // Always [0,π] regardless of input
};

/** Control methods available for triggers */
const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears accumulated state and restarts computation',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause'
};

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Computes multiple distance metrics between numeric vectors',
    features: [
        'Five complementary distance metrics (MAD, RMS, Maximum, Cosine, Angular)',
        'Works with any numeric vectors (correlations, features, histograms, embeddings)',
        'Direct integration with change detectors (Page-Hinkley, CUSUM, Threshold)'
    ]
};

// Attach static metadata once, from our constants by making a shallow copy.
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

// DSL Metadata for transpilation
// Metadata → describes how to build → Specs → initialize → Nodes
const DSL_METADATA = {
    // Spec schema for validation
    specSchema: {
        nodeType: {
            type: 'string',
            required: true,
            value: NODE_TYPE,
        },
        name: {
            type: 'string',
            required: true,
            minLength: 1,
            validator: validators.identifier,  // Using standard validator
            error: 'Name must be a valid identifier'
        },
        from: {
            type: 'object',
            required: true,
            properties: {
                x: {
                    type: 'string',
                    required: true,
                    minLength: 1,
                    validator: validators.noSpaces,  // Using standard validator
                    error: 'Field name cannot contain spaces'
                },
                y: {
                    type: 'string',
                    required: true,
                    minLength: 1,
                    validator: validators.noSpaces,  // Using standard validator
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
                required: true,
                properties: {
                    storeAs: {
                        type: 'string',
                        required: true,
                        minLength: 1,
                        validator: validators.identifier,  // Using standard validator
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
            fields: [ 'stats' ],
            validator: ( spec ) => {
                // Ensure no duplicate storeAs values
                const storeAsValues = Object.values( spec.stats ).map( ( s ) => s.storeAs );
                return storeAsValues.length === new Set( storeAsValues ).size;
            },
            error: 'All storeAs values must be unique'
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

export const getDSLMetadata = () => ({ ...DSL_METADATA });

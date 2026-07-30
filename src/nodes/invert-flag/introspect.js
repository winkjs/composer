// nodes/invert-flag/introspect.js

/**
 * @fileoverview Introspection metadata for invertFlag node.
 *
 * Inverts a boolean field (e.g., dwell emits active=false on transition,
 * dashboard shows "wasActive=true").
 *
 * DSL: .invertFlag( 'invert', 'active', { inverted: { storeAs: 'wasActive' } } )
 */

import { validators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'inverted'
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    inverted: 'Inverted boolean value (!x)',
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
const NODE_TYPE = 'Invert Flag';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Inverts a boolean field in the message',
    features: [
        'Boolean inversion: true → false, false → true',
        'Handles truthy/falsy values via JavaScript coercion',
        'Useful for inverting state transition flags'
    ]
};

// Attach static metadata once, from our constants by making a shallow copy.
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

export const DEFAULT_OPTIONS = Object.create( null );

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

    // How to build the spec from DSL params
    // DSL: .invertFlag( 'myInvert', 'active', { inverted: { storeAs: 'wasActive' } } )
    buildSpec: ( name, x, stats, options ) => ( {
        nodeType: NODE_TYPE,
        name,
        from: { x },
        stats,
        ...options
    } ),

};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );


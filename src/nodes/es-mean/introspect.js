/**
 * @fileoverview Single source of truth for esMean node metadata.
 *
 * Exports supported stats, control methods, capabilities, default options,
 * and the DSL spec schema used by both validation (init-time) and
 * transpilation (DSL → spec). All getters return defensive copies.
 */

import { validators, composerValidators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'mean'
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    mean: 'Exponentially Smoothed Mean'
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
const NODE_TYPE = 'ES Mean';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Computes exponentially smoothed mean for smoothing time series data',
    features: [
        'Half-life based smoothing (samples) for intuitive tuning',
        'Optional adaptive half-life based on absolute innovation (robust MAD-ish estimator)',
        'Numerically stable update form'
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
    // ≈ alpha 0.2
    halfLife: 3.1062837195053903
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
        halfLife: {
            type: 'numberOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.halfLife,
            validator: composerValidators.halfLife,
            error: 'halfLife must be > 0 and < 999999'
        },
        adaptiveHalfLife: {
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
    buildSpec: ( name, x, stats, options ) => ( {
            nodeType: NODE_TYPE,
            name,
            from: { x },
            stats,
            ...options
    } ),

};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );

// nodes/pass-if/introspect.js

/**
 * @fileoverview Introspection metadata for passIf node
 *
 * Single source of truth for DSL metadata, validation schema,
 * default options, and node capabilities. Used by flow transpiler
 * and documentation.
 */

import { validators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [];  // passIf doesn't publish stats - it's a pure gate

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {};

/** Control methods available for triggers */
const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears accumulated state and restarts computation',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause'
};

/** The type of this node */
const NODE_TYPE = 'Pass If';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Binary gate that passes or stops messages based on a predicate function',
    features: [
        'Evaluates predicate with message and counter arguments',
        'Stops downstream flow when predicate returns false',
        'Maintains message counter for deterministic sampling patterns',
        'Pure predicate functions with no side effects'
    ]
};

// Export functions for accessing metadata
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );
export const DEFAULT_OPTIONS = {};

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
            arity: 2,
            error: 'Predicate must be a function with exactly two parameters (msg, counter)'
        },
        stats: {
            type: 'object',
            required: false,
            propertyNames: [],  // No stats for pass-through node
            error: 'PassIf is a gating node and does not support stats'
        }
    },

    // No cross-field validators needed
    crossFieldValidators: [],

    // How to build the spec from DSL params
    // Pattern: NAME_PREDICATE_OPTIONS -> (name, predicate, options)
    buildSpec: ( name, predicate, options ) => ( {
        nodeType: NODE_TYPE,
        name,
        predicate,
        ...options
    } ),

};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );

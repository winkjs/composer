// nodes/spike-guard/introspect.js

/**
 * @fileoverview Introspection metadata for spikeGuard node.
 *
 * spikeGuard detects single-sample spikes using a 3-sample sliding window.
 * Core insight: In window [left, middle, right]:
 * - Spike: middle differs from BOTH left and right by > threshold
 * - Transition: middle differs from only ONE neighbor
 *
 * This elegantly discriminates spikes from transitions without lookahead.
 */

import { validators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'clean',        // Cleaned value (median of window)
    'detected',     // Boolean: true when spike detected
    'magnitude'     // Signed spike magnitude (negative=dip, positive=surge), 0 if no spike
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    clean: 'Cleaned value (median of 3-sample window)',
    detected: 'Boolean: true when spike detected',
    magnitude: 'Signed spike magnitude: negative=dip (dropout), positive=surge (noise), 0 if no spike'
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
const NODE_TYPE = 'Spike Guard';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Detects single-sample spikes and outputs cleaned (median) value',
    features: [
        'Rolling window of exactly 3 values',
        'Spike = middle differs from BOTH neighbors by > threshold',
        'Outputs cleaned value (median) and detection flag',
        'Zero false positives at state transitions'
    ]
};

// Export functions for accessing metadata
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

// DSL Metadata for transpilation
// Pattern: NAME_X_OUTPUTS_OPTIONS -> .spikeGuard( name, x, stats, options )
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
        threshold: {
            type: 'number',
            required: true,
            validator: validators.positive,
            error: 'Threshold must be a positive number'
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
        }
    },

    // Cross-field validators (none needed for spikeGuard)
    crossFieldValidators: [],

    // How to build the spec from DSL params
    // Pattern: NAME_X_OUTPUTS_OPTIONS -> (name, x, stats, options)
    buildSpec: ( name, x, stats, options ) => ( {
            nodeType: NODE_TYPE,
            name,
            from: { x },
            stats,
            ...options
    } )

};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );

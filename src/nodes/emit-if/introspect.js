/**
 * @fileoverview Introspection metadata for emitIf node
 *
 * Single source of truth for DSL metadata, validation schema,
 * and node capabilities. Used by flow transpiler and documentation.
 */

import { validators } from '../../core/utils/validate/index.js';
const SUPPORTED_STATS = [];  // Pass-through node, no stats to publish

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {};  // No stats, no descriptions

/** Control methods available for triggers (none - side-effect only node) */
const SUPPORTED_CONTROL_METHODS = {};

/** The type of this node */
const NODE_TYPE = 'Emit If';

/** Node capabilities for documentation (kept accurate to shipping code) */
const CAPABILITIES = {
    description: 'Conditionally emits messages to external targets (MQTT, terminal) without disrupting pipeline flow',
    features: [
        'Pure pass-through behavior - messages continue unchanged',
        'Conditional emission based on predicate function',
        'Publishes through the emitter handle\'s publishNow and reads its classified { ok, error } result',
        'Optional annotate hook shapes the emitted payload; a non-object return is rejected into the node\'s error episode',
        'Status signals ($disable / $reason) on predicate error episodes and on recovery',
        'Publish failures open a loud error episode (one console.error per episode); the pipeline never stops',
        'Zero overhead when predicate evaluates to false'
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
    // Validation schema
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
            error: 'Name must be a valid JavaScript identifier'
        },
        predicate: {
            type: 'function',
            required: true,
            arity: 1,
            error: 'Predicate must be a function with exactly one parameter (inputs)'
        },
        target: {
            type: 'string',
            required: true,
            validator: validators.oneOf( [ 'mqtt', 'gpio', 'terminal' ] ),
            error: 'Target type must be "mqtt", "gpio", or "terminal"'
        },
        insightType: {
            type: 'string',
            required: true,
            error: 'Insight type must be specified for topic construction'
        },
        annotate: {
            type: 'function',
            required: false,
            arity: 1,
            error: 'Annotate must be a function with exactly one parameter (msg)'
        },
        stats: {
            type: 'object',
            required: false,
            propertyNames: [],  // No stats for pass-through node
            error: 'EmitIf is a pass-through node and does not support stats'
        }
    },

    // Cross-field validators
    crossFieldValidators: [
    ],

    // Build spec from DSL
    buildSpec: ( name, predicate, options ) => ( {
        nodeType: NODE_TYPE,
        name,
        predicate,
        ...options
    } ),

};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );

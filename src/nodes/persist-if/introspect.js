// nodes/persist-if/introspect.js

/**
 * @fileoverview Introspection metadata for persistIf node
 *
 * Single source of truth for DSL metadata, validation schema,
 * and node capabilities. Used by flow transpiler and documentation.
 */

import { validators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [];  // Pass-through node, no stats to publish

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {};  // No stats, no descriptions

/** Control methods available for triggers (none - side-effect only node) */
const SUPPORTED_CONTROL_METHODS = {};

/** The type of this node */
const NODE_TYPE = 'Persist If';

/** Node capabilities for documentation (kept accurate to shipping code) */
const CAPABILITIES = {
    description: 'Conditionally persists messages to storage without disrupting pipeline flow',
    features: [
        'Pure pass-through behavior - messages continue unchanged',
        'Conditional persistence based on predicate function',
        'Optional annotate hook shapes the stored record (mirrors emitIf); the persist plan still writes only the insight type\'s declared columns',
        'On the first firing, annotate record keys are checked once per gate: a key that is neither a declared column nor a message field is named in a warning, because its value would otherwise vanish silently',
        'Columns and types come from the declared semantics (asset class), never inferred from data',
        'Writes through the storage handle\'s write and reads its classified { ok, error } result',
        'Write failures open a loud error episode (one console.error per episode); the pipeline never stops',
        'Per-partition persistence tracking'
    ]
};

// Export functions for accessing metadata
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

/** Spec default values */
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
            error: 'Predicate must be a function with exactly one parameter (msg)'
        },
        insightType: {
            type: 'string',
            required: true,
            error: 'Insight type must be specified (maps to storage table)'
        },
        storageName: {
            type: 'string',
            required: true,
            error: 'Storage name must reference a registered storage adapter'
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
            error: 'PersistIf is a pass-through node and does not support stats'
        }
    },

    // Cross-field validators
    crossFieldValidators: [],

    // Build spec from DSL
    buildSpec: ( name, predicate, options ) => ( {
        nodeType: NODE_TYPE,
        name,
        predicate,
        ...options
    } )
};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );

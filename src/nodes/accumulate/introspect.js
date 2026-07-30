// nodes/accumulate/introspect.js

/**
 * @fileoverview Introspection metadata for the accumulate node.
 *
 * Defines supported stats, control methods, capabilities, and DSL schema
 * for a simple running sum accumulator. Works with controller disable/enable
 * for conditional accumulation without embedded predicate.
 *
 * @see ADR-004
 */

import { validators } from '../../core/utils/validate/index.js';

// ── Supported Statistics ────────────────────────────────────────────────────

const SUPPORTED_STATS = [ 'sum' ];

const STAT_DESCRIPTIONS = {
    sum: 'Running sum of input values'
};

// ── Control Methods ─────────────────────────────────────────────────────────

const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears accumulated sum to zero',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause'
};

// ── Node Identity ───────────────────────────────────────────────────────────

const NODE_TYPE = 'Accumulate';

// ── Capabilities ────────────────────────────────────────────────────────────

const CAPABILITIES = {
    description: 'Accumulates numeric values into a running sum',
    features: [
        'Simple running sum (no windowing)',
        'Works with controller disable/enable for conditional accumulation',
        'Expects periodic resets — unbounded sum drifts without them',
        'No ring buffer — no catch-up problem when disabled',
        'Zero allocation in hot path'
    ]
};

// ── Default Options ─────────────────────────────────────────────────────────

const DEFAULT_OPTIONS = {};

// ── DSL Metadata ────────────────────────────────────────────────────────────

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
            error: 'name must be a valid identifier'
        },
        from: {
            type: 'object',
            required: true,
            properties: {
                x: {
                    type: 'string',
                    required: true,
                    validator: validators.noSpaces,
                    error: 'from.x must not contain spaces'
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
                        validator: validators.identifier,
                        error: 'storeAs must be a valid identifier'
                    }
                }
            }
        }
    },

    crossFieldValidators: [],

    buildSpec: ( name, x, stats, options ) => ( {
        nodeType: NODE_TYPE,
        name,
        from: { x },
        stats,
        ...options
    } )
};

// ── Getter Functions (defensive copies) ─────────────────────────────────────

export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( {
    ...CAPABILITIES,
    features: CAPABILITIES.features.slice()
} );
export { DEFAULT_OPTIONS };
export const getDSLMetadata = () => ( { ...DSL_METADATA } );

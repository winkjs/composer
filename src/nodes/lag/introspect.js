// nodes/lag/introspect.js

/**
 * @fileoverview Introspection metadata for the lag node.
 *
 * The lag node computes five lag-based statistics from a single ring buffer:
 * delta, ratio, roc (rate of change), slope (time-normalized), and logReturn.
 * This replaces and extends the former delta node.
 *
 * @see ADR-004 for patterns
 */

import { validators } from '../../core/utils/validate/index.js';

/**
 * Supported output statistics.
 * At least one must be specified in the spec.
 * @type {string[]}
 */
const SUPPORTED_STATS = [
    'delta',
    'ratio',
    'roc',
    'slope',
    'logReturn',
    'cumDelta',
    'xLag'
];

/**
 * Human-readable descriptions for each statistic.
 * @type {Object<string, string>}
 */
const STAT_DESCRIPTIONS = {
    delta: 'Absolute change: x - x_lag',
    ratio: 'Relative value: x / x_lag',
    roc: 'Rate of change (percentage): (x - x_lag) / x_lag',
    slope: 'Time-normalized change: (x - x_lag) / (t - t_lag)',
    logReturn: 'Log return (continuously compounded): ln(x / x_lag)',
    cumDelta: 'Cumulative delta: running sum of (x - x_lag), reset sets lower limit',
    xLag: 'Lagged input value: the value pushed lag samples ago. NaN during the warmup window (first lag samples).'
};

/**
 * Control methods available for triggers.
 * @type {Object<string, string>}
 */
const SUPPORTED_CONTROL_METHODS = {
    reset: 'Resets computed values; preserves ring buffer when cumDelta is configured (ADR-008)',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause'
};

/**
 * Node type identifier.
 * @type {string}
 */
const NODE_TYPE = 'Lag';

/**
 * Node capabilities for documentation and introspection.
 * @type {Object}
 */
const CAPABILITIES = {
    description: 'Computes lag-based statistics comparing current and historical values',
    features: [
        'Seven statistics: delta, ratio, roc, slope, logReturn, cumDelta, xLag',
        'Configurable lag window for historical comparison',
        'Optional absolute value transformation for delta and slope',
        'Shared ring buffer for memory efficiency',
        'Optional timestamp support for slope computation',
        'Handles missing/invalid data gracefully with NaN propagation',
        'Cumulative delta for integration-style computations with reset',
        'Direct xLag publication for lookback-based downstream patterns'
    ]
};

// ── Exported Getters (defensive copies) ────────────────────────────────────

export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( {
    ...CAPABILITIES,
    features: CAPABILITIES.features.slice()
} );

// ── Default Options ────────────────────────────────────────────────────────

/**
 * Default values for optional spec parameters.
 * @type {Object}
 */
export const DEFAULT_OPTIONS = {
    lag: 1,
    absolute: false
};

// ── DSL Metadata ───────────────────────────────────────────────────────────

/**
 * DSL metadata for transpilation and validation.
 *
 * Signature pattern: NAME_X_OUTPUTS_OPTIONS
 * DSL call: .lag( name, x, stats, options )
 */
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
        lag: {
            type: 'numberOrFieldKeyed',
            required: false,
            integer: true,
            min: 1,
            default: DEFAULT_OPTIONS.lag
        },
        timestamp: {
            type: 'string',
            required: false,
            validator: validators.noSpaces,
            error: 'timestamp must not contain spaces'
        },
        absolute: {
            type: 'boolean',
            required: false,
            default: DEFAULT_OPTIONS.absolute
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

    // Cross-field validators
    crossFieldValidators: [
        {
            fields: [ 'stats', 'timestamp' ],
            validator: ( spec ) => {
                // If slope stat is requested, timestamp field is required
                if ( spec.stats?.slope !== undefined ) {
                    return spec.timestamp !== undefined;
                }
                return true;
            },
            error: 'timestamp is required when slope stat is requested'
        }
    ],

    // Build spec from DSL arguments
    buildSpec: ( name, x, stats, options ) => {
        const spec = {
            nodeType: NODE_TYPE,
            name,
            from: { x },
            stats,
            ...options
        };
        return spec;
    }
};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );

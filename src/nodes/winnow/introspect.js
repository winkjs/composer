/**
 * @fileoverview Introspection metadata for the winnow node.
 *
 * Winnow is a trajectory-aware significance detector. It tracks a
 * projected trajectory from the last significant point and fires when
 * the signal deviates beyond an adaptive, self-tightening threshold.
 *
 * The name comes from agriculture: winnowing separates the grain
 * (significant samples) from the chaff (redundant ones). Pair with
 * passIf for compression, emitIf for edge-to-cloud gating, or
 * threshold on deviation for adaptive alarming.
 *
 * Reads slope, noise, direction, and gate from upstream nodes via
 * configurable field names — does not compute them itself.
 *
 * Validated through 10 compression experiments on synthetic signals
 * and real 20 kHz bearing vibration data.
 */

import { validators } from '../../core/utils/validate/index.js';

// ── Supported Features ──────────────────────────────────────────────────────

const SUPPORTED_STATS = [ 'deviation', 'predicted', 'significant', 'xPrev', 'tPrev' ];

const STAT_DESCRIPTIONS = {
    deviation: 'Distance from projected trajectory (always published)',
    predicted: 'Where the trajectory says the signal should be',
    significant: 'Boolean: did the signal stray beyond the adaptive threshold?',
    xPrev: 'Previous tick input value (from 1-sample buffer). Non-NaN only on chi-squared gate-fire keeps. Requires bufferPrev: true.',
    tPrev: 'Previous tick timestamp (from 1-sample buffer). Non-NaN only on chi-squared gate-fire keeps. Requires bufferPrev: true and timestampField.'
};

const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears anchor, counter, and accumulated state',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause'
};

const NODE_TYPE = 'Winnow';

const CAPABILITIES = {
    description: 'Trajectory-aware significance detector — separates the grain from the chaff',
    features: [
        'Slope-aware deadband: projects anchor forward using the rate of change',
        'Progressive tightening: threshold narrows as segment grows',
        'Step detection via chi-squared innovation gate from upstream kalman1d',
        'Trend reversal detection from upstream trend node',
        'Adaptive threshold: K × noise floor (zero per-signal tuning)',
        'Gap prevention: forces a point through after maxGap samples',
        'Graceful degradation: works without slope/gate/direction (reduces to flat deadband)',
        'Publishes deviation and predicted for downstream analytics',
        'Optional 1-sample buffer (bufferPrev): publishes xPrev/tPrev on gate-fire keeps for spike-region anchoring'
    ]
};

// ── Default Options ─────────────────────────────────────────────────────────

export const DEFAULT_OPTIONS = {
    K: 2,
    tightenBase: 100,
    maxGap: 500,
    slopeField: 'roc',
    noiseField: 'stdev',
    dirField: 'trendDir',
    gateField: 'gate',
    chi2Threshold: 6.63,
    bufferPrev: false
};

// ── Tunable Parameters ──────────────────────────────────────────────────────

export const TUNABLE_PARAMS = [ 'K' ];

// ── Getter Functions (defensive copies) ─────────────────────────────────────

export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( {
    ...CAPABILITIES,
    features: CAPABILITIES.features.slice()
} );

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
        },

        // ── Sensitivity ─────────────────────────────────────────
        K: {
            type: 'numberOrFunctionOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.K,
            validator: validators.positiveOrFunction,
            error: 'K must be positive or a function'
        },

        // ── Tightening ──────────────────────────────────────────
        tightenBase: {
            type: 'numberOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.tightenBase,
            validator: validators.positive,
            error: 'tightenBase must be positive'
        },

        // ── Gap prevention ──────────────────────────────────────
        maxGap: {
            type: 'numberOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.maxGap,
            integer: true,
            validator: validators.positiveInteger,
            error: 'maxGap must be a positive integer'
        },

        // ── Upstream field names ─────────────────────────────────
        slopeField: {
            type: 'string',
            required: false,
            default: DEFAULT_OPTIONS.slopeField,
            validator: validators.noSpaces,
            error: 'slopeField must not contain spaces'
        },
        noiseField: {
            type: 'string',
            required: false,
            default: DEFAULT_OPTIONS.noiseField,
            validator: validators.noSpaces,
            error: 'noiseField must not contain spaces'
        },
        dirField: {
            type: 'string',
            required: false,
            default: DEFAULT_OPTIONS.dirField,
            validator: validators.noSpaces,
            error: 'dirField must not contain spaces'
        },
        gateField: {
            type: 'string',
            required: false,
            default: DEFAULT_OPTIONS.gateField,
            validator: validators.noSpaces,
            error: 'gateField must not contain spaces'
        },

        // ── Step detection threshold ─────────────────────────────
        // numberOrFieldKeyed matches its siblings tightenBase/maxGap and the
        // resolveScalar call in init.js, so a per-field value is accepted.
        chi2Threshold: {
            type: 'numberOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.chi2Threshold,
            validator: validators.positive,
            error: 'chi2Threshold must be positive'
        },

        // ── 1-sample buffer for spike-region anchoring ──────────
        bufferPrev: {
            type: 'boolean',
            required: false,
            default: DEFAULT_OPTIONS.bufferPrev
        },
        timestampField: {
            type: 'string',
            required: false,
            validator: validators.noSpaces,
            error: 'timestampField must not contain spaces'
        }
    },

    crossFieldValidators: [
        {
            fields: [ 'stats', 'bufferPrev' ],
            validator: ( spec ) => {
                // xPrev and tPrev stats require bufferPrev to be true
                if ( ( spec.stats?.xPrev !== undefined || spec.stats?.tPrev !== undefined ) &&
                     !spec.bufferPrev ) {
                    return false;
                }
                return true;
            },
            error: 'xPrev and tPrev stats require bufferPrev: true'
        },
        {
            fields: [ 'stats', 'timestampField' ],
            validator: ( spec ) => {
                // tPrev stat requires timestampField
                if ( spec.stats?.tPrev !== undefined && spec.timestampField === undefined ) {
                    return false;
                }
                return true;
            },
            error: 'tPrev stat requires timestampField to be specified'
        }
    ],

    // Pattern: NAME_X_OUTPUTS_OPTIONS -> ( name, x, stats, options )
    buildSpec: ( name, x, stats, options ) => ( {
        nodeType: NODE_TYPE,
        name,
        from: { x },
        stats,
        ...options
    } )
};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );

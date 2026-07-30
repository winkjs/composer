// nodes/appraise/introspect.js

/**
 * @fileoverview Introspection metadata for the appraise node.
 *
 * Defines supported stats, control methods, capabilities, and DSL schema
 * for a two-layer SNN that accumulates evidence from multiple detection
 * signals and produces a stable conviction score.
 *
 * L1 receptor neurons (per source) provide LIF spiking, BLI intensity,
 * and rate persistence. L2 decision neuron accumulates weighted spikes
 * with MM readout. Signed weights enable excitatory/inhibitory synapses.
 *
 * Key differences from standard nodes:
 *   - `from.x`: string array of source field names (like esPairwiseCorrelation)
 *   - `sources`: keyed object with per-source config (signed weights)
 *   - `thresholds`: monitor / degraded / critical classification
 *   - `l2HalfLife`: optional L2 membrane decay (defaults to max L1 tau)
 *   - `messageRate`: optional messages per timestamp unit (for warmup calc)
 *
 * @see ADR-004
 */

import { validators } from '../../core/utils/validate/index.js';
import { DEVIATION_TYPES } from './deviation.js';

// ── Supported Statistics ────────────────────────────────────────────────────

const SUPPORTED_STATS = [
    'combined', 'state', 'charge',
    'rate', 'membrane', 'calibrating'
];

const STAT_DESCRIPTIONS = {
    combined: 'Conviction score via MM readout [0, 1)',
    state: 'Threshold classification label (Normal/Monitor/Degraded/Critical)',
    charge: 'Per-source BLI charge (published as {storeAs}_{sourceField} scalars)',
    rate: 'Per-source firing rate (published as {storeAs}_{sourceField} scalars)',
    membrane: 'L2 decision neuron raw membrane potential',
    calibrating: 'Burn-in calibration active flag (boolean)'
};

// ── Control Methods ─────────────────────────────────────────────────────────

const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears all charges and resets state to Normal',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause'
};

// ── Node Identity ───────────────────────────────────────────────────────────

const NODE_TYPE = 'Appraise';

// ── Capabilities ────────────────────────────────────────────────────────────

const CAPABILITIES = {
    description: 'Two-layer SNN that accumulates evidence from multiple detection signals into a stable conviction score',
    features: [
        'L1 receptor neurons: LIF spiking + BLI intensity + Rate persistence per source',
        'L2 decision neuron: unbounded leaky accumulation with MM readout',
        'Excitatory/inhibitory synapses via signed weights',
        'Burn-in calibration: Theta learned from warmup baseline',
        'Michaelis-Menten normalization — one theta per source',
        'Five deviation types: identity, absolute, highExceedance, lowExceedance, bandExceedance',
        'Exponential decay with configurable half-life (global default, per-source override)',
        'Per-source charge and rate published as named scalars — compose categorize downstream for labels',
        'Zero allocation in hot path'
    ]
};

// ── Default Options ─────────────────────────────────────────────────────────

const DEFAULT_OPTIONS = {};

// ── Validators ──────────────────────────────────────────────────────────────

const deviationTypes = Array.from( DEVIATION_TYPES );
const isDeviationType = validators.oneOf( deviationTypes );

// Inline validator: non-zero finite number (allows negative for inhibitory synapses)
const nonZeroFinite = ( v ) => ( Number.isFinite( v ) && ( v !== 0 ) );

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
                    type: 'array',
                    required: true,
                    minItems: 1,
                    maxItems: 20,
                    itemSchema: {
                        type: 'string',
                        validator: validators.noSpaces,
                        error: 'source field name must not contain spaces'
                    }
                }
            }
        },
        sources: {
            type: 'object',
            required: true,
            minProperties: 1,
            maxProperties: 20,
            propertySchema: {
                type: 'object',
                required: true,
                properties: {
                    deviation: {
                        type: 'string',
                        required: true,
                        validator: isDeviationType,
                        error: `source.deviation must be one of: ${deviationTypes.join( ', ' )}`
                    },
                    theta: {
                        type: 'number',
                        required: true,
                        validator: validators.positive,
                        error: 'source.theta must be a positive number'
                    },
                    weight: {
                        type: 'number',
                        required: true,
                        validator: nonZeroFinite,
                        error: 'source.weight must be a non-zero finite number'
                    },
                    halfLife: {
                        type: 'number',
                        required: false,
                        validator: validators.positive,
                        error: 'source.halfLife must be a positive number'
                    },
                    baseline: {
                        type: 'number',
                        required: false,
                        validator: validators.isFinite,
                        error: 'source.baseline must be a finite number'
                    },
                    band: {
                        type: 'object',
                        required: false,
                        properties: {
                            lower: {
                                type: 'number',
                                required: true,
                                validator: validators.isFinite,
                                error: 'band.lower must be a finite number'
                            },
                            upper: {
                                type: 'number',
                                required: true,
                                validator: validators.isFinite,
                                error: 'band.upper must be a finite number'
                            }
                        }
                    }
                }
            }
        },
        halfLife: {
            type: 'number',
            required: true,
            validator: validators.positive,
            error: 'halfLife must be a positive number'
        },
        l2HalfLife: {
            type: 'number',
            required: false,
            validator: validators.positive,
            error: 'l2HalfLife must be a positive number'
        },
        messageRate: {
            type: 'number',
            required: false,
            validator: validators.positive,
            error: 'messageRate must be a positive number'
        },
        thresholds: {
            type: 'object',
            required: true,
            properties: {
                monitor: {
                    type: 'object',
                    required: true,
                    properties: {
                        at: {
                            type: 'number',
                            required: true,
                            validator: validators.positive,
                            error: 'thresholds.monitor.at must be a positive number'
                        },
                        action: {
                            type: 'string',
                            required: true,
                            validator: validators.nonEmptyString,
                            error: 'thresholds.monitor.action must be a non-empty string'
                        }
                    }
                },
                degraded: {
                    type: 'object',
                    required: true,
                    properties: {
                        at: {
                            type: 'number',
                            required: true,
                            validator: validators.positive,
                            error: 'thresholds.degraded.at must be a positive number'
                        },
                        action: {
                            type: 'string',
                            required: true,
                            validator: validators.nonEmptyString,
                            error: 'thresholds.degraded.action must be a non-empty string'
                        }
                    }
                },
                critical: {
                    type: 'object',
                    required: true,
                    properties: {
                        at: {
                            type: 'number',
                            required: true,
                            validator: validators.positive,
                            error: 'thresholds.critical.at must be a positive number'
                        },
                        action: {
                            type: 'string',
                            required: true,
                            validator: validators.nonEmptyString,
                            error: 'thresholds.critical.action must be a non-empty string'
                        }
                    }
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

    crossFieldValidators: [
        {
            fields: [ 'thresholds' ],
            validator: ( spec ) => {
                const { monitor, degraded, critical } = spec.thresholds;
                return ( monitor.at < degraded.at ) && ( degraded.at < critical.at );
            },
            error: 'Threshold ordering must be: monitor.at < degraded.at < critical.at'
        },
        {
            fields: [ 'from.x' ],
            validator: ( spec ) => {
                const fields = spec.from.x;
                return ( new Set( fields ) ).size === fields.length;
            },
            error: 'Source field names in from.x must be unique'
        },
        {
            fields: [ 'from.x', 'sources' ],
            validator: ( spec ) => {
                const fields = spec.from.x;
                const keys = Object.keys( spec.sources );
                if ( fields.length !== keys.length ) return false;
                return fields.every( ( f ) => spec.sources[ f ] !== undefined );
            },
            error: 'Every from.x entry must have a matching key in sources, and vice versa'
        },
        {
            fields: [ 'sources' ],
            validator: ( spec ) => Object.values( spec.sources ).every( ( cfg ) => {
                if ( cfg.deviation === 'highExceedance' || cfg.deviation === 'lowExceedance' ) {
                    return cfg.baseline !== undefined;
                }
                return true;
            } ),
            error: 'highExceedance and lowExceedance deviation types require a baseline value'
        },
        {
            fields: [ 'sources' ],
            validator: ( spec ) => Object.values( spec.sources ).every( ( cfg ) => {
                if ( cfg.deviation === 'bandExceedance' ) {
                    return ( cfg.band !== undefined ) &&
                           ( typeof cfg.band === 'object' ) &&
                           ( cfg.band.lower < cfg.band.upper );
                }
                return true;
            } ),
            error: 'bandExceedance deviation type requires a band with lower < upper'
        },
        {
            fields: [ 'sources' ],
            validator: ( spec ) => Object.values( spec.sources ).some( ( cfg ) => cfg.weight > 0 ),
            error: 'At least one source must have a positive (excitatory) weight'
        }
    ],

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

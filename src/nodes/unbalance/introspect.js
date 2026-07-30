/**
 * @fileoverview Single source of truth for the unbalance node — supported
 * stats, capabilities, control methods, and the DSL/validation schema.
 * All getters return defensive copies. The `unbalance` stat is the general
 * normalized maximum deviation from the mean across N nominally-equal
 * channels; NEMA / IEEE PVUR is the named electrical instance of the same
 * computation. The `unbalance` percentage is relative: it divides by the mean,
 * so it means something only when the channels are energized/loaded. At idle the
 * inputs are sensor noise and the value comes out large but meaningless; gate
 * idle/off states upstream (the operating-gated metric composition pattern).
 *
 * Missing channels: by default any non-finite input blanks every output, because
 * an incomplete set is an undefined cross-field metric. The opt-in `skipOnNaN`
 * mode instead reports over the channels that are present, down to a `minPresent`
 * floor. The `presentCount` output reports how many channels reported and is
 * always the real count, even on a blanked tick.
 */

import { validators } from '../../core/utils/validate/index.js';

const SUPPORTED_STATS = [
    'mean',
    'min',
    'max',
    'range',
    'maxDev',
    'unbalance',
    'worstIndex',
    'worstDev',
    'presentCount'
];

const STAT_DESCRIPTIONS = {
    mean: 'Arithmetic mean of the N input magnitudes',
    min: 'Minimum input magnitude',
    max: 'Maximum input magnitude',
    range: 'max - min (peak-to-peak spread)',
    maxDev: 'Maximum absolute deviation from the mean',
    unbalance: 'Normalized max-deviation: ( maxDev / |mean| ) * 100. Relative metric — meaningful only when channels are energized/loaded; gate idle/off states (see the operating-gated metric pattern)',
    worstIndex: 'Zero-based index of the most-deviating input',
    worstDev: 'Signed deviation ( value - mean ) of the worst input',
    presentCount: 'How many channels reported (were finite) this tick. Always the real count, even when the metric blanks, because it describes the input not the result. Use it with skipOnNaN to gate on coverage'
};

const SUPPORTED_CONTROL_METHODS = {
    reset: 'No-op (stateless node)',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses update() while keeping last values visible via publishTo()',
    unpause: 'Resumes update() after pause'
};

const NODE_TYPE = 'Unbalance';

const CAPABILITIES = {
    description: 'Instantaneous cross-field unbalance over N nominally-equal magnitudes',
    features: [
        'Stateless and allocation-free',
        'Domain-agnostic (electrical, thermal, mechanical, process)',
        'Blank-on-miss by default: any missing channel makes every output NaN',
        'Opt-in skipOnNaN: report over the present channels, down to a minPresent floor',
        'presentCount output: how many channels reported, always the real count',
        'Worst-channel diagnostics (index and signed deviation)',
        'Single pass: worst channel derived from the min/max extremes'
    ]
};

export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

// Spec default values.
export const DEFAULT_OPTIONS = {
    skipOnNaN: false,   // blank every output if any channel is missing (the safe default)
    minPresent: 2       // when skipOnNaN is true, the fewest present channels that still compute
};

const DSL_METADATA = {
    specSchema: {
        nodeType: { type: 'string', required: true, value: NODE_TYPE },
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
                    minItems: 2,
                    itemSchema: {
                        type: 'string',
                        validator: validators.noSpaces,
                        error: 'field names cannot contain spaces'
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
                        minLength: 1,
                        validator: validators.identifier,
                        error: 'storeAs must be a valid identifier'
                    }
                }
            }
        },
        skipOnNaN: {
            type: 'boolean',
            required: false
        },
        minPresent: {
            // The effective default is conditional — n channels in blank mode, 2 in
            // skip mode (see DEFAULT_OPTIONS), so it is not a flat schema default. The
            // floor of 2 is where a spread is defined.
            type: 'number',
            required: false,
            integer: true,
            min: 2,
            error: 'minPresent must be an integer >= 2'
        }
    },

    crossFieldValidators: [
        {
            fields: [ 'from.x' ],
            validator: ( spec ) => ( new Set( spec.from.x ).size === spec.from.x.length ),
            error: 'field names must be unique'
        },
        {
            fields: [ 'minPresent', 'skipOnNaN' ],
            validator: ( spec ) => ( spec.minPresent === undefined ) || ( spec.skipOnNaN === true ),
            error: 'minPresent applies only when skipOnNaN is true'
        },
        {
            fields: [ 'minPresent', 'from.x' ],
            validator: ( spec ) => ( spec.minPresent === undefined ) || ( spec.minPresent <= spec.from.x.length ),
            error: 'minPresent cannot exceed the number of fields'
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

export const getDSLMetadata = () => ( { ...DSL_METADATA } );

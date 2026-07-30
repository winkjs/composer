/**
 * @fileoverview Single source of truth for the tally node — supported stats,
 * capabilities, control methods, and the DSL/validation schema. All getters
 * return defensive copies. `tally` is the logical member of the cross-field
 * family: it reduces N flag fields of one message to a single logical answer —
 * is any flag true (`any`), are all flags true (`all`), how many are true
 * (`count`). Flags are read by truthiness; a `NaN` flag is the one fault and
 * propagates as NaN to every output. `ratio` (two numeric fields) and
 * `unbalance` (N numeric fields, spread) are the numeric members of the family.
 */

import { validators } from '../../core/utils/validate/index.js';

const SUPPORTED_STATS = [
    'any',
    'all',
    'count'
];

const STAT_DESCRIPTIONS = {
    any: 'True if at least one input flag is truthy',
    all: 'True only if every input flag is truthy',
    count: 'How many input flags are truthy'
};

const SUPPORTED_CONTROL_METHODS = {
    reset: 'No-op (stateless node)',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses update() while keeping last values visible via publishTo()',
    unpause: 'Resumes update() after pause'
};

const NODE_TYPE = 'Tally';

const CAPABILITIES = {
    description: 'Instantaneous logical reduce over N flag fields in one message — any / all / count',
    features: [
        'Stateless and allocation-free',
        'Domain-agnostic (any boolean or truthy/falsy flag fields)',
        'Reads flags by truthiness; null / undefined / false / 0 count as not-true',
        'NaN propagation for fault isolation (a NaN flag -> every output NaN)',
        'Single pass: the count of truthy flags drives any (count >= 1) and all (count === N)'
    ]
};

export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

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
                    minItems: 1,
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
        }
    },

    crossFieldValidators: [
        {
            fields: [ 'from.x' ],
            validator: ( spec ) => ( new Set( spec.from.x ).size === spec.from.x.length ),
            error: 'field names must be unique'
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

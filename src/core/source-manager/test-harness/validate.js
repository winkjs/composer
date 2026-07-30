// core/source-manager/test-harness/validate.js

/**
 * @fileoverview Startup validation for testHarness.
 *
 * Two things to check before the harness starts running:
 *
 * 1. The `messageTemplate` config — it must declare a seed, at least
 *    one field, valid types, and (when fuzz is on) a target column.
 * 2. The asset class — it must declare `_harnessId` as an int64
 *    column. The cross-sink check tool uses this number to find the
 *    same message in every sink, so every sink must be able to
 *    store and report it.
 *
 * Validation runs through the shared `validateWithSchema` helper
 * (see `core/utils/validate`). On any failure we re-throw as a single
 * Error with `code = 'INVALID_CONFIG'` — the classified shape
 * ADR-018 mandates for setup failures. The message lists every
 * problem found so
 * the test author can fix them in one pass.
 */

import { validateWithSchema, validators } from '../../utils/validate/index.js';

const FIELD_TYPES = [ 'float64', 'int64', 'bool', 'string', 'timestamp' ];

/**
 * Schema for one entry in messageTemplate.fields.
 */
const FIELD_SPEC_SCHEMA = {
    type: 'object',
    properties: {
        type: {
            type: 'string',
            required: true,
            validator: validators.oneOf( FIELD_TYPES ),
            error: `must be one of ${FIELD_TYPES.join( ', ' )}`
        },
        range: {
            type: 'array',
            minItems: 2,
            maxItems: 2,
            itemSchema: { type: 'number' },
            validator: function ( arr ) {
                return arr[ 0 ] < arr[ 1 ];
            },
            error: 'must be [ min, max ] with min < max'
        },
        resolution: {
            type: 'number',
            validator: validators.positive,
            error: 'must be a positive number'
        },
        values: {
            type: 'array',
            minItems: 1
        },
        mode: {
            type: 'string',
            validator: validators.oneOf( [ 'monotonic-ms', 'static' ] ),
            error: 'must be "monotonic-ms" or "static"'
        }
        // `seedValue` accepts any type, so we omit it from the schema.
    }
};

/**
 * Schema for the messageTemplate config.
 *
 * Cross-field rules (handled by `_crossFieldValidators`):
 *   - fuzzTarget is required when fuzzInterval > 0
 *   - fuzzTarget must name a declared field
 *   - fields must not declare `_harnessId` (the harness adds it)
 */
export const MESSAGE_TEMPLATE_SCHEMA = {
    seed: {
        type: 'number',
        required: true,
        validator: validators.isFinite,
        error: 'seed must be a finite number'
    },
    messageCount: {
        type: 'number',
        validator: validators.positiveInteger,
        error: 'messageCount must be a positive integer'
    },
    intervalMs: {
        type: 'number',
        validator: validators.nonNegativeFinite,
        error: 'intervalMs must be a non-negative finite number'
    },
    fuzzInterval: {
        type: 'number',
        validator: function ( v ) {
            return Number.isInteger( v ) && v >= 0;
        },
        error: 'fuzzInterval must be a non-negative integer'
    },
    fuzzTarget: {
        type: 'string'
    },
    fields: {
        type: 'object',
        required: true,
        minProperties: 1,
        propertySchema: FIELD_SPEC_SCHEMA
    },
    _crossFieldValidators: [
        {
            fields: [ 'fuzzInterval', 'fuzzTarget' ],
            validator: function ( obj ) {
                if ( !( obj.fuzzInterval > 0 ) ) return true;
                return typeof obj.fuzzTarget === 'string' && obj.fuzzTarget.length > 0;
            },
            error: 'fuzzTarget is required when fuzzInterval > 0'
        },
        {
            fields: [ 'fuzzTarget', 'fields' ],
            validator: function ( obj ) {
                if ( !obj.fuzzTarget ) return true;
                return obj.fuzzTarget in obj.fields;
            },
            error: 'fuzzTarget must name a declared field'
        },
        {
            fields: [ 'fields' ],
            validator: function ( obj ) {
                return !( '_harnessId' in obj.fields );
            },
            error: 'fields must not declare "_harnessId" — the harness adds it automatically'
        },
        {
            fields: [ 'fields' ],
            validator: function ( obj ) {
                for ( const spec of Object.values( obj.fields ) ) {
                    if ( spec.type === 'string' ) {
                        if ( !Array.isArray( spec.values ) || spec.values.length === 0 ) {
                            return false;
                        }
                    }
                }
                return true;
            },
            error: 'fields with type "string" must declare a non-empty values: [ ... ] list'
        }
    ]
};

/**
 * Schema for the asset class. Only checks the parts the harness
 * cares about — `_harnessId` declared as an int64 column. Other
 * columns may exist; we do not look at them here.
 */
export const ASSET_CLASS_SCHEMA = {
    columns: {
        type: 'object',
        required: true,
        properties: {
            _harnessId: {
                type: 'object',
                required: true,
                properties: {
                    type: {
                        type: 'string',
                        required: true,
                        value: 'int64',
                        error: 'must be int64'
                    }
                }
            }
        }
    }
};

const throwInvalidConfig = function ( errors ) {
    const err = new Error( `testHarness: ${errors.join( '; ' )}` );
    err.code = 'INVALID_CONFIG';
    throw err;
};

/**
 * Validates the messageTemplate. Throws Error with
 * `code = 'INVALID_CONFIG'` if anything fails.
 *
 * @param {Object} template - messageTemplate from config
 */
export const validateMessageTemplate = function ( template ) {
    if ( !template || typeof template !== 'object' ) {
        throwInvalidConfig( [ 'messageTemplate is required (object)' ] );
    }
    const result = validateWithSchema( MESSAGE_TEMPLATE_SCHEMA, template, 'messageTemplate' );
    if ( !result.valid ) {
        throwInvalidConfig( result.errors );
    }
};

/**
 * Validates the asset class. The harness needs `_harnessId` as an
 * int64 column — the check tool uses this number to find the same
 * message across sinks. Throws Error with
 * `code = 'INVALID_CONFIG'` if anything fails.
 *
 * @param {Object} assetClass - The asset class declared by the test
 */
export const validateAssetClass = function ( assetClass ) {
    if ( !assetClass || typeof assetClass !== 'object' ) {
        throwInvalidConfig( [ 'assetClass is required in config' ] );
    }
    const result = validateWithSchema( ASSET_CLASS_SCHEMA, assetClass, 'assetClass' );
    if ( !result.valid ) {
        throwInvalidConfig( result.errors );
    }
};

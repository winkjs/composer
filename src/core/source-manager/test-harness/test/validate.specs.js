// core/source-manager/test-harness/test/validate.specs.js

/**
 * @fileoverview Tests for startup validation.
 *
 * Both validators throw an Error with `code = 'INVALID_CONFIG'` on
 * any problem. These tests check the success path and every failure
 * mode the harness's contract relies on.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { validateMessageTemplate, validateAssetClass } from '../validate.js';

const validTemplate = function ( overrides = {} ) {
    return {
        seed: 42,
        fields: {
            temperature: { type: 'float64', range: [ 20, 30 ], resolution: 0.01 }
        },
        ...overrides
    };
};

const validAssetClass = function ( overrides = {} ) {
    return {
        columns: {
            _harnessId: { type: 'int64' },
            temperature: { type: 'float64', resolution: 0.01 },
            ...overrides
        }
    };
};

describe( 'testHarness — validateMessageTemplate (success)', function () {

    it( 'accepts a minimal valid template', function () {
        expect( () => validateMessageTemplate( validTemplate() ) ).to.not.throw();
    } );

    it( 'accepts a template with all optional fields set', function () {
        expect( () => validateMessageTemplate( validTemplate( {
            messageCount: 500,
            intervalMs: 100,
            fuzzInterval: 50,
            fuzzTarget: 'temperature'
        } ) ) ).to.not.throw();
    } );

    it( 'accepts a template with multiple fields and types', function () {
        expect( () => validateMessageTemplate( {
            seed: 1,
            fields: {
                temperature: { type: 'float64', range: [ 20, 30 ], resolution: 0.01 },
                rpm: { type: 'int64', range: [ 0, 1000 ] },
                running: { type: 'bool' },
                state: { type: 'string', values: [ 'idle', 'run' ] },
                ts: { type: 'timestamp', mode: 'monotonic-ms', seedValue: 1700000000 }
            }
        } ) ).to.not.throw();
    } );

} );

describe( 'testHarness — validateMessageTemplate (failure)', function () {

    const expectInvalidConfig = function ( bad, contains ) {
        let thrown;
        try {
            validateMessageTemplate( bad );
        } catch ( err ) {
            thrown = err;
        }
        expect( thrown, 'should have thrown' ).to.be.an( 'error' );
        expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        expect( thrown.message ).to.contain( contains );
    };

    it( 'throws when template is null', function () {
        expectInvalidConfig( null, 'messageTemplate is required' );
    } );

    it( 'throws when template is not an object', function () {
        expectInvalidConfig( 'no', 'messageTemplate is required' );
    } );

    it( 'throws when seed is missing', function () {
        const bad = validTemplate();
        delete bad.seed;
        expectInvalidConfig( bad, 'seed' );
    } );

    it( 'throws when seed is not a finite number', function () {
        expectInvalidConfig( validTemplate( { seed: NaN } ), 'seed' );
    } );

    it( 'throws when fields is missing', function () {
        expectInvalidConfig( { seed: 1 }, 'fields' );
    } );

    it( 'throws when fields is empty', function () {
        expectInvalidConfig( { seed: 1, fields: {} }, 'fields' );
    } );

    it( 'throws when a field has an unknown type', function () {
        expectInvalidConfig( {
            seed: 1,
            fields: { x: { type: 'date' } }
        }, 'one of float64' );
    } );

    it( 'throws when a string field has no values list', function () {
        expectInvalidConfig( {
            seed: 1,
            fields: { x: { type: 'string' } }
        }, 'values' );
    } );

    it( 'throws when range is not a 2-element array', function () {
        expectInvalidConfig( {
            seed: 1,
            fields: { x: { type: 'float64', range: [ 1 ] } }
        }, 'range' );
    } );

    it( 'throws when range min >= max', function () {
        expectInvalidConfig( {
            seed: 1,
            fields: { x: { type: 'float64', range: [ 5, 5 ] } }
        }, 'min < max' );
    } );

    it( 'throws when resolution is not positive', function () {
        expectInvalidConfig( {
            seed: 1,
            fields: { x: { type: 'float64', resolution: 0 } }
        }, 'positive number' );
    } );

    it( 'throws when fuzzInterval is positive but fuzzTarget is missing', function () {
        expectInvalidConfig( validTemplate( { fuzzInterval: 100 } ), 'fuzzTarget is required' );
    } );

    it( 'throws when fuzzTarget is not a declared field', function () {
        expectInvalidConfig( validTemplate( {
            fuzzInterval: 100,
            fuzzTarget: 'no-such-field'
        } ), 'must name a declared field' );
    } );

    it( 'throws when fields tries to declare _harnessId', function () {
        expectInvalidConfig( {
            seed: 1,
            fields: {
                _harnessId: { type: 'int64' },
                temperature: { type: 'float64' }
            }
        }, '_harnessId' );
    } );

    it( 'throws when messageCount is not a positive integer', function () {
        expectInvalidConfig( validTemplate( { messageCount: 0 } ), 'messageCount' );
    } );

    it( 'throws when intervalMs is negative', function () {
        expectInvalidConfig( validTemplate( { intervalMs: -1 } ), 'intervalMs' );
    } );

} );

describe( 'testHarness — validateAssetClass (success)', function () {

    it( 'accepts an asset class with _harnessId int64', function () {
        expect( () => validateAssetClass( validAssetClass() ) ).to.not.throw();
    } );

} );

describe( 'testHarness — validateAssetClass (failure)', function () {

    const expectInvalidConfig = function ( bad, contains ) {
        let thrown;
        try {
            validateAssetClass( bad );
        } catch ( err ) {
            thrown = err;
        }
        expect( thrown, 'should have thrown' ).to.be.an( 'error' );
        expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        expect( thrown.message ).to.contain( contains );
    };

    it( 'throws when assetClass is null', function () {
        expectInvalidConfig( null, 'assetClass is required' );
    } );

    it( 'throws when columns is missing', function () {
        expectInvalidConfig( {}, 'columns' );
    } );

    it( 'throws when _harnessId column is missing', function () {
        expectInvalidConfig( {
            columns: { temperature: { type: 'float64' } }
        }, '_harnessId' );
    } );

    it( 'throws when _harnessId is declared but with the wrong type', function () {
        expectInvalidConfig( {
            columns: { _harnessId: { type: 'string' } }
        }, 'int64' );
    } );

} );

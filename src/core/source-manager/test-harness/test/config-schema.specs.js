// core/source-manager/test-harness/test/config-schema.specs.js

/* eslint-disable no-underscore-dangle -- _propertyNames is the validator's meta key. */

/**
 * @fileoverview Tests for the testHarness source's `configSchema` export.
 *
 * The flow runtime calls `validateWithSchema( testHarness.configSchema,
 * config )` at DSL time. These tests check the schema directly. Unknown
 * keys are rejected via the schema's `_propertyNames` list — the only
 * unknown-key mechanism the validator has (validate.js:68-77). Added by
 * the 2026-07-09 uniformity sweep: the harness was the last source
 * whose schema accepted unknown keys silently.
 *
 * `onMessage` and `onShutdown` are deliberately NOT in the schema: the
 * flow runtime injects them after DSL validation.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { configSchema } from '../index.js';
import { validateWithSchema } from '../../../utils/validate/index.js';

const validate = function ( config ) {
    return validateWithSchema( configSchema, config, 'config' );
};

const minimalConfig = function () {
    return {
        messageTemplate: {
            seed: 42,
            fields: {
                temperature: { type: 'float64', range: [ 20, 30 ], resolution: 0.01 }
            }
        },
        assetClass: {
            columns: {
                _harnessId: { type: 'int64' },
                temperature: { type: 'float64', resolution: 0.01 }
            }
        }
    };
};

describe( 'testHarness — configSchema key discipline', function () {

    it( 'configSchema declares every user-supplied field', function () {
        const expected = [
            'messageTemplate',
            'assetClass',
            'onStatus',
            'shutdownOnComplete'
        ];
        const fieldNames = Object.keys( configSchema )
            .filter( ( key ) => !key.startsWith( '_' ) );
        expect( fieldNames ).to.have.members( expected );
    } );

    it( '_propertyNames lists exactly the schema field names', function () {
        // Self-consistency: every declared field is an allowed key and
        // vice versa, so the schema cannot drift from its own key list.
        const fieldNames = Object.keys( configSchema )
            .filter( ( key ) => !key.startsWith( '_' ) )
            .sort();
        const allowed = [ ...configSchema._propertyNames ].sort();
        expect( allowed ).to.deep.equal( fieldNames );
    } );

    it( 'does not declare runtime-injected callbacks (onMessage, onShutdown)', function () {
        expect( configSchema ).to.not.have.property( 'onMessage' );
        expect( configSchema ).to.not.have.property( 'onShutdown' );
        expect( configSchema._propertyNames.includes( 'onMessage' ) ).to.equal( false );
        expect( configSchema._propertyNames.includes( 'onShutdown' ) ).to.equal( false );
    } );

    it( 'accepts the minimal config (messageTemplate + assetClass)', function () {
        const result = validate( minimalConfig() );
        expect( result.valid ).to.equal( true );
        expect( result.errors ).to.have.lengthOf( 0 );
    } );

    it( 'accepts onStatus as a function and shutdownOnComplete as a boolean', function () {
        const noop = function () {
            return undefined;
        };
        const cfg = { ...minimalConfig(), onStatus: noop, shutdownOnComplete: false };
        expect( validate( cfg ).valid ).to.equal( true );
    } );

    it( 'rejects onStatus that is not a function', function () {
        const result = validate( { ...minimalConfig(), onStatus: 'log-it' } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /onStatus/ );
    } );

    it( 'rejects shutdownOnComplete that is not a boolean', function () {
        const result = validate( { ...minimalConfig(), shutdownOnComplete: 1 } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /shutdownOnComplete/ );
    } );

    it( 'rejects an unknown key (typo) — fail fast at DSL time', function () {
        const result = validate( { ...minimalConfig(), messageTemplat: {} } );
        expect( result.valid ).to.equal( false );
        expect( result.errors.some( ( e ) => ( /Unknown property 'messageTemplat'/ ).test( e ) ) ).to.equal( true );
    } );

    it( 'rejects the retired onComplete key — completion travels onStatus (ADR-018)', function () {
        const result = validate( { ...minimalConfig(), onComplete: () => undefined } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /Unknown property 'onComplete'/ );
    } );

} );

// core/source-manager/csv/test/config-schema.specs.js

/* eslint-disable no-underscore-dangle -- _propertyNames is the validator's meta key. */

/**
 * @fileoverview Tests for the CSV source's `configSchema` export.
 *
 * The flow runtime calls `validateWithSchema( csv.configSchema, config )`
 * at DSL time (`flow.source( csv, config )`). These tests check the
 * schema directly to keep failures precise — a single bad field shows
 * up as one assertion, not as a cascade of pipeline-level errors.
 *
 * Coverage:
 * - Schema export shape (id, configSchema fields, default factory).
 * - Required `path` is enforced; missing or empty `path` is rejected.
 * - Each optional field accepts its declared type and rejects others.
 * - `startMsgId` / `endMsgId` accept either a finite number or a
 *   non-empty string (the CSV adapter resolves the type at run time).
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import csvAdapter, { configSchema, durabilityClass, id, start } from '../index.js';
import { validateWithSchema } from '../../../utils/validate/index.js';

const validate = function ( config ) {
    return validateWithSchema( configSchema, config, 'config' );
};

describe( 'CSV Source — module exports', function () {

    it( 'exports id as "csv"', function () {
        expect( id ).to.equal( 'csv' );
    } );

    it( 'exports configSchema as an object', function () {
        expect( configSchema ).to.be.an( 'object' );
    } );

    it( 'exports start as a function', function () {
        expect( start ).to.be.a( 'function' );
    } );

    it( 'exports default { id, configSchema, durabilityClass, start }', function () {
        expect( csvAdapter ).to.deep.equal( { id, configSchema, durabilityClass, start } );
    } );

    it( 'configSchema declares every user-supplied field', function () {
        const expected = [
            'path',
            'delayMs',
            'dynamicTyping',
            'transform',
            'onStatus',
            'shutdownOnComplete',
            'idField',
            'startMsgId',
            'endMsgId'
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

    it( 'rejects an unknown key (typo) — fail fast at DSL time', function () {
        const result = validate( { path: './data.csv', dealyMs: 50 } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /Unknown property 'dealyMs'/ );
    } );

    it( 'rejects the retired onComplete key — completion travels onStatus (ADR-018)', function () {
        const result = validate( { path: './data.csv', onComplete: () => undefined } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /Unknown property 'onComplete'/ );
    } );

    it( 'configSchema does not declare runtime-injected callbacks', function () {
        // onMessage / onShutdown are added by the wiring layer, not by
        // the user — they MUST NOT appear in the user-facing schema.
        expect( configSchema ).to.not.have.property( 'onMessage' );
        expect( configSchema ).to.not.have.property( 'onShutdown' );
        expect( configSchema._propertyNames.includes( 'onMessage' ) ).to.equal( false );
        expect( configSchema._propertyNames.includes( 'onShutdown' ) ).to.equal( false );
    } );

    it( 'path is the only required field', function () {
        expect( configSchema.path.required ).to.equal( true );
        const optionalKeys = Object.keys( configSchema )
            .filter( ( k ) => k !== 'path' && !k.startsWith( '_' ) );
        for ( const key of optionalKeys ) {
            expect( configSchema[ key ].required, `${key}.required` ).to.equal( false );
        }
    } );

} );

describe( 'CSV Source — required field: path', function () {

    it( 'rejects missing path', function () {
        const result = validate( {} );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /path: Required field missing/ );
    } );

    it( 'rejects empty-string path', function () {
        const result = validate( { path: '' } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /path must be a non-empty string/ );
    } );

    it( 'rejects non-string path (number)', function () {
        const result = validate( { path: 42 } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /path: Expected string, got number/ );
    } );

    it( 'accepts a non-empty path', function () {
        const result = validate( { path: './data.csv' } );
        expect( result.valid ).to.equal( true );
        expect( result.errors ).to.have.lengthOf( 0 );
    } );

    it( 'throwIfInvalid throws TypeError with adapter id in message', function () {
        const result = validate( {} );
        expect( () => result.throwIfInvalid( 'flow.source.csv' ) )
            .to.throw( TypeError, /winkComposer\/flow\.source\.csv: validation failed/ );
    } );

} );

describe( 'CSV Source — optional fields: types', function () {

    const baseConfig = { path: './data.csv' };

    it( 'accepts delayMs as a non-negative number', function () {
        expect( validate( { ...baseConfig, delayMs: 0 } ).valid ).to.equal( true );
        expect( validate( { ...baseConfig, delayMs: 250 } ).valid ).to.equal( true );
    } );

    it( 'rejects negative delayMs', function () {
        const result = validate( { ...baseConfig, delayMs: -1 } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /delayMs must be a non-negative finite number/ );
    } );

    it( 'rejects non-finite delayMs (Infinity, NaN)', function () {
        expect( validate( { ...baseConfig, delayMs: Infinity } ).valid ).to.equal( false );
        expect( validate( { ...baseConfig, delayMs: NaN } ).valid ).to.equal( false );
    } );

    it( 'rejects delayMs as string', function () {
        const result = validate( { ...baseConfig, delayMs: '100' } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /delayMs: Expected number/ );
    } );

    it( 'accepts dynamicTyping true and false', function () {
        expect( validate( { ...baseConfig, dynamicTyping: true } ).valid ).to.equal( true );
        expect( validate( { ...baseConfig, dynamicTyping: false } ).valid ).to.equal( true );
    } );

    it( 'rejects non-boolean dynamicTyping', function () {
        const result = validate( { ...baseConfig, dynamicTyping: 1 } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /dynamicTyping: Expected boolean/ );
    } );

    it( 'accepts transform as a function', function () {
        const transform = function ( r ) {
            return r;
        };
        expect( validate( { ...baseConfig, transform } ).valid ).to.equal( true );
    } );

    it( 'rejects transform as null (must be omitted, not nulled)', function () {
        const result = validate( { ...baseConfig, transform: null } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /transform: Expected function/ );
    } );

    it( 'accepts onStatus as a function', function () {
        const noop = function () {
            return undefined;
        };
        expect( validate( { ...baseConfig, onStatus: noop } ).valid ).to.equal( true );
    } );

    it( 'accepts shutdownOnComplete as boolean', function () {
        expect( validate( { ...baseConfig, shutdownOnComplete: false } ).valid ).to.equal( true );
    } );

    it( 'accepts idField as a non-empty string', function () {
        expect( validate( { ...baseConfig, idField: 'eventId' } ).valid ).to.equal( true );
    } );

    it( 'rejects empty idField', function () {
        const result = validate( { ...baseConfig, idField: '' } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /idField must be a non-empty string/ );
    } );

} );

describe( 'CSV Source — startMsgId / endMsgId polymorphism', function () {

    const baseConfig = { path: './data.csv' };

    it( 'accepts startMsgId as a finite number', function () {
        expect( validate( { ...baseConfig, startMsgId: 100 } ).valid ).to.equal( true );
        expect( validate( { ...baseConfig, startMsgId: 0 } ).valid ).to.equal( true );
    } );

    it( 'accepts startMsgId as a non-empty string', function () {
        expect( validate( { ...baseConfig, startMsgId: 'evt-001' } ).valid ).to.equal( true );
    } );

    it( 'rejects startMsgId as Infinity', function () {
        const result = validate( { ...baseConfig, startMsgId: Infinity } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /startMsgId must be a finite number or a non-empty string/ );
    } );

    it( 'rejects startMsgId as empty string', function () {
        const result = validate( { ...baseConfig, startMsgId: '' } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /startMsgId must be a finite number or a non-empty string/ );
    } );

    it( 'rejects startMsgId as null', function () {
        const result = validate( { ...baseConfig, startMsgId: null } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /startMsgId must be a finite number or a non-empty string/ );
    } );

    it( 'rejects startMsgId as boolean', function () {
        const result = validate( { ...baseConfig, startMsgId: true } );
        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.match( /startMsgId must be a finite number or a non-empty string/ );
    } );

    it( 'endMsgId follows the same rules as startMsgId', function () {
        expect( validate( { ...baseConfig, endMsgId: 1000 } ).valid ).to.equal( true );
        expect( validate( { ...baseConfig, endMsgId: 'evt-end' } ).valid ).to.equal( true );
        expect( validate( { ...baseConfig, endMsgId: '' } ).valid ).to.equal( false );
    } );

    it( 'accepts both startMsgId and endMsgId together', function () {
        const result = validate( { ...baseConfig, startMsgId: 0, endMsgId: 100 } );
        expect( result.valid ).to.equal( true );
    } );

} );

describe( 'CSV Source — full valid configs (smoke)', function () {

    it( 'accepts the minimal config { path }', function () {
        expect( validate( { path: './data.csv' } ).valid ).to.equal( true );
    } );

    it( 'accepts a fully-populated config', function () {
        const transform = function ( r ) {
            return r;
        };
        const noop = function () {
            return undefined;
        };
        const result = validate( {
            path: './data.csv',
            delayMs: 50,
            dynamicTyping: true,
            transform,
            onStatus: noop,
            shutdownOnComplete: false,
            idField: 'eventId',
            startMsgId: 'evt-100',
            endMsgId: 'evt-999'
        } );
        expect( result.valid ).to.equal( true );
    } );

    it( 'reports every problem at once when multiple fields are bad', function () {
        const result = validate( {
            path: '',
            delayMs: -10,
            dynamicTyping: 'yes'
        } );
        expect( result.valid ).to.equal( false );
        expect( result.errors.length ).to.be.at.least( 3 );
    } );

} );

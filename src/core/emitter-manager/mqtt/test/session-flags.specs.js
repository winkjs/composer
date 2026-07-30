// core/emitter-manager/mqtt/test/session-flags.specs.js

/**
 * @fileoverview MQTT emitter — session flags handed to mqtt.connect.
 *
 * The emitter is publish-only, so
 * it asks the broker for a clean session and no session retention —
 * spelled with the option key mqtt.js actually reads (`clean`). The
 * MQTT 5 spelling `cleanStart` is silently ignored by mqtt.js; the
 * source shipped that exact defect until 2026-07-09 (ADR-022). The
 * guard tests here keep the misspelled key from returning to this
 * adapter's code (comments may still name it to warn readers).
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { createEmitter } from '../emitter.js';
import { MQTT_CONFIG } from '../constants.js';
import { makeMockClient, testCodec } from './test-helpers.js';

// Collects every key present on a value, walking nested objects and
// arrays, so an option smuggled in at any depth is still seen. The
// `seen` set breaks cycles — the real options carry a
// UniqueMessageIdProvider whose allocator holds circular references.
const collectKeysDeep = function ( value, keys = new Set(), seen = new WeakSet() ) {
    if ( value === null || typeof value !== 'object' ) {
        return keys;
    }
    if ( seen.has( value ) ) {
        return keys;
    }
    seen.add( value );
    if ( Array.isArray( value ) ) {
        for ( let i = 0; i < value.length; i += 1 ) {
            collectKeysDeep( value[ i ], keys, seen );
        }
        return keys;
    }
    for ( const k of Object.keys( value ) ) {
        keys.add( k );
        collectKeysDeep( value[ k ], keys, seen );
    }
    return keys;
}; // collectKeysDeep()

// Strips block and line comments so the file-text guard checks code,
// not the comment that legitimately documents the old defect.
const stripComments = function ( source ) {
    return source
        .replace( /\/\*[\s\S]*?\*\//g, '' )
        .replace( /\/\/[^\n]*/g, '' );
}; // stripComments()

describe( 'mqtt emitter — session flags', function () {

    let mockConnect;
    let emitter;

    beforeEach( function () {
        const mock = makeMockClient();
        mockConnect = sinon.stub().returns( mock.client );
        emitter = createEmitter( {
            brokerUrl: 'mqtt://localhost',
            // Grace disabled: this beforeEach is synchronous, and the
            // mock client never fires connect.
            connectGraceMs: 0,
            codec: testCodec,
            mqttConnectFn: mockConnect
        } );
    } );

    afterEach( async function () {
        if ( emitter ) {
            await Promise.resolve( emitter.shutdown() ).catch( () => undefined );
            emitter = null;
        }
        sinon.restore();
    } );

    describe( 'options handed to mqtt.connect', function () {

        it( 'requests a clean session via the key mqtt.js reads', function () {
            const options = mockConnect.firstCall.args[ 1 ];
            expect( options.clean ).to.equal( true );
        } );

        it( 'carries no ignored cleanStart key at any depth', function () {
            const options = mockConnect.firstCall.args[ 1 ];
            const keys = collectKeysDeep( options );
            expect( keys.has( 'cleanStart' ) ).to.equal( false );
        } );

        it( 'requests no broker-side session retention', function () {
            const options = mockConnect.firstCall.args[ 1 ];
            expect( options.properties ).to.equal( undefined );
        } );

        it( 'still speaks MQTT protocol version 5', function () {
            const options = mockConnect.firstCall.args[ 1 ];
            // 5 is the on-wire protocolVersion for MQTT 5 (mqtt.js API docs).
            expect( options.protocolVersion ).to.equal( 5 );
        } );
    } );

    describe( 'regression guards', function () {

        it( 'MQTT_CONFIG carries clean: true and no session-retention keys', function () {
            const keys = collectKeysDeep( MQTT_CONFIG );
            expect( MQTT_CONFIG.clean ).to.equal( true );
            expect( keys.has( 'cleanStart' ) ).to.equal( false );
            expect( keys.has( 'sessionExpiryInterval' ) ).to.equal( false );
        } );

        it( 'no production file in emitter-manager uses cleanStart in code', function () {
            const here = path.dirname( fileURLToPath( import.meta.url ) );
            const adapterRoot = path.resolve( here, '..', '..' );
            const entries = readdirSync( adapterRoot, { recursive: true } );

            const productionFiles = entries.filter( ( entry ) => {
                const p = String( entry );
                const isTestOrDemo = p.includes( `test${path.sep}` ) ||
                    p.includes( 'demo' ) ||
                    p.includes( 'view-msgs' );
                return p.endsWith( '.js' ) && !isTestOrDemo;
            } );

            // The walk must actually find the adapter — an empty list
            // would make this guard pass vacuously.
            expect( productionFiles.length ).to.be.greaterThan( 0 );

            for ( const file of productionFiles ) {
                const source = readFileSync( path.join( adapterRoot, String( file ) ), 'utf8' );
                const code = stripComments( source );
                expect( code.includes( 'cleanStart' ) ).to.equal(
                    false,
                    `misspelled session key found in ${file} — mqtt.js reads 'clean', not 'cleanStart'`
                );
            }
        } );
    } );
} );

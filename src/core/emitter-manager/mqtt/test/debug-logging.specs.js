// core/emitter-manager/mqtt/test/debug-logging.specs.js

/**
 * @fileoverview MQTT emitter — debug logging.
 *
 * Broker URLs may carry credentials (`mqtt://user:pass@host`). The
 * debug connect log must never print them — a debug flag flipped on in
 * production would otherwise leak the broker password into whatever
 * collects stdout. The rule pinned here: secrets never reach logs.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createEmitter } from '../emitter.js';
import { makeMockClient, fireConnect, testCodec } from './test-helpers.js';

describe( 'mqtt emitter — debug logging', function () {

    let mock;
    let logStub;

    const makeEmitter = function ( brokerUrl ) {
        return createEmitter( {
            brokerUrl,
            connectGraceMs: 0,
            codec: testCodec,
            debug: true,
            mqttConnectFn: () => mock.client
        } );
    };

    beforeEach( function () {
        mock = makeMockClient();
        logStub = sinon.stub( console, 'log' );
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'never prints broker credentials in the connect log', function () {
        makeEmitter( 'mqtt://svc-user:s3cret-pw@broker.local:1883' );
        fireConnect( mock.eventHandlers );

        expect( logStub.calledOnce ).to.equal( true );
        const line = logStub.firstCall.args[ 0 ];
        expect( line ).to.not.contain( 's3cret-pw' );
        expect( line ).to.not.contain( 'svc-user' );
        // The host stays visible — that is the diagnostic value of the line.
        expect( line ).to.contain( 'broker.local:1883' );
    } );

    it( 'prints a credential-free url unchanged', function () {
        makeEmitter( 'mqtt://broker.local:1883' );
        fireConnect( mock.eventHandlers );

        expect( logStub.calledOnce ).to.equal( true );
        expect( logStub.firstCall.args[ 0 ] ).to.contain( 'mqtt://broker.local:1883' );
    } );

} );

// Moved verbatim from the former emitter.specs.js monolith (2026-07-09
// split; moves not rewrites).
describe( 'mqtt emitter — debug event logs', function () {

    let mockClient;
    let mockConnect;
    let emitter;
    let eventHandlers;

    beforeEach( function () {
        const mock = makeMockClient();
        mockClient = mock.client;
        eventHandlers = mock.eventHandlers;
        mockConnect = sinon.stub().returns( mockClient );
    } );

    afterEach( async function () {
        if ( emitter ) {
            await Promise.resolve( emitter.shutdown() ).catch( () => undefined );
            emitter = null;
        }

        sinon.restore();
    } );

        it( 'logs connect when debug=true', function () {
            const originalLog = console.log;
            let logged = false;
            console.log = ( msg ) => {
                if ( msg.includes( 'Connected' ) ) {
                    logged = true;
                }
            };

            try {
                emitter = createEmitter( {
                    brokerUrl: 'mqtt://localhost',
                    connectGraceMs: 0,
                    codec: testCodec,
                    debug: true,
                    mqttConnectFn: mockConnect
                } );

                eventHandlers.connect();
                expect( logged ).to.equal( true );
            } finally {
                console.log = originalLog;
            }
        } );

        it( 'logs offline with the in-flight count when debug=true', function () {
            const originalLog = console.log;
            let logged = false;
            console.log = ( msg ) => {
                if ( msg.includes( 'Offline' ) && msg.includes( 'messages in flight' ) ) {
                    logged = true;
                }
            };

            try {
                emitter = createEmitter( {
                    brokerUrl: 'mqtt://localhost',
                    connectGraceMs: 0,
                    codec: testCodec,
                    debug: true,
                    mqttConnectFn: mockConnect
                } );

                eventHandlers.connect();
                eventHandlers.offline();
                expect( logged ).to.equal( true );
            } finally {
                console.log = originalLog;
            }
        } );

        it( 'logs errors when debug=true', function () {
            const originalError = console.error;
            let logged = false;
            console.error = ( msg ) => {
                if ( msg.includes( 'MQTT error' ) ) {
                    logged = true;
                }
            };

            try {
                emitter = createEmitter( {
                    brokerUrl: 'mqtt://localhost',
                    connectGraceMs: 0,
                    codec: testCodec,
                    debug: true,
                    mqttConnectFn: mockConnect
                } );

                eventHandlers.error( new Error( 'Test error' ) );
                expect( logged ).to.equal( true );
            } finally {
                console.error = originalError;
            }
        } );


} );

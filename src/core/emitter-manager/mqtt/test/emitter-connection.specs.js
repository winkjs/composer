// core/emitter-manager/mqtt/test/emitter-connection.specs.js

/**
 * @fileoverview MQTT emitter — connection state tracking across connect/offline/error events.
 *
 * Split from the former emitter.specs.js monolith (per-concern files,
 * moves not rewrites). Uses sinon stubs to mock
 * mqtt.connect — no broker required.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { createEmitter } from '../emitter.js';
import { makeMockClient, testCodec } from './test-helpers.js';
describe( 'mqtt emitter — connection state', function () {

    let mockClient;
    let mockConnect;
    let emitter;
    let eventHandlers;

    beforeEach( function () {
        const mock = makeMockClient();
        mockClient = mock.client;
        eventHandlers = mock.eventHandlers;
        mockConnect = sinon.stub().returns( mockClient );
        // The edge and attempt lines are pinned in
        // connection-lines.specs.js; here they are only noise.
        sinon.stub( console, 'warn' );
        sinon.stub( console, 'error' );
    } );

    afterEach( async function () {
        if ( emitter ) {
            // Tests that pin pressure high make this shutdown lossy by
            // design — the classified SHUTDOWN_TIMEOUT is expected there
            // and irrelevant to teardown.
            await Promise.resolve( emitter.shutdown() ).catch( () => undefined );
            emitter = null;
        }

        sinon.restore();
    } );

    // ========================================================================
    // CONNECTION STATE
    // ========================================================================

    describe( 'connection state', function () {

        it( 'starts disconnected (grace disabled: handle handed back before any connack)', async function () {
            // The factory never fabricates connectivity. With
            // connectGraceMs 0 the promise resolves without waiting,
            // before any connack could arrive. connect-grace.specs.js
            // pins the same invariant after a full grace expiry.
            emitter = await createEmitter( {
                brokerUrl: 'mqtt://127.0.0.1',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            expect( emitter.getHealth().connected ).to.equal( false );
        } );

        it( 'becomes connected on connect event', async function () {
            emitter = await createEmitter( {
                brokerUrl: 'mqtt://127.0.0.1',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            // Simulate connect event
            eventHandlers.connect();

            expect( emitter.getHealth().connected ).to.equal( true );
        } );

        it( 'becomes disconnected on offline event', async function () {
            emitter = await createEmitter( {
                brokerUrl: 'mqtt://127.0.0.1',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            eventHandlers.connect();
            expect( emitter.getHealth().connected ).to.equal( true );

            eventHandlers.offline();
            expect( emitter.getHealth().connected ).to.equal( false );
        } );

        it( 'tracks errors in stats', async function () {
            emitter = await createEmitter( {
                brokerUrl: 'mqtt://127.0.0.1',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            expect( emitter.getHealth().stats.errors ).to.equal( 0 );

            eventHandlers.error( new Error( 'Connection failed' ) );

            expect( emitter.getHealth().stats.errors ).to.equal( 1 );
        } );

        // The reconnects counter has its own focused spec file —
        // reconnect-stats.specs.js (this file is at the max-lines cap).

    } );

} );

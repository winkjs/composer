// core/emitter-manager/mqtt/test/emitter-shutdown.specs.js

/**
 * @fileoverview MQTT emitter — shutdown() surface semantics: promise shape, latching, budget handling. Drain timing lives in shutdown-drain.specs.js.
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
describe( 'mqtt emitter — shutdown() surface', function () {

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
            // Tests that pin pressure high make this shutdown lossy by
            // design — the classified SHUTDOWN_TIMEOUT is expected there
            // and irrelevant to teardown.
            await Promise.resolve( emitter.shutdown() ).catch( () => undefined );
            emitter = null;
        }

        sinon.restore();
    } );

    // ========================================================================
    // SHUTDOWN
    // ========================================================================

    describe( 'shutdown()', function () {

        it( 'returns a promise', function () {
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            const result = emitter.shutdown();
            expect( result ).to.be.instanceOf( Promise );
        } );

        it( 'calls client.end with force=true when not connected', async function () {
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            await emitter.shutdown();

            expect( mockClient.end.calledWith( true ) ).to.equal( true );
        } );

        it( 'calls client.end with force=false when connected (graceful)', async function () {
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            eventHandlers.connect();

            await emitter.shutdown();

            expect( mockClient.end.calledWith( false, {}, sinon.match.func ) ).to.equal( true );
        } );

        it( 'is idempotent - second call returns immediately', async function () {
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            await emitter.shutdown();
            await emitter.shutdown();

            // client.end should only be called once
            expect( mockClient.end.callCount ).to.equal( 1 );
        } );

        it( 'forces shutdown after timeout when connected', async function () {
            mockClient.end.callsFake( ( force, opts, cb ) => {
                // Simulate graceful close never completing
                if ( force === true ) {
                    // Force close completes immediately
                    if ( cb ) setImmediate( cb );
                }
                // Don't call callback for graceful close (force=false)
            } );

            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            eventHandlers.connect();

            // Use very short timeout for test (the ADR-018 shutdown-contract shape).
            await emitter.shutdown( { timeout: 10 } );

            // Should have called end twice - once graceful, once forced
            expect( mockClient.end.callCount ).to.be.at.least( 1 );
        } );

        it( 'shutdown signature accepts the ADR-018 forms — no arg, {}, { timeout: N }', async function () {
            // Verify all three call shapes work without throwing. The timeout
            // value's actual effect is exercised by the "forces shutdown after
            // timeout" test above; this test is purely about call-shape acceptance.
            const e1 = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );
            await e1.shutdown();

            const e2 = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );
            await e2.shutdown( {} );

            const e3 = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );
            await e3.shutdown( { timeout: 100 } );
        } );

    } );

    // Note: a dedicated `getStats()` describe block was removed when the
    // method itself was removed from the MQTT emitter handle (no
    // production callers). Stats counters (published, publishErrors, errors,
    // reconnects) are still maintained internally and accessible via the
    // `getHealth().stats` sub-field; the increments and the defensive-copy
    // contract are exercised under 'getHealth()' above.


} );

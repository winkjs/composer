// core/emitter-manager/mqtt/test/emitter-health.specs.js

/**
 * @fileoverview MQTT emitter — getHealth(): the ADR-018 health-floor shape and status derivation.
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
describe( 'mqtt emitter — getHealth()', function () {

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
    // HEALTH REPORTING
    // ========================================================================

    describe( 'getHealth()', function () {

        beforeEach( function () {
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );
        } );

        it( 'returns the ADR-018 health floor plus the adapter-specific stats addition', function () {
            const health = emitter.getHealth();

            // Required floor (uniform with Terminal/QuestDB)
            expect( health ).to.have.property( 'status' );
            expect( health ).to.have.property( 'connected' );
            expect( health ).to.have.property( 'pressure' );
            // `stats` is this adapter's addition beyond the floor
            expect( health ).to.have.property( 'stats' );
            // The wal-backed diagnostics died with the disk store (ADR-021);
            // their absence is asserted so they cannot silently resurface.
            expect( health ).to.not.have.property( 'storeHealth' );
            expect( health ).to.not.have.property( 'metrics' );
            expect( health ).to.not.have.property( 'circuitState' );
        } );

        it( 'top-level status is one of the contract-mandated three values', function () {
            const status = emitter.getHealth().status;
            expect( status ).to.be.oneOf( [ 'green', 'yellow', 'red' ] );
        } );

        it( 'is red when not connected (transport down)', function () {
            // Default state after createEmitter and before any connect event.
            const health = emitter.getHealth();
            expect( health.connected ).to.equal( false );
            expect( health.status ).to.equal( 'red' );
        } );

        it( 'reflects connection state via the connected field', function () {
            expect( emitter.getHealth().connected ).to.equal( false );

            eventHandlers.connect();
            expect( emitter.getHealth().connected ).to.equal( true );
        } );

        it( 'returns defensive copy of stats sub-field (mutation does not leak)', function () {
            const health1 = emitter.getHealth();
            health1.stats.published = 999;

            const health2 = emitter.getHealth();
            expect( health2.stats.published ).to.equal( 0 );
        } );

        it( 'is yellow when connected and pressure crosses the yellow threshold (0.66)', function () {
            // Drive pressure into the yellow band with real unacked
            // messages: 7 in flight against a window of 10 is 0.7.
            const manual = makeMockClient( { manualAcks: true } );
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                maxQueueSize: 10,
                mqttConnectFn: () => manual.client
            } );
            manual.eventHandlers.connect();
            for ( let i = 0; i < 7; i += 1 ) {
                emitter.publishNow( 'test/topic', { value: i } );
            }

            const health = emitter.getHealth();
            expect( health.connected ).to.equal( true );
            expect( health.pressure ).to.equal( 0.7 );
            expect( health.status ).to.equal( 'yellow' );

            // Drain the window so afterEach's shutdown resolves clean.
            manual.publishCalls.forEach( ( call ) => call.cb() );
        } );

        it( 'turns yellow at exactly 0.66 — the threshold is inclusive', function () {
            // getHealth uses `pressure >= 0.66`. Pin the boundary from
            // both sides: 32/50 = 0.64 is green, 33/50 = 0.66 is yellow.
            const manual = makeMockClient( { manualAcks: true } );
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                maxQueueSize: 50,
                mqttConnectFn: () => manual.client
            } );
            manual.eventHandlers.connect();
            for ( let i = 0; i < 32; i += 1 ) {
                emitter.publishNow( 'test/topic', { value: i } );
            }
            expect( emitter.getHealth().status ).to.equal( 'green' );

            emitter.publishNow( 'test/topic', { value: 32 } );
            expect( emitter.getHealth().pressure ).to.equal( 0.66 );
            expect( emitter.getHealth().status ).to.equal( 'yellow' );

            // Drain the window so afterEach's shutdown resolves clean.
            manual.publishCalls.forEach( ( call ) => call.cb() );
        } );

        it( 'is green when connected and pressure is low', function () {
            // Nothing in flight — pressure 0, connected: the green case.
            eventHandlers.connect();

            expect( emitter.getHealth().status ).to.equal( 'green' );
        } );

    } );


} );

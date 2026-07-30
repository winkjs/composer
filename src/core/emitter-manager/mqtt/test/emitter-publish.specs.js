// core/emitter-manager/mqtt/test/emitter-publish.specs.js

/**
 * @fileoverview MQTT emitter — publishNow(): sync return contract, message metadata, and the pre-flight pressure refusal.
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
describe( 'mqtt emitter — publishNow()', function () {

    let mockClient;
    let mockConnect;
    let emitter;

    beforeEach( function () {
        const mock = makeMockClient();
        mockClient = mock.client;
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
    // PUBLISH NOW
    // ========================================================================

    describe( 'publishNow()', function () {

        beforeEach( function () {
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );
        } );

        it( 'publishes message to topic and returns { ok: true } per ADR-018', function () {
            const result = emitter.publishNow( 'test/topic', { value: 42 } );

            expect( mockClient.publish.calledOnce ).to.equal( true );
            expect( mockClient.publish.firstCall.args[ 0 ] ).to.equal( 'test/topic' );
            expect( result ).to.deep.equal( { ok: true } );
        } );

        it( 'reuses the same RESULT_OK singleton on every successful call (zero-alloc)', function () {
            const r1 = emitter.publishNow( 'test/topic', { value: 1 } );
            const r2 = emitter.publishNow( 'test/topic', { value: 2 } );

            expect( r1 ).to.equal( r2 );
            expect( r1 ).to.deep.equal( { ok: true } );
        } );

        it( 'still propagates dedupId via MQTT user properties (verified on the wire)', function () {
            emitter.publishNow( 'test/topic', { value: 42 } );

            const opts = mockClient.publish.firstCall.args[ 2 ];
            expect( opts.properties.userProperties.winkDedupId ).to.match( /^[0-9a-f-]{36}$/ );
        } );

        it( 'encodes message using codec', async function () {
            await emitter.publishNow( 'test/topic', { value: 42 } );

            const payload = mockClient.publish.firstCall.args[ 1 ];
            expect( Buffer.isBuffer( payload ) ).to.equal( true );
            expect( JSON.parse( payload.toString() ) ).to.deep.equal( { value: 42 } );
        } );

        it( 'sets QoS 1', async function () {
            await emitter.publishNow( 'test/topic', { value: 42 } );

            const opts = mockClient.publish.firstCall.args[ 2 ];
            expect( opts.qos ).to.equal( 1 );
        } );

        it( 'sets message properties', async function () {
            await emitter.publishNow( 'test/topic', { value: 42 } );

            const opts = mockClient.publish.firstCall.args[ 2 ];
            expect( opts.properties.messageExpiryInterval ).to.be.a( 'number' );
            expect( opts.properties.contentType ).to.equal( 'application/json' );
            expect( opts.properties.userProperties ).to.have.property( 'winkDedupId' );
            expect( opts.properties.userProperties ).to.have.property( 'winkTimestamp' );
            expect( opts.properties.userProperties ).to.have.property( 'winkVersion' );
        } );

        it( 'sets payloadFormatIndicator when codec specifies it', async function () {
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: {
                    ...testCodec,
                    payloadFormatIndicator: 1
                },
                mqttConnectFn: mockConnect
            } );

            await emitter.publishNow( 'test/topic', { value: 42 } );

            const opts = mockClient.publish.firstCall.args[ 2 ];
            expect( opts.properties.payloadFormatIndicator ).to.equal( true );
        } );

        it( 'increments published stat on success', async function () {
            expect( emitter.getHealth().stats.published ).to.equal( 0 );

            await emitter.publishNow( 'test/topic', { value: 42 } );

            // Wait for callback
            await new Promise( ( resolve ) => setImmediate( resolve ) );

            expect( emitter.getHealth().stats.published ).to.equal( 1 );
        } );

        it( 'increments publishErrors stat on publish error', async function () {
            // Re-create with onDeliveryFailure to absorb the failure (per
            // the adapter contract: without a handler the adapter surfaces it
            // via Promise.reject; the test would crash the worker otherwise).
            mockClient.publish.callsFake( ( topic, payload, opts, cb ) => {
                setImmediate( () => cb( new Error( 'Publish error' ) ) );
            } );

            const failures = [];
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                onDeliveryFailure: ( err, ctx ) => failures.push( { err, ctx } ),
                mqttConnectFn: mockConnect
            } );

            await emitter.publishNow( 'test/topic', { value: 42 } );
            await new Promise( ( resolve ) => setImmediate( resolve ) );

            expect( emitter.getHealth().stats.publishErrors ).to.equal( 1 );
            expect( failures.length ).to.equal( 1 );
        } );

        it( 'returns SHUTTING_DOWN error when called during shutdown', async function () {
            await emitter.shutdown();

            const result = emitter.publishNow( 'test/topic', { value: 42 } );

            expect( result.ok ).to.equal( false );
            expect( result.error.code ).to.equal( 'SHUTTING_DOWN' );
            expect( result.error.message ).to.be.a( 'string' );
            // Drop the message — no publish call after shutdown
            expect( mockClient.publish.called ).to.equal( false );
        } );

        it( 'reuses the same SHUTTING_DOWN singleton across calls', async function () {
            await emitter.shutdown();

            const r1 = emitter.publishNow( 'test/topic', { value: 1 } );
            const r2 = emitter.publishNow( 'test/topic', { value: 2 } );

            expect( r1 ).to.equal( r2 );
        } );

    } );

    // ========================================================================
    // PRE-FLIGHT PRESSURE REFUSAL
    // ========================================================================

    describe( 'pre-flight pressure refusal', function () {

        // The refusal boundary itself (reject at pressure 0.9, accept
        // below, acks freeing capacity) is exercised counter-by-counter
        // in unacked-accounting.specs.js.

        it( 'accepts publish when pressure is below STORAGE_PRESSURE_LIMIT', function () {
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            // getPressure is part of the contract — sanity check
            expect( emitter.getPressure() ).to.be.a( 'number' );

            // Publishing should succeed when pressure is low (nothing in flight)
            const result = emitter.publishNow( 'test/topic', { value: 1 } );
            expect( result ).to.deep.equal( { ok: true } );
            expect( mockClient.publish.calledOnce ).to.equal( true );
        } );

        it( 'reuses the same STORAGE_FULL singleton across rejects', function () {
            const manual = makeMockClient( { manualAcks: true } );
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                maxQueueSize: 10,
                mqttConnectFn: () => manual.client
            } );

            // Fill the unacked window to the refusal boundary (9 of 10 = 0.9).
            for ( let i = 0; i < 9; i += 1 ) {
                emitter.publishNow( 'test/topic', { value: i } );
            }

            const r1 = emitter.publishNow( 'test/topic', { value: 9 } );
            const r2 = emitter.publishNow( 'test/topic', { value: 10 } );

            expect( r1.error.code ).to.equal( 'STORAGE_FULL' );
            expect( r1 ).to.equal( r2 );

            // Drain the window so afterEach's shutdown resolves clean.
            manual.publishCalls.forEach( ( call ) => call.cb() );
        } );

    } );


} );

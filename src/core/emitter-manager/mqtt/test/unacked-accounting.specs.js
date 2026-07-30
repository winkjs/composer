// core/emitter-manager/mqtt/test/unacked-accounting.specs.js

/**
 * @fileoverview MQTT emitter — composer-side unacked accounting (ADR-021).
 *
 * The emitter runs mqtt.js's default synchronous in-memory store and
 * keeps its own count of unacknowledged messages: increment when a
 * publish is accepted, decrement when the publish callback fires (ack
 * or failure). That one counter drives pressure, the pre-flight
 * STORAGE_FULL refusal, health, and the shutdown drain report.
 *
 * Why the counter must be composer-side (the 2026-07-08 diagnosis, in
 * one sentence each):
 * - mqtt.js loses QoS-1 messages on every connection acceptance when
 *   its outgoing store is asynchronous — so the LevelDB store is
 *   detached and durability class drops to 'in-memory' (ADR-021).
 * - The old pressure gauge read the LevelDB store while messages could
 *   pile up invisibly inside the client's internal queues (the tier-run
 *   OOM); "unacknowledged" by definition covers every client-internal
 *   queue, so accumulation can never again be invisible to pressure.
 *
 * These specs drive the emitter through the mock client with
 * `manualAcks` so messages stay "in flight" until the test decides
 * their fate. Written RED-FIRST against the wal-backed emitter: there,
 * the mock never touches the LevelDB store, so pressure stays 0, no
 * refusal ever fires, and shutdown resolves clean — every assertion
 * below fails for exactly that reason.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createEmitter } from '../emitter.js';
import { durabilityClass } from '../index.js';
import { makeMockClient, fireConnect, waitForCallbacks, testCodec } from './test-helpers.js';

describe( 'mqtt emitter — unacked accounting (ADR-021)', function () {

    let mock;
    let emitter;
    let capturedOpts;

    const makeEmitter = function ( overrides = {} ) {
        return createEmitter( {
            brokerUrl: 'mqtt://localhost',
            connectGraceMs: 0,
            codec: testCodec,
            maxQueueSize: 10,
            mqttConnectFn: ( url, opts ) => {
                capturedOpts = opts;
                return mock.client;
            },
            ...overrides
        } );
    };

    const ackOne = function ( index ) {
        mock.publishCalls[ index ].cb();
    };

    beforeEach( function () {
        mock = makeMockClient( { manualAcks: true } );
        capturedOpts = null;
    } );

    afterEach( async function () {
        if ( emitter ) {
            await emitter.shutdown( { timeout: 50 } ).catch( () => null );
            emitter = null;
        }
        sinon.restore();
    } );

    describe( 'module surface', function () {

        it( 'declares the in-memory durability class', function () {
            expect( durabilityClass ).to.equal( 'in-memory' );
        } );

    } );

    describe( 'client construction', function () {

        it( 'hands mqtt.js NO outgoingStore — the default synchronous memory store', function () {
            emitter = makeEmitter();
            expect( capturedOpts.outgoingStore ).to.equal( undefined );
        } );

        it( 'clamps maxQueueSize to the 16-bit packet-id ceiling, loudly', function () {
            // Every unacknowledged QoS-1 message holds a packet id, so one
            // connection can never carry more than the id space allows; a
            // request beyond the 60,000 ceiling is clamped with a warning
            // (same behavior the LevelDB store had, kept in the emitter).
            const warnStub = sinon.stub( console, 'warn' );
            try {
                emitter = makeEmitter( { maxQueueSize: 70000 } );
                fireConnect( mock.eventHandlers );
                emitter.publishNow( 'jig/t', { i: 0 } );

                expect( warnStub.calledOnce ).to.equal( true );
                expect( warnStub.firstCall.args[ 0 ] ).to.contain( '70000' );
                expect( warnStub.firstCall.args[ 0 ] ).to.contain( '60000' );
                // The clamped cap, not the requested one, is the pressure
                // denominator: 1 in flight over 60,000.
                expect( emitter.getPressure() ).to.be.closeTo( 1 / 60000, 1e-12 );
            } finally {
                warnStub.restore();
            }
            ackOne( 0 );
        } );

    } );

    describe( 'pressure from the counter', function () {

        it( 'starts at zero pressure', function () {
            emitter = makeEmitter();
            expect( emitter.getPressure() ).to.equal( 0 );
        } );

        it( 'rises with unacknowledged publishes', function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            for ( let i = 0; i < 4; i += 1 ) {
                emitter.publishNow( 'jig/t', { i } );
            }
            expect( emitter.getPressure() ).to.equal( 0.4 );
        } );

        it( 'falls as acknowledgments arrive', function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            for ( let i = 0; i < 4; i += 1 ) {
                emitter.publishNow( 'jig/t', { i } );
            }
            ackOne( 0 );
            ackOne( 1 );
            ackOne( 2 );
            expect( emitter.getPressure() ).to.be.closeTo( 0.1, 1e-12 );
        } );

        it( 'caps reported pressure at 1 even with a degenerate sub-1 cap', function () {
            // The DSL schema validates maxQueueSize as a positive integer,
            // but a direct createEmitter caller bypasses it. The gauge
            // still honours the ADR-018 contract: pressure ∈ [0, 1].
            emitter = makeEmitter( { maxQueueSize: 0.5 } );
            fireConnect( mock.eventHandlers );
            emitter.publishNow( 'jig/t', { i: 0 } );
            expect( emitter.getPressure() ).to.equal( 1 );
            ackOne( 0 );
        } );

        it( 'a failed publish frees its slot exactly once', function () {
            emitter = makeEmitter( { onDeliveryFailure: () => null } );
            fireConnect( mock.eventHandlers );
            emitter.publishNow( 'jig/t', { i: 0 } );
            emitter.publishNow( 'jig/t', { i: 1 } );
            mock.publishCalls[ 0 ].cb( new Error( 'boom' ) );
            expect( emitter.getPressure() ).to.be.closeTo( 0.1, 1e-12 );
        } );

    } );

    describe( 'pre-flight refusal at the cap', function () {

        it( 'refuses with STORAGE_FULL once unacked reaches 90% of maxQueueSize', function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            for ( let i = 0; i < 9; i += 1 ) {
                expect( emitter.publishNow( 'jig/t', { i } ).ok ).to.equal( true );
            }
            const refused = emitter.publishNow( 'jig/t', { i: 9 } );
            expect( refused.ok ).to.equal( false );
            expect( refused.error.code ).to.equal( 'STORAGE_FULL' );
        } );

        it( 'acknowledgments free capacity for new accepts', function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            for ( let i = 0; i < 9; i += 1 ) {
                emitter.publishNow( 'jig/t', { i } );
            }
            expect( emitter.publishNow( 'jig/t', { i: 9 } ).ok ).to.equal( false );
            ackOne( 0 );
            expect( emitter.publishNow( 'jig/t', { i: 10 } ).ok ).to.equal( true );
        } );

        it( 'a refused message is not counted as in flight', function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            for ( let i = 0; i < 9; i += 1 ) {
                emitter.publishNow( 'jig/t', { i } );
            }
            emitter.publishNow( 'jig/t', { i: 9 } );
            emitter.publishNow( 'jig/t', { i: 10 } );
            expect( emitter.getHealth().stats.unacked ).to.equal( 9 );
        } );

    } );

    describe( 'health exposure', function () {

        it( 'getHealth().stats.unacked reports the live count', function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            emitter.publishNow( 'jig/t', { i: 0 } );
            emitter.publishNow( 'jig/t', { i: 1 } );
            emitter.publishNow( 'jig/t', { i: 2 } );
            ackOne( 0 );
            expect( emitter.getHealth().stats.unacked ).to.equal( 2 );
        } );

    } );

    describe( 'counter integrity under synchronous throws', function () {

        // The counter's rule is one increment per accepted message, one
        // decrement when its callback fires. A synchronous throw between
        // the two — the codec failing to encode, or the client rejecting
        // the publish call itself — must not leave a phantom increment:
        // a leaked slot never drains, so pressure ratchets up until the
        // emitter refuses everything and shutdown reports messages that
        // never existed. (The unguarded behavior was reproduced in a
        // standalone script before the guard landed.)

        const circular = {};
        circular.self = circular;

        it( 'refuses a message the codec cannot encode — classified, no throw, counter untouched', function () {
            const onDeliveryFailure = sinon.stub();
            emitter = makeEmitter( { onDeliveryFailure } );
            fireConnect( mock.eventHandlers );

            const result = emitter.publishNow( 'jig/t', circular );

            expect( result.ok ).to.equal( false );
            expect( result.error.code ).to.equal( 'ENCODE_ERROR' );
            // The message names the topic so an operator can find the
            // producing flow without a stack trace.
            expect( result.error.message ).to.contain( 'jig/t' );
            expect( emitter.getPressure() ).to.equal( 0 );
            expect( emitter.getHealth().stats.unacked ).to.equal( 0 );
            expect( emitter.getHealth().stats.encodeErrors ).to.equal( 1 );
            // The sync refusal IS the caller's signal; the async failure
            // handler stays quiet — nothing was ever in flight.
            expect( onDeliveryFailure.called ).to.equal( false );
        } );

        it( 'accepts a good message immediately after an encode failure', function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );

            emitter.publishNow( 'jig/t', circular );
            const good = emitter.publishNow( 'jig/t', { i: 0 } );

            expect( good.ok ).to.equal( true );
            // Only the good message reached the client.
            expect( mock.publishCalls.length ).to.equal( 1 );
            ackOne( 0 );
        } );

        it( 'shuts down clean after encode failures — nothing was ever in flight', async function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );

            emitter.publishNow( 'jig/t', circular );
            emitter.publishNow( 'jig/t', circular );

            await emitter.shutdown( { timeout: 500 } );
            emitter = null;
        } );

        it( 'restores the counter when client.publish itself throws synchronously', function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            mock.client.publish = sinon.stub().throws( new TypeError( 'invalid topic' ) );

            const result = emitter.publishNow( 'jig/t', { i: 0 } );

            expect( result.ok ).to.equal( false );
            expect( result.error.code ).to.equal( 'DELIVERY_FAILED' );
            expect( emitter.getPressure() ).to.equal( 0 );
            expect( emitter.getHealth().stats.unacked ).to.equal( 0 );
            expect( emitter.getHealth().stats.publishErrors ).to.equal( 1 );
        } );

    } );

    describe( 'shutdown drain from the counter', function () {

        it( 'rejects SHUTDOWN_TIMEOUT with the exact unacked count when messages are stuck', async function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            emitter.publishNow( 'jig/t', { i: 0 } );
            emitter.publishNow( 'jig/t', { i: 1 } );
            emitter.publishNow( 'jig/t', { i: 2 } );
            let caught = null;
            try {
                await emitter.shutdown( { timeout: 150 } );
            } catch ( err ) {
                caught = err;
            }
            emitter = null;     // afterEach must not re-run shutdown
            expect( caught, 'shutdown with unacked messages must reject' ).to.not.equal( null );
            expect( caught.code ).to.equal( 'SHUTDOWN_TIMEOUT' );
            expect( caught.dropped.count ).to.equal( 3 );
        } );

        it( 'reports the loss even when disconnected — nothing persists across sessions now', async function () {
            // The wal-backed design resolved a DISCONNECTED shutdown
            // clean on purpose: the disk store held the messages for the
            // next session. With no disk store, unacknowledged messages
            // die with the process — shutdown must say so.
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            emitter.publishNow( 'jig/t', { i: 0 } );
            emitter.publishNow( 'jig/t', { i: 1 } );
            mock.eventHandlers.offline();
            let caught = null;
            try {
                await emitter.shutdown( { timeout: 150 } );
            } catch ( err ) {
                caught = err;
            }
            emitter = null;
            expect( caught, 'disconnected shutdown with unacked messages must reject' ).to.not.equal( null );
            expect( caught.code ).to.equal( 'SHUTDOWN_TIMEOUT' );
            expect( caught.dropped.count ).to.equal( 2 );
        } );

        it( 'resolves clean when everything was acknowledged', async function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            emitter.publishNow( 'jig/t', { i: 0 } );
            emitter.publishNow( 'jig/t', { i: 1 } );
            ackOne( 0 );
            ackOne( 1 );
            await waitForCallbacks();
            await emitter.shutdown( { timeout: 500 } );
            emitter = null;
        } );

    } );

} );

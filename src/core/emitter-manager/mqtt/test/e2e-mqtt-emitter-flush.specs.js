// core/emitter-manager/mqtt/test/e2e-mqtt-emitter-flush.specs.js

/**
 * @fileoverview Flush + shutdown + codec round-trip
 * tests for the MQTT emitter, fast tier.
 *
 * Three things this file covers that the unit tests in `emitter.specs.js`
 * and `mqtt-store.specs.js` don't:
 *
 *   1. **Multi-message shutdown drain.** Many publishes followed by
 *      `shutdown({ timeout })` returning within the configured budget,
 *      with every publish's mqtt.js callback observed before close.
 *
 *   2. **Shutdown timeout enforcement under broker-down.** When the
 *      mocked broker never ACKs the DISCONNECT (the simulated hang),
 *      `shutdown({ timeout: N })` must return within ~N + small grace
 *      via the `client.end(true)` force path. This pins the contract
 *      that the ADR-018 shutdown budget is actually enforced.
 *
 *   3. **Codec round-trip without a real broker.** Capture the bytes
 *      handed to `client.publish`, decode them with the same codec's
 *      `unpack()`, assert the result equals the original message. Both
 *      `jsonCodec` and `msgpackCodec` are exercised, plus their MQTT v5
 *      `contentType` and `payloadFormatIndicator` propagation.
 *
 * No real Mosquitto is required for any test in this file — the codec
 * round-trip is a pack/unpack symmetry contract on representative
 * messages, not a transport-level test (`slow-mqtt-emitter-recovery.specs.js`
 * covers transport via the in-test TCP proxy + real Mosquitto).
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';

import { createEmitter } from '../emitter.js';
import { jsonCodec, msgpackCodec } from '../../../codec/index.js';
import { makeMockClient, fireConnect, waitForCallbacks } from './test-helpers.js';

// ============================================================================
// SHUTDOWN DRAIN + TIMEOUT
// ============================================================================

describe( 'MQTT emitter E2E — flush, shutdown, codec round-trip', function () {

    let createdEmitters;

    beforeEach( function () {
        createdEmitters = [];
    } );

    afterEach( async function () {
        // Shut down everything created in this test in parallel —
        // ordering doesn't matter, and parallel keeps cleanup tight.
        await Promise.all( createdEmitters.map( ( e ) =>
            e.shutdown( { timeout: 100 } ).catch( () => undefined )
        ) );
    } );

    describe( 'shutdown drain (broker reachable)', function () {

        it( 'returns within timeout after all publish callbacks fire', async function () {
            const { client, eventHandlers, publishCalls } = makeMockClient();
            const emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: jsonCodec,
                mqttConnectFn: () => client
            } );
            createdEmitters.push( emitter );
            fireConnect( eventHandlers );

            for ( let i = 0; i < 5; i += 1 ) {
                emitter.publishNow( 'test/drain', { i } );
            }
            await waitForCallbacks();

            const start = Date.now();
            await emitter.shutdown( { timeout: 5000 } );
            const elapsed = Date.now() - start;

            expect( publishCalls.length ).to.equal( 5 );
            expect( elapsed ).to.be.below( 1000 );
            expect( emitter.getHealth().stats.published ).to.equal( 5 );
        } );

        it( 'second shutdown is a no-op (idempotent)', async function () {
            const { client, eventHandlers } = makeMockClient();
            const emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: jsonCodec,
                mqttConnectFn: () => client
            } );
            fireConnect( eventHandlers );

            await emitter.shutdown( { timeout: 5000 } );
            const start = Date.now();
            await emitter.shutdown( { timeout: 5000 } );
            const elapsed = Date.now() - start;

            // The latched second call returns without re-running a drain —
            // far under the 5000 ms budget. 500 ms keeps the assertion's
            // meaning without being the tightest timing window in the
            // suite (m9).
            expect( elapsed ).to.be.below( 500 );
        } );

    } );

    describe( 'shutdown timeout enforcement (broker hangs DISCONNECT)', function () {

        it( 'returns within timeout via force-end when broker never ACKs', async function () {
            const { client, eventHandlers, endCalls } = makeMockClient( { hangOnEnd: true } );
            const emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: jsonCodec,
                mqttConnectFn: () => client
            } );
            createdEmitters.push( emitter );
            fireConnect( eventHandlers );

            const start = Date.now();
            await emitter.shutdown( { timeout: 200 } );
            const elapsed = Date.now() - start;

            // Allow ~150ms grace for store close + scheduling jitter on
            // CI hardware. The contract is "returns within timeout + grace,"
            // not "returns at exactly timeout."
            expect( elapsed ).to.be.at.least( 200 );
            expect( elapsed ).to.be.below( 700 );

            // First end() call: graceful (force=false, with cb). Hangs.
            // Second end() call: force=true (no cb), fires from the timer.
            const forceEndCalls = endCalls.filter( ( c ) => c.force === true );
            expect( forceEndCalls.length ).to.be.at.least( 1 );
        } );

        it( 'force-closes when drain budget exhausts (unacked stuck above 0)', async function () {
            // Closes the closeBudget=1 branch in shutdown's deadline
            // calculation: when the drain budget elapses before the
            // unacked counter hits 0, force-close fires almost
            // immediately on the remaining budget.
            const { client, eventHandlers, endCalls, publishCalls } =
                makeMockClient( { hangOnEnd: true, manualAcks: true } );
            const emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: jsonCodec,
                mqttConnectFn: () => client
            } );
            createdEmitters.push( emitter );
            fireConnect( eventHandlers );

            // Three publishes whose acknowledgments never arrive — the
            // drain will exhaust the budget with unacked pinned at 3.
            for ( let i = 0; i < 3; i += 1 ) {
                emitter.publishNow( 'test/stuck', { i } );
            }

            const start = Date.now();
            let thrown = null;
            await emitter.shutdown( { timeout: 100 } ).catch( ( err ) => {
                thrown = err;
            } );
            const elapsed = Date.now() - start;

            // The drain uses the whole 100 ms budget (no early
            // give-up), then the closeBudget force-close fires.
            // Cap is 700 ms to allow for jitter; floor is 100 ms (timeout).
            expect( elapsed ).to.be.at.least( 100 );
            expect( elapsed ).to.be.below( 700 );

            const forceEnds = endCalls.filter( ( c ) => c.force === true );
            expect( forceEnds.length ).to.be.at.least( 1 );

            // The lossy close reports itself (ADR-018): teardown
            // happened (asserted above), then the classified rejection
            // with the counter's exact undelivered count.
            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'SHUTDOWN_TIMEOUT' );
            expect( thrown.dropped ).to.deep.equal( { count: 3 } );

            // Settle the stranded callbacks so nothing dangles.
            publishCalls.forEach( ( call ) => call.cb() );
        } );

        it( 'goes straight to force-close when never connected (offline path)', async function () {
            const { client, endCalls } = makeMockClient();
            const emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: jsonCodec,
                mqttConnectFn: () => client
                // never call fireConnect → state.connected stays false
            } );
            createdEmitters.push( emitter );

            const start = Date.now();
            await emitter.shutdown( { timeout: 5000 } );
            const elapsed = Date.now() - start;

            expect( elapsed ).to.be.below( 200 );
            // Force close used immediately, no graceful end attempt.
            expect( endCalls.length ).to.equal( 1 );
            expect( endCalls[ 0 ].force ).to.equal( true );
        } );

    } );

    // ========================================================================
    // CODEC ROUND-TRIP
    // ========================================================================

    describe( 'codec round-trip', function () {

        const sampleMessages = [
            { _harnessId: 1, ts: 1700000000000, value: 23.5, ok: true },
            { _harnessId: 2, ts: 1700000060000, value: -0.001, ok: false, label: 'edge' },
            { _harnessId: 3, ts: 1700000120000, value: 1e6, nested: { a: [ 1, 2, 3 ], b: 'mixed' } }
        ];

        const runRoundTrip = async function ( codec ) {
            const { client, eventHandlers, publishCalls } = makeMockClient();
            const emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec,
                mqttConnectFn: () => client
            } );
            createdEmitters.push( emitter );
            fireConnect( eventHandlers );

            for ( const msg of sampleMessages ) {
                emitter.publishNow( 'test/round-trip', msg );
            }
            await waitForCallbacks();

            expect( publishCalls.length ).to.equal( sampleMessages.length );
            return publishCalls;
        };

        it( 'jsonCodec packs and unpacks every message symmetrically', async function () {
            const captured = await runRoundTrip( jsonCodec );

            for ( let i = 0; i < sampleMessages.length; i += 1 ) {
                const decoded = jsonCodec.unpack( captured[ i ].payload );
                expect( decoded ).to.deep.equal( sampleMessages[ i ] );
            }
        } );

        it( 'msgpackCodec packs and unpacks every message symmetrically', async function () {
            const captured = await runRoundTrip( msgpackCodec );

            for ( let i = 0; i < sampleMessages.length; i += 1 ) {
                const decoded = msgpackCodec.unpack( captured[ i ].payload );
                expect( decoded ).to.deep.equal( sampleMessages[ i ] );
            }
        } );

        it( 'propagates codec.contentType into publish properties (jsonCodec)', async function () {
            const captured = await runRoundTrip( jsonCodec );
            for ( const call of captured ) {
                expect( call.opts.properties.contentType ).to.equal( 'application/json' );
            }
        } );

        it( 'propagates codec.contentType into publish properties (msgpackCodec)', async function () {
            const captured = await runRoundTrip( msgpackCodec );
            for ( const call of captured ) {
                expect( call.opts.properties.contentType ).to.equal( 'application/msgpack' );
            }
        } );

        it( 'sets payloadFormatIndicator=1 only for text codecs (jsonCodec)', async function () {
            const captured = await runRoundTrip( jsonCodec );
            for ( const call of captured ) {
                expect( call.opts.properties.payloadFormatIndicator ).to.equal( true );
            }
        } );

        it( 'omits payloadFormatIndicator for binary codecs (msgpackCodec)', async function () {
            const captured = await runRoundTrip( msgpackCodec );
            for ( const call of captured ) {
                expect( call.opts.properties.payloadFormatIndicator ).to.equal( undefined );
            }
        } );

    } );

} );

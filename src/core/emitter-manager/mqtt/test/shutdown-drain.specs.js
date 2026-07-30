// core/emitter-manager/mqtt/test/shutdown-drain.specs.js

/**
 * @fileoverview MQTT emitter shutdown drain semantics.
 *
 * The drain is a wait on the emitter's own unacked counter (ADR-021):
 * shutdown stops accepting new work, polls the counter until it reaches
 * zero or the `{ timeout }` budget expires, closes the client, and
 * reports any remaining count as a classified SHUTDOWN_TIMEOUT loss.
 * mqtt.js's own `end()` does not reliably drain in-flight publishes, so
 * the emitter never trusts it (a sustained-load finding, kept through
 * the ADR-021 rework).
 *
 * Pinned here (each proven red against the pre-fix emitter):
 * - The shutdown outcome is latched; a second caller receives the
 *   first call's outcome, never an instant clean resolve.
 * - The drain uses the full deadline; the old no-progress heuristic
 *   gave up after ~125 ms and force-closed.
 * - Pathological timeout values (Infinity, NaN) clamp to the
 *   default instead of collapsing the drain to ~1 ms.
 * - The loss report carries the exact unacked count
 *   (`dropped: { count }`), not a monitoring-grade pressure ratio.
 * - The id allocator stays UniqueMessageIdProvider: the client's default
 *   provider cycles the 16-bit id space with no in-use check, so an id
 *   whose PUBACK never arrived gets reassigned and the unacked packet's
 *   store entry is overwritten (~1 lost per 700k at 14 k msg/s, measured
 *   by the instrumented soak, 2026-07-07).
 *
 * What ADR-021 removed and inverted here:
 * - The wal-backed shutdown re-drive (re-sending disk-store stragglers
 *   through the publish path) died with the disk store. There is no
 *   store to scan, and the client itself re-sends unacknowledged QoS-1
 *   packets on reconnect. Its specs were deleted, not ported.
 * - The disconnected-shutdown pin INVERTED: pending messages at a
 *   disconnected close used to resolve clean because the disk store held
 *   them for the next session. Nothing survives the process now, so that
 *   same close reports the loss.
 *
 * Tests drive the shared manual-ack mock client: an acknowledgment
 * happens only when the test fires a captured publish callback, so a
 * "stranded" message is simply one whose callback is never fired.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';

import { createEmitter } from '../emitter.js';
import { makeMockClient, fireConnect, testCodec } from './test-helpers.js';

const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );

describe( 'mqtt emitter shutdown drain', function () {

    let mock;
    let emitter;
    let capturedOptions;
    let ackedUpTo;

    const makeEmitter = function ( config = {} ) {
        return createEmitter( {
            brokerUrl: 'mqtt://localhost',
            connectGraceMs: 0,
            codec: testCodec,
            mqttConnectFn: ( url, opts ) => {
                capturedOptions = opts;
                return mock.client;
            },
            ...config
        } );
    }; // makeEmitter()

    // Fires every held acknowledgment exactly once — lets a test settle
    // a deliberately hung drain (and lets afterEach settle whatever a
    // test left stranded) without double-firing callbacks the test
    // already acknowledged.
    const ackStranded = function () {
        const calls = mock.publishCalls;
        while ( ackedUpTo < calls.length ) {
            calls[ ackedUpTo ].cb();
            ackedUpTo += 1;
        }
    }; // ackStranded()

    beforeEach( function () {
        mock = makeMockClient( { manualAcks: true } );
        capturedOptions = null;
        ackedUpTo = 0;
    } );

    afterEach( async function () {
        if ( emitter ) {
            ackStranded();
            // The shutdown outcome is latched: this returns the
            // first call's promise; the catch absorbs a recorded lossy
            // outcome during teardown.
            await Promise.resolve( emitter.shutdown() ).catch( () => undefined );
            emitter = null;
        }
    } );

    describe( 'the shutdown outcome is latched', function () {

        it( 'a second call after a lossy shutdown reports the same failure, not clean', async function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            expect( emitter.publishNow( 'wink/test', { v: 1 } ).ok ).to.equal( true );

            let first = null;
            await emitter.shutdown( { timeout: 300 } ).catch( ( err ) => {
                first = err;
            } );
            expect( first, 'the lossy shutdown must reject' ).to.be.an( 'error' );
            expect( first.code ).to.equal( 'SHUTDOWN_TIMEOUT' );

            let second = null;
            await Promise.resolve( emitter.shutdown() ).catch( ( err ) => {
                second = err;
            } );
            expect( second, 'the second call must not contradict the first' ).to.be.an( 'error' );
            expect( second.code ).to.equal( 'SHUTDOWN_TIMEOUT' );
            expect( second.dropped ).to.deep.equal( first.dropped );
        } );

        it( 'a caller arriving mid-drain receives the first call\'s outcome', async function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            expect( emitter.publishNow( 'wink/test', { v: 1 } ).ok ).to.equal( true );

            const p1 = emitter.shutdown( { timeout: 300 } );
            const p2 = emitter.shutdown( { timeout: 300 } );

            const [ r1, r2 ] = await Promise.allSettled( [ p1, p2 ] );
            expect( r1.status ).to.equal( 'rejected' );
            expect( r2.status, 'the mid-drain caller must share the outcome' ).to.equal( 'rejected' );
            expect( r2.reason ).to.equal( r1.reason );
        } );

    } );

    describe( 'the drain uses the whole deadline', function () {

        it( 'does not give up while budget remains, even with no progress', async function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            expect( emitter.publishNow( 'wink/test', { v: 1 } ).ok ).to.equal( true );

            const outcome = emitter.shutdown( { timeout: 600 } );
            outcome.catch( () => undefined );

            // Pre-fix the no-progress heuristic force-closed after ~125 ms.
            await sleep( 300 );
            let settled = false;
            await Promise.race( [
                outcome.then( () => {
                    settled = true;
                }, () => {
                    settled = true;
                } ),
                sleep( 1 )
            ] );
            expect( settled, 'shutdown must still be draining at 300 ms of a 600 ms budget' ).to.equal( false );

            let thrown = null;
            await outcome.catch( ( err ) => {
                thrown = err;
            } );
            expect( thrown.code ).to.equal( 'SHUTDOWN_TIMEOUT' );
        } );

    } );

    describe( 'pathological timeout values clamp to the default', function () {

        const assertClamped = async function ( timeout ) {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            expect( emitter.publishNow( 'wink/test', { v: 1 } ).ok ).to.equal( true );

            const outcome = emitter.shutdown( { timeout } );
            outcome.catch( () => undefined );

            // Pre-fix: Infinity overflowed setTimeout (force-close at
            // ~1 ms) and NaN skipped the drain loop entirely — both
            // settled within ~150 ms. Clamped to the 5000 ms default,
            // the drain is still working at 300 ms.
            await sleep( 300 );
            let settled = false;
            await Promise.race( [
                outcome.then( () => {
                    settled = true;
                }, () => {
                    settled = true;
                } ),
                sleep( 1 )
            ] );
            expect( settled, `timeout=${timeout} must clamp to the default budget` ).to.equal( false );

            // Deliver the stranded acknowledgment so the drain completes clean.
            ackStranded();
            await outcome;
        }; // assertClamped()

        it( 'clamps timeout: Infinity', async function () {
            await assertClamped( Infinity );
        } );

        it( 'clamps timeout: NaN', async function () {
            await assertClamped( NaN );
        } );

    } );

    describe( 'the loss report carries the exact count', function () {

        it( 'rejects with dropped: { count } from the unacked counter', async function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            expect( emitter.publishNow( 'wink/a', { v: 1 } ).ok ).to.equal( true );
            expect( emitter.publishNow( 'wink/b', { v: 2 } ).ok ).to.equal( true );

            let thrown = null;
            await emitter.shutdown( { timeout: 300 } ).catch( ( err ) => {
                thrown = err;
            } );

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'SHUTDOWN_TIMEOUT' );
            expect( thrown.dropped, 'exact count, not a pressure ratio' ).to.deep.equal( { count: 2 } );
            expect( thrown.message ).to.include( '2 message(s)' );
        } );

    } );

    describe( 'the id allocator — unique ids so unacked packets survive', function () {

        it( 'hands the client a unique-id provider (never reissues an in-use id)', function () {
            emitter = makeEmitter();

            // The default provider cycles the 16-bit id space with no
            // in-use check — a publish whose acknowledgment never came
            // has its memory-store entry overwritten on the next lap
            // (the measured 1-per-700k soak leak). The unique provider
            // keeps every unacked packet's entry intact until its PUBACK
            // or the client's own reconnect re-send.
            const provider = capturedOptions.messageIdProvider;
            expect( provider, 'messageIdProvider must be configured' ).to.be.an( 'object' );
            expect( typeof provider.allocate ).to.equal( 'function' );
            expect( typeof provider.register ).to.equal( 'function' );
            expect( typeof provider.deallocate ).to.equal( 'function' );
        } );

    } );

    describe( 'pins — behavior that must not move', function () {

        it( 'a disconnected shutdown with unacknowledged messages reports the loss (inverted by ADR-021)', async function () {
            // The wal-backed design resolved this clean on purpose: the
            // disk store held pending messages for the next session.
            // Nothing survives the process now, so the same close is a
            // real loss and must say so.
            emitter = makeEmitter();
            // Never fires 'connect' — the emitter is offline throughout.
            expect( emitter.publishNow( 'wink/test', { v: 1 } ).ok ).to.equal( true );

            let thrown = null;
            await emitter.shutdown( { timeout: 300 } ).catch( ( err ) => {
                thrown = err;
            } );

            expect( thrown, 'a disconnected close with pending messages is a real loss' ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'SHUTDOWN_TIMEOUT' );
            expect( thrown.dropped ).to.deep.equal( { count: 1 } );
        } );

        it( 'a connected shutdown with everything acknowledged resolves clean, no extra sends', async function () {
            emitter = makeEmitter();
            fireConnect( mock.eventHandlers );
            expect( emitter.publishNow( 'wink/test', { v: 1 } ).ok ).to.equal( true );
            ackStranded();
            expect( emitter.getPressure() ).to.equal( 0 );

            await emitter.shutdown( { timeout: 1000 } );

            expect( mock.publishCalls.length, 'no re-send machinery — one publish per message' ).to.equal( 1 );
        } );

    } );

} );

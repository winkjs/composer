// core/storage-manager/questdb/test/flush-accounting.specs.js

/**
 * @fileoverview Flush accounting under copy-out semantics.
 *
 * The client's flush() copies completed rows OUT of its buffer
 * synchronously, then sends the copy. So the moment a flush is called,
 * its rows are no longer "in the buffer". They are in flight, and a
 * second flush cannot resend them. The adapter tracks the two
 * quantities separately. Without that, shutdown lies:
 *
 * - A hung timer flush holds rows in flight. Shutdown's own flush
 *   would find an empty buffer, resolve fast, and report CLEAN while
 *   the rows are undelivered.
 * - A recovery flush's rows would be counted nowhere. Shutdown would
 *   skip its final flush and report clean over an undelivered copy.
 * - After a lossy shutdown throw, a second shutdown() call would see
 *   an empty buffer and report clean, contradicting the first call.
 * - Rows the persist plan SKIPPED (no sender call) must not count. They
 *   would inflate pressure and the dropped count.
 * - write() during shutdown must not buffer rows that have no flusher.
 *
 * Every test here was proven red against the pre-fix adapter. The mock
 * flush models copy-out: the first call hangs or fails, the second call
 * resolves `false`, an empty buffer. The fixtures moved to the ADR-029
 * engine on 2026-09-05. The timer flush replaced the idle flush, and
 * pressure is the fill against the buffer ceiling.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createQuestDBStorage } from '../index.js';
import { makeMockSender, makeMockDeps, NEVER_SETTLES, ILP_ADDRESS, probeOutcomeFor } from './test-helpers.js';

/** The probe finding a failed flush carries here: the endpoint answers. */
const PROBE_ANSWERS = probeOutcomeFor( ILP_ADDRESS, 'answers' );

const TEST_ASSET_CLASS = {
    name: 'pump',
    columns: {
        ts: { type: 'timestamp' },
        temp: { type: 'float64' }
    },
    insightTypes: {
        monitoring: {
            columns: [ 'ts', 'temp' ],
            designatedTimestamp: 'ts'
        }
    }
};

const GOOD_MSG = { ts: 1735500000000, temp: 25.5 };

// Poll until `condition()` is true or ~500ms elapse; the flush timers
// in these tests fire within a few ticks.
const waitFor = async function ( condition ) {
    for ( let i = 0; i < 50 && !condition(); i += 1 ) {
        // eslint-disable-next-line no-await-in-loop -- wait-for-condition poll
        await new Promise( ( r ) => setTimeout( r, 10 ) );
    }
}; // waitFor()

describe( 'QuestDB flush accounting (copy-out semantics)', function () {

    let mockSender;
    let deps;

    // flushRows 10 gives a ceiling of 100, so one row reads 0.01.
    const makeStorage = ( options = {} ) => createQuestDBStorage(
        TEST_ASSET_CLASS,
        'pump',
        {
            ilpUrl: '127.0.0.1:9000',
            pgUrl: '127.0.0.1:8812',
            flushRows: 10,
            ...options
        },
        deps
    );

    // A short flush timer, shared by the tests that need it to fire.
    const TIMER_OPTS = { flushIntervalMs: 10 };

    beforeEach( function () {
        mockSender = makeMockSender();
        deps = makeMockDeps( mockSender );
    } );

    afterEach( function () {
        // Restores console.error spies even when an assertion threw
        // mid-test (the "already wrapped" cascade).
        sinon.restore();
    } );

    describe( 'B1 — shutdown racing a hung timer flush', function () {

        it( 'reports SHUTDOWN_TIMEOUT with the in-flight count, never clean', async function () {
            // Copy-out model: the timer flush hangs holding the row; any
            // later flush sees an empty buffer and resolves immediately.
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( TIMER_OPTS );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            await waitFor( () => mockSender.flush.callCount >= 1 );
            expect( mockSender.flush.callCount ).to.equal( 1 );

            let thrown = null;
            await storage.shutdown( { timeout: 50 } ).catch( ( err ) => {
                thrown = err;
            } );

            expect( thrown, 'shutdown must not report clean over a hung flush' ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'SHUTDOWN_TIMEOUT' );
            expect( thrown.dropped ).to.deep.equal( { count: 1 } );
        } );

        it( 'still resolves clean when the in-flight flush settles inside the budget', async function () {
            // The timer flush is slow but succeeds: delivery completed,
            // shutdown owes a clean resolve.
            let releaseFlush = null;
            mockSender.flush.onFirstCall().returns(
                new Promise( ( resolve ) => {
                    releaseFlush = resolve;
                } )
            );
            const storage = await makeStorage( TIMER_OPTS );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            await waitFor( () => mockSender.flush.callCount >= 1 );
            const shutdownPromise = storage.shutdown( { timeout: 1000 } );
            releaseFlush( false );

            await shutdownPromise;
            expect( storage.getPressure() ).to.equal( 0 );
        } );

    } );

    describe( 'M2 — shutdown racing a hung recovery flush', function () {

        it( 'counts the rows the recovery flush carries, never clean', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage();

            // One good row is buffered, then the next write throws
            // mid-row. recoverSender() fires the recovery flush, which
            // hangs, and that flush carries the good row out of the buffer.
            expect( storage.write( 'monitoring', GOOD_MSG, 'p1' ).ok ).to.equal( true );
            mockSender.floatColumn.onSecondCall().throws( new Error( 'injected mid-row fault' ) );
            const failed = storage.write( 'monitoring', GOOD_MSG, 'p1' );
            expect( failed.ok ).to.equal( false );
            expect( mockSender.flush.callCount ).to.equal( 1 );

            let thrown = null;
            await storage.shutdown( { timeout: 50 } ).catch( ( err ) => {
                thrown = err;
            } );

            expect( thrown, 'shutdown must not report clean over a hung recovery flush' ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'SHUTDOWN_TIMEOUT' );
            expect( thrown.dropped ).to.deep.equal( { count: 1 } );
        } );

    } );

    describe( 'M3 — shutdown outcome is latched', function () {

        it( 'a second shutdown() call reports the same classified failure, not clean', async function () {
            mockSender.flush.onFirstCall().rejects( new Error( 'ECONNREFUSED' ) );
            const storage = await makeStorage();
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            let first = null;
            await storage.shutdown( { timeout: 1000 } ).catch( ( err ) => {
                first = err;
            } );
            expect( first.code ).to.equal( 'DELIVERY_FAILED' );

            let second = null;
            await storage.shutdown( { timeout: 1000 } ).catch( ( err ) => {
                second = err;
            } );

            expect( second, 'the second call must not contradict the first' ).to.be.an( 'error' );
            expect( second.code ).to.equal( 'DELIVERY_FAILED' );
            expect( second.dropped ).to.deep.equal( first.dropped );
        } );

        it( 'a second shutdown() call after a clean first resolves clean and closes once', async function () {
            const storage = await makeStorage();
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            await storage.shutdown( { timeout: 1000 } );
            await storage.shutdown( { timeout: 1000 } );

            expect( mockSender.close.callCount ).to.equal( 1 );
        } );

    } );

    describe( 'M1 — skipped rows are not counted anywhere', function () {

        it( 'a row the plan skipped adds no pressure and triggers no shutdown flush', async function () {
            const storage = await makeStorage( { onWarning: sinon.stub() } );

            // Missing designated timestamp: phase 1 skips the whole row
            // without touching the sender.
            const result = storage.write( 'monitoring', { temp: 25.5 }, 'p1' );
            expect( result.ok ).to.equal( true );

            expect( storage.getPressure() ).to.equal( 0 );

            await storage.shutdown( { timeout: 1000 } );
            expect( mockSender.flush.called ).to.equal( false );
        } );

    } );

    describe( 'm5 — write() during shutdown is refused, not stranded', function () {

        it( 'returns classified SHUTTING_DOWN instead of buffering unflushables', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage();
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            const shutdownPromise = storage.shutdown( { timeout: 50 } );
            const late = storage.write( 'monitoring', GOOD_MSG, 'p1' );

            expect( late.ok ).to.equal( false );
            expect( late.error.code ).to.equal( 'SHUTTING_DOWN' );

            await shutdownPromise.catch( () => undefined );
        } );

    } );

    describe( 'timer flush failure under copy-out — rows are lost, not retryable', function () {

        it( 'reports the lost count loudly and clears it from pressure', async function () {
            mockSender.flush.onFirstCall().rejects( new Error( 'timer boom' ) );
            const errorSpy = sinon.spy( console, 'error' );
            const storage = await makeStorage( TIMER_OPTS );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            await waitFor( () => errorSpy.called );

            // The copy left the buffer with the failed flush: those rows
            // are gone, and the counter must say so. "Retry on the next
            // tick" cannot resend them.
            expect( errorSpy.calledWithMatch( /flush failed, 1 row\(s\) lost \[DELIVERY_FAILED\]: timer boom/ ) ).to.equal( true );
            expect( storage.getPressure() ).to.equal( 0 );

            await storage.shutdown( { timeout: 1000 } );
        } );

        it( 'routes the loss to onDeliveryFailure when a handler is provided', async function () {
            mockSender.flush.onFirstCall().rejects( new Error( 'timer boom' ) );
            const onDeliveryFailure = sinon.stub();
            const storage = await makeStorage( { ...TIMER_OPTS, onDeliveryFailure } );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            await waitFor( () => onDeliveryFailure.called );

            // Same convention as the recovery flush: the handler receives
            // the RAW client error plus a context object naming the
            // trigger and the cost.
            expect( onDeliveryFailure.callCount ).to.equal( 1 );
            const [ err, ctx ] = onDeliveryFailure.firstCall.args;
            expect( err.message ).to.include( 'timer boom' );
            expect( ctx ).to.deep.equal( { trigger: 'timer', rowsLost: 1, abandoned: false, probe: PROBE_ANSWERS } );

            await storage.shutdown( { timeout: 1000 } );
        } );

    } );

    describe( 'pressure stays visible while a flush is in flight', function () {

        it( 'a hung timer flush reads as pressure, not as delivered', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( TIMER_OPTS );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            await waitFor( () => mockSender.flush.callCount >= 1 );

            expect( storage.getPressure() ).to.equal( 0.01 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
        } );

    } );

} );

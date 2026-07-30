// core/storage-manager/questdb/test/flush-accounting.specs.js

/**
 * @fileoverview Flush accounting under copy-out semantics.
 *
 * The client's flush() copies completed rows OUT of its buffer
 * synchronously, then sends the copy. So the moment a flush is called,
 * its rows are no longer "in the buffer" — they are in flight, and a
 * second flush cannot resend them. The adapter must track the two
 * quantities separately, or shutdown lies:
 *
 * - A hung idle flush holds rows in flight; shutdown's own flush finds
 *   an empty buffer, resolves fast, and shutdown reports CLEAN while
 *   the rows are undelivered.
 * - A recovery flush's rows are counted nowhere, so shutdown skips its
 *   final flush and reports clean over an undelivered copy.
 * - After a lossy shutdown throw, a second shutdown() call sees an
 *   empty buffer and reports clean, contradicting the first call.
 * - Rows the persist plan SKIPPED (no sender call) still increment the
 *   counter, inflating pressure and dropped counts.
 * - write() during shutdown buffers rows that have no flusher left.
 *
 * Every test here was proven red against the pre-fix adapter (the mock
 * flush models copy-out: the first call hangs or fails, the second call
 * resolves `false` — an empty buffer).
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createQuestDBStorage } from '../index.js';
import { makeMockSender, makeMockDeps, NEVER_SETTLES } from './test-helpers.js';

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

// Poll until `condition()` is true or ~500ms elapse; the idle-flush
// timers in these tests fire within a few ticks.
const waitFor = async function ( condition ) {
    for ( let i = 0; i < 50 && !condition(); i += 1 ) {
        // eslint-disable-next-line no-await-in-loop -- wait-for-condition poll
        await new Promise( ( r ) => setTimeout( r, 10 ) );
    }
}; // waitFor()

describe( 'QuestDB flush accounting (copy-out semantics)', function () {

    let mockSender;
    let deps;

    const makeStorage = ( options = {} ) => createQuestDBStorage(
        TEST_ASSET_CLASS,
        'pump',
        {
            ilpUrl: 'localhost:9000',
            pgUrl: 'localhost:8812',
            flushMode: 'manual',
            autoFlushRows: 10,
            ...options
        },
        deps
    );

    // Idle-flush timings shared by the tests that need the timer to fire.
    const IDLE_OPTS = { idleFlushAfterMs: 1, idleFlushCheckMs: 10 };

    beforeEach( function () {
        mockSender = makeMockSender();
        deps = makeMockDeps( mockSender );
    } );

    afterEach( function () {
        // Restores console.error spies even when an assertion threw
        // mid-test (the "already wrapped" cascade).
        sinon.restore();
    } );

    describe( 'B1 — shutdown racing a hung idle flush', function () {

        it( 'reports SHUTDOWN_TIMEOUT with the in-flight count, never clean', async function () {
            // Copy-out model: the idle flush hangs holding the row; any
            // later flush sees an empty buffer and resolves immediately.
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( IDLE_OPTS );
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
            // The idle flush is slow but succeeds — delivery completed,
            // shutdown owes a clean resolve.
            let releaseFlush = null;
            mockSender.flush.onFirstCall().returns(
                new Promise( ( resolve ) => {
                    releaseFlush = resolve;
                } )
            );
            const storage = await makeStorage( IDLE_OPTS );
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

            // One good row buffered, then a mid-row throw on the next
            // write: recoverSender() fires the (hanging) recovery flush
            // that carries the good row out of the buffer.
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

    describe( 'idle-flush failure under copy-out — rows are lost, not retryable', function () {

        it( 'reports the lost count loudly and clears it from pressure', async function () {
            mockSender.flush.onFirstCall().rejects( new Error( 'idle boom' ) );
            const errorSpy = sinon.spy( console, 'error' );
            const storage = await makeStorage( IDLE_OPTS );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            await waitFor( () => errorSpy.called );

            // The copy left the buffer with the failed flush: those rows
            // are gone, and the counter must say so — "retry on next
            // check" cannot resend them.
            expect( errorSpy.calledWithMatch( /1 buffered row\(s\) lost/ ) ).to.equal( true );
            expect( storage.getPressure() ).to.equal( 0 );

            await storage.shutdown( { timeout: 1000 } );
        } );

        it( 'routes the loss to onDeliveryFailure when a handler is provided', async function () {
            mockSender.flush.onFirstCall().rejects( new Error( 'idle boom' ) );
            const onDeliveryFailure = sinon.stub();
            const storage = await makeStorage( { ...IDLE_OPTS, onDeliveryFailure } );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            await waitFor( () => onDeliveryFailure.called );

            // Same convention as the recovery flush and the persist plan:
            // the handler receives the RAW client error plus a context
            // object naming the path and the cost.
            expect( onDeliveryFailure.callCount ).to.equal( 1 );
            const [ err, ctx ] = onDeliveryFailure.firstCall.args;
            expect( err.message ).to.include( 'idle boom' );
            expect( ctx ).to.deep.equal( { idleFlush: true, rowsLost: 1 } );

            await storage.shutdown( { timeout: 1000 } );
        } );

    } );

    describe( 'pressure stays visible while a flush is in flight', function () {

        it( 'a hung idle flush reads as pressure, not as delivered', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( IDLE_OPTS );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            await waitFor( () => mockSender.flush.callCount >= 1 );

            expect( storage.getPressure() ).to.equal( 0.1 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
        } );

    } );

} );

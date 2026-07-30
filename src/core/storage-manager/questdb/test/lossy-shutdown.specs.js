// core/storage-manager/questdb/test/lossy-shutdown.specs.js

/**
 * @fileoverview QuestDB lossy-shutdown reporting (ADR-018
 * drain-then-close shutdown).
 *
 * A clean shutdown resolve is a delivery statement: everything buffered
 * was flushed. When that is not true, shutdown rejects with a classified
 * error naming what was dropped. Three pre-fix behaviors are pinned here,
 * all proven red before the fix:
 * - A FAILED final flush was logged and swallowed — shutdown resolved
 *   cleanly while dropping every buffered row. Now: classified
 *   DELIVERY_FAILED with `dropped: { count }` and the flush error on
 *   `cause`; the transport close is still attempted first (best effort).
 * - A HUNG final flush (the client's retry loop never settles against an
 *   unreachable server) blocked shutdown forever. Now: the flush is raced
 *   against the `{ timeout }` the caller
 *   already passes (ADR-018) → SHUTDOWN_TIMEOUT with the same
 *   `dropped` shape. No timeout supplied = no enforcement (unbounded),
 *   preserving direct-caller behavior.
 * - A HUNG idle flush piled up a new flush call every check interval
 *   (each one a fresh never-settling send). Now: a reentrancy guard —
 *   one boolean — keeps a single flush in flight; a hung flush surfaces
 *   as rising pressure instead of a growing pile of stuck requests.
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

describe( 'QuestDB lossy-shutdown reporting', function () {

    // A failed assertion between spy creation and its manual restore
    // must not leave console.error wrapped for the rest of the run (M6).
    afterEach( function () {
        sinon.restore();
    } );

    let mockSender;
    let deps;

    const makeStorage = ( options = {} ) => createQuestDBStorage(
        TEST_ASSET_CLASS,
        'pump',
        { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812', flushMode: 'manual', ...options },
        deps
    );

    beforeEach( function () {
        mockSender = makeMockSender();
        deps = makeMockDeps( mockSender );
    } );

    describe( 'final flush fails (settled rejection)', function () {

        it( 'rejects with DELIVERY_FAILED, names the dropped count, preserves the cause', async function () {
            const flushError = new Error( 'ECONNREFUSED' );
            const storage = await makeStorage();
            expect( storage.write( 'monitoring', GOOD_MSG, 'p1' ).ok ).to.equal( true );
            mockSender.flush.rejects( flushError );

            let thrown = null;
            await storage.shutdown( { timeout: 1000 } ).catch( ( err ) => {
                thrown = err;
            } );

            expect( thrown, 'shutdown must not resolve cleanly' ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'DELIVERY_FAILED' );
            expect( thrown.dropped ).to.deep.equal( { count: 1 } );
            expect( thrown.cause ).to.equal( flushError );
        } );

        it( 'still attempts the transport close before throwing (best effort)', async function () {
            const storage = await makeStorage();
            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            mockSender.flush.rejects( new Error( 'boom' ) );

            await storage.shutdown( { timeout: 1000 } ).catch( () => undefined );

            expect( mockSender.close.calledOnce ).to.equal( true );
        } );

        it( 'logs when the transport close itself fails — the flush error still wins the throw', async function () {
            const storage = await makeStorage();
            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            mockSender.flush.rejects( new Error( 'flush boom' ) );
            mockSender.close.rejects( new Error( 'close boom' ) );

            const errorSpy = sinon.spy( console, 'error' );
            let thrown = null;
            await storage.shutdown( { timeout: 1000 } ).catch( ( err ) => {
                thrown = err;
            } );
            errorSpy.restore();

            expect( thrown.code ).to.equal( 'DELIVERY_FAILED' );
            expect( thrown.message ).to.include( 'flush boom' );
            expect( errorSpy.calledWithMatch( /transport close failed during lossy shutdown: close boom/ ) ).to.equal( true );
        } );

        it( 'rejects even when no timeout was supplied (failure reporting needs no budget)', async function () {
            const storage = await makeStorage();
            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            mockSender.flush.rejects( new Error( 'boom' ) );

            let thrown = null;
            await storage.shutdown().catch( ( err ) => {
                thrown = err;
            } );

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'DELIVERY_FAILED' );
        } );

    } );

    describe( 'final flush hangs (never settles)', function () {

        it( 'rejects with SHUTDOWN_TIMEOUT and the dropped count once the budget expires', async function () {
            const storage = await makeStorage();
            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            mockSender.flush.returns( NEVER_SETTLES );

            let thrown = null;
            await storage.shutdown( { timeout: 50 } ).catch( ( err ) => {
                thrown = err;
            } );

            expect( thrown, 'shutdown must not hang past its budget' ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'SHUTDOWN_TIMEOUT' );
            expect( thrown.dropped ).to.deep.equal( { count: 2 } );
        } );

        it( 'still attempts the transport close after the timeout', async function () {
            const storage = await makeStorage();
            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            mockSender.flush.returns( NEVER_SETTLES );

            await storage.shutdown( { timeout: 50 } ).catch( () => undefined );

            expect( mockSender.close.calledOnce ).to.equal( true );
        } );

    } );

    describe( 'clean paths stay clean', function () {

        it( 'resolves when the final flush succeeds', async function () {
            const storage = await makeStorage();
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            await storage.shutdown( { timeout: 1000 } );

            expect( mockSender.flush.calledOnce ).to.equal( true );
            expect( mockSender.close.calledOnce ).to.equal( true );
        } );

        it( 'resolves without flushing when nothing is buffered', async function () {
            const storage = await makeStorage();

            await storage.shutdown( { timeout: 1000 } );

            expect( mockSender.flush.called ).to.equal( false );
            expect( mockSender.close.calledOnce ).to.equal( true );
        } );

    } );

    describe( 'M7 — no timeout means wait indefinitely (documented limitation)', function () {

        it( 'shutdown() without a timeout stays pending on a hung final flush until it settles', async function () {
            // The adapter documents that a shutdown with no timeout waits
            // forever on a hung flush. Pin it: race the shutdown against a
            // short timer, then release the flush so the test ends clean.
            let releaseFlush;
            const gate = new Promise( ( resolve ) => {
                releaseFlush = resolve;
            } );
            const storage = await makeStorage();
            mockSender.flush.returns( gate );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            let settled = false;
            const shutdownPromise = storage.shutdown().then( () => {
                settled = true;
            } );

            await new Promise( ( r ) => setTimeout( r, 100 ) );
            expect( settled, 'no-timeout shutdown must still be waiting on the hung flush' ).to.equal( false );

            releaseFlush();
            await shutdownPromise;
            expect( settled ).to.equal( true );
        } );

    } );

    describe( 'idle-flush reentrancy guard', function () {

        let storage = null;

        // Teardown must survive a failed assertion (m9). Shutdown without
        // touching the hung flush: nothing buffered ever settles, so
        // shutdown would race its own flush — give it a tiny budget and
        // swallow the classified throw.
        afterEach( async function () {
            if ( storage ) {
                await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
                storage = null;
            }
        } );

        it( 'a hung idle flush is reported by shutdown: SHUTDOWN_TIMEOUT with the in-flight count (R6 regression)', async function () {
            storage = await makeStorage( {
                idleFlushAfterMs: 1,
                idleFlushCheckMs: 10,
                autoFlushRows: 10
            } );
            mockSender.flush.returns( NEVER_SETTLES );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            // Wait for the idle flush to fire and hang: the row moves from
            // buffered to in-flight under the R1 accounting.
            for ( let i = 0; i < 50 && mockSender.flush.callCount === 0; i += 1 ) {
                // eslint-disable-next-line no-await-in-loop -- wait-for-condition poll
                await new Promise( ( r ) => setTimeout( r, 10 ) );
            }
            expect( mockSender.flush.callCount ).to.equal( 1 );

            let thrown = null;
            await storage.shutdown( { timeout: 50 } ).catch( ( err ) => {
                thrown = err;
            } );

            expect( thrown, 'a hung in-flight row must fail the shutdown' ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'SHUTDOWN_TIMEOUT' );
            expect( thrown.dropped ).to.deep.equal( { count: 1 } );
        } );

        it( 'a hung idle flush does not pile up a new flush every check interval', async function () {
            storage = await makeStorage( {
                idleFlushAfterMs: 1,
                idleFlushCheckMs: 10,
                // Pressure needs a capacity reference: without autoFlushRows
                // configured, getPressure() has no denominator and reads 0.
                autoFlushRows: 10
            } );
            mockSender.flush.returns( NEVER_SETTLES );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            // Wait for the first idle flush to fire, then several more
            // check intervals — without the guard each tick would call
            // flush again (bufferedRows stays > 0 while the flush hangs).
            for ( let i = 0; i < 50 && mockSender.flush.callCount === 0; i += 1 ) {
                // eslint-disable-next-line no-await-in-loop -- wait-for-condition poll
                await new Promise( ( r ) => setTimeout( r, 10 ) );
            }
            await new Promise( ( r ) => setTimeout( r, 60 ) );

            expect( mockSender.flush.callCount ).to.equal( 1 );

            // The hung flush is visible as pressure, not hidden — and the
            // value is deterministic: one in-flight row over the
            // autoFlushRows capacity of 10 (m9: exact, not just > 0).
            expect( storage.getPressure() ).to.equal( 0.1 );
        } );

    } );

} );

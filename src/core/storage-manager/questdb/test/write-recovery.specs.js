// core/storage-manager/questdb/test/write-recovery.specs.js

/**
 * @fileoverview Mid-row write recovery — one bad value costs one row, never the run.
 *
 * Guards, at the adapter seam, ADR-018's rule that a rejected message
 * costs only itself: when a persist plan throws between
 * sender.table() and sender.at(), the sender is left holding a half-written row.
 * Without recovery, every later write fails with "Table name has already been
 * set" — the 2026-06-10 incident lost 98.6% of a replay's rows this way. The
 * adapter's write() catch cancels the broken row (flush + reset — see the
 * adapter file header for why those two calls), so the NEXT write succeeds.
 *
 * Two tiers:
 * - Mock-sender tests pin the recovery calls, the classified return, the
 *   pressure-counter reset, and the loud handling of a failed recovery flush.
 * - A real-client tier drives the genuine wedge in @questdb/nodejs-client
 *   (no server needed; protocol_version pinned so fromConfig skips its
 *   /settings probe) and proves the next row builds after recovery. The
 *   trigger is a FAULT-INJECTED plan: after the prevention layers, no plan
 *   built from an asset class can reach a mid-row client throw — wrong-typed
 *   values are skipped in phase 1 and bad names fail the build with
 *   INVALID_CONFIG. What remains is the unforeseeable (a client bug, a future
 *   client change), which is exactly what this recovery insures against — so
 *   the test models it directly: a plan that opens a real row, then throws.
 *
 * No test here may leave an unsettled send: against an unreachable server the
 * client's retry loop never settles (undici RetryAgent, maxRetries: Infinity),
 * and an in-flight send would keep the process
 * alive past the test run. The real-client wedge therefore fires on the FIRST
 * write — the buffer holds no completed rows, so the recovery flush is a
 * documented no-op and nothing is ever sent. Live delivery of recovered
 * streams is the hardening tier's job (slow-questdb-recovery.specs.js).
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { Sender } from '@questdb/nodejs-client';

import { createQuestDBStorage } from '../index.js';
import { makeMockSender, makeMockDeps } from './test-helpers.js';

const TEST_ASSET_CLASS = {
    name: 'pump',
    columns: {
        ts: { type: 'timestamp' },
        temp: { type: 'float64' },
        pressure: { type: 'float64' }
    },
    insightTypes: {
        monitoring: {
            columns: [ 'ts', 'temp', 'pressure' ],
            designatedTimestamp: 'ts'
        }
    }
};

const GOOD_MSG = { ts: 1735500000000, temp: 25.5, pressure: 101.3 };

describe( 'QuestDB write recovery after a mid-row throw', function () {

    // A failed assertion between spy creation and its manual restore
    // must not leave console.error wrapped for the rest of the run (M6).
    afterEach( function () {
        sinon.restore();
    } );

    // ------------------------------------------------------------------
    // Mock-sender tier
    // ------------------------------------------------------------------

    describe( 'with a mock sender', function () {

        let mockSender;
        let deps;

        // The unhandledRejection listener removes itself when the expected
        // rejection arrives; when a test fails by timeout instead, it must
        // not stay installed for the rest of the run (m9).
        let strayRejectionListener = null;
        afterEach( function () {
            if ( strayRejectionListener ) {
                process.removeListener( 'unhandledRejection', strayRejectionListener );
                strayRejectionListener = null;
            }
        } );

        const makeStorage = ( options = {} ) => createQuestDBStorage(
            TEST_ASSET_CLASS,
            'pump',
            { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812', flushMode: 'auto', ...options },
            deps
        );

        beforeEach( function () {
            mockSender = makeMockSender();
            deps = makeMockDeps( mockSender );
        } );

        it( 'recovers the sender on a mid-row throw: flush + reset called, next write succeeds', async function () {
            const storage = await makeStorage();
            // First floatColumn call throws mid-row (after table + symbol);
            // later calls behave normally — the client error is one-shot.
            mockSender.floatColumn.onFirstCall().throws( new Error( 'Invalid character in column name' ) );

            const first = storage.write( 'monitoring', GOOD_MSG, 'p1' );
            expect( first.ok ).to.equal( false );
            expect( first.error.code ).to.equal( 'SEND_FAILED' );
            // The recovery pair ran, in order.
            expect( mockSender.flush.calledOnce ).to.equal( true );
            expect( mockSender.reset.calledOnce ).to.equal( true );
            expect( mockSender.reset.calledAfter( mockSender.flush ) ).to.equal( true );

            const second = storage.write( 'monitoring', GOOD_MSG, 'p1' );
            expect( second ).to.deep.equal( { ok: true } );
        } );

        it( 'keeps the recovery flush\'s rows visible as pressure until it settles', async function () {
            const storage = await makeStorage( { autoFlushRows: 10 } );

            expect( storage.write( 'monitoring', GOOD_MSG, 'p1' ).ok ).to.equal( true );
            expect( storage.getPressure() ).to.equal( 0.1 );

            // Throw only for the poison value, so the good write above is untouched.
            mockSender.floatColumn.withArgs( 'temp', 99 ).throws( new Error( 'boom' ) );
            storage.write( 'monitoring', { ...GOOD_MSG, temp: 99 }, 'p1' );

            // Recovery moved the one good row out of the buffer INTO the
            // in-flight recovery flush. Until that flush settles, the row
            // is undelivered and must still read as pressure — making it
            // vanish here is what hid recovery rows from shutdown.
            expect( storage.getPressure() ).to.equal( 0.1 );

            // The mock flush resolves on the next microtask: delivered,
            // and only then does pressure drop.
            await Promise.resolve();
            expect( storage.getPressure() ).to.equal( 0 );
        } );

        it( 'routes a failed recovery flush to onDeliveryFailure (the early flush carries real data)', async function () {
            const flushError = new Error( 'ECONNREFUSED' );
            const failures = [];
            const storage = await makeStorage( {
                onDeliveryFailure: ( err, ctx ) => failures.push( { err, ctx } )
            } );
            mockSender.flush.rejects( flushError );
            mockSender.floatColumn.onFirstCall().throws( new Error( 'boom' ) );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            // The rejection is delivered asynchronously.
            await new Promise( ( resolve ) => setImmediate( resolve ) );

            expect( failures ).to.have.lengthOf( 1 );
            expect( failures[ 0 ].err ).to.equal( flushError );
            expect( failures[ 0 ].ctx ).to.deep.equal( { recovery: true } );
        } );

        it( 'throws DELIVERY_FAILED as an unhandled rejection when the recovery flush fails with no onDeliveryFailure', function ( done ) {
            // Same capture pattern as persist-plan.specs.js: the throw inside
            // the Promise chain surfaces as an unhandled rejection; the settled
            // flag guards against unrelated stray rejections.
            const flushError = new Error( 'ECONNREFUSED' );
            let settled = false;
            const onUnhandledRejection = ( err ) => {
                if ( settled ) return;
                if ( !err || err.code !== 'DELIVERY_FAILED' ) return;
                settled = true;
                process.removeListener( 'unhandledRejection', onUnhandledRejection );
                try {
                    expect( err.message ).to.contain( 'recovery flush failed' );
                    expect( err.cause ).to.equal( flushError );
                    done();
                } catch ( assertErr ) {
                    done( assertErr );
                }
            };
            process.on( 'unhandledRejection', onUnhandledRejection );
            strayRejectionListener = onUnhandledRejection;

            makeStorage().then( ( storage ) => {
                mockSender.flush.rejects( flushError );
                mockSender.floatColumn.onFirstCall().throws( new Error( 'boom' ) );
                storage.write( 'monitoring', GOOD_MSG, 'p1' );
            } );
        } );

        it( 'never throws from write() even when recovery itself fails (defensive wrap)', async function () {
            const storage = await makeStorage();
            const errorSpy = sinon.spy( console, 'error' );
            mockSender.floatColumn.onFirstCall().throws( new Error( 'boom' ) );
            mockSender.reset = sinon.stub().throws( new Error( 'future client changed reset()' ) );

            let result;
            expect( () => {
                result = storage.write( 'monitoring', GOOD_MSG, 'p1' );
            } ).to.not.throw();
            expect( result.ok ).to.equal( false );
            expect( result.error.code ).to.equal( 'SEND_FAILED' );
            // The recovery failure is loud, not silent.
            expect( errorSpy.calledWithMatch( /sender recovery failed/ ) ).to.equal( true );
            errorSpy.restore();
        } );

    } );

    // ------------------------------------------------------------------
    // Real-client tier — the genuine wedge, no server needed
    // ------------------------------------------------------------------

    describe( 'with the real @questdb/nodejs-client', function () {

        it( 'clears the genuine wedge: mid-row throw on the real buffer, then the next write succeeds', async function () {
            const storage = await createQuestDBStorage(
                TEST_ASSET_CLASS,
                'pump',
                {
                    // A dead address: nothing may ever actually send to it —
                    // the client retries a connect error forever (see the
                    // teardown note at the end of this test).
                    ilpUrl: '127.0.0.1:1',
                    pgUrl: 'localhost:8812',
                    flushMode: 'manual',
                    retryTimeout: 1
                },
                {
                    // Wrap the real Sender only to pin protocol_version, so
                    // fromConfig skips its /settings probe (there is no server).
                    SenderClass: {
                        fromConfig: ( cfg ) => Sender.fromConfig( cfg + 'protocol_version=1;' )
                    },
                    PgClientClass: sinon.stub().returns( {
                        connect: sinon.stub().resolves(),
                        query: sinon.stub().resolves(),
                        end: sinon.stub().resolves()
                    } )
                }
            );

            // The adapter's documented debug hooks, renamed on the way in so
            // the dangling-underscore originals appear only here.
            const { _sender: rawSender, _persistPlans: plans } = storage;

            // The body runs inside try/finally (B2): if any assertion below
            // fails, the teardown MUST still run — a skipped teardown leaves
            // a buffered row for the idle-flush timer to send against the
            // dead address ~5s later, and its infinite retries hold the
            // whole mocha process open forever (reproduced in a standalone
            // script during the incident). A failing test must fail loudly,
            // not hang CI.
            try {
                // Inject the fault: open a genuine row on the REAL buffer, then
                // throw before at() — the sender is wedged exactly as in the
                // incident ("Table name has already been set" on any later write).
                const originalPlan = plans.monitoring;
                plans.monitoring = function ( sender, message, partitionId ) {
                    sender.table( 'pump_monitoring' );
                    sender.symbol( 'assetId', partitionId );
                    throw new Error( 'injected mid-row fault (models an unforeseen client throw)' );
                };

                const first = storage.write( 'monitoring', GOOD_MSG, 'p1' );
                expect( first.ok ).to.equal( false );
                expect( first.error.code ).to.equal( 'SEND_FAILED' );
                expect( first.error.message ).to.contain( 'injected mid-row fault' );

                // Restore the real plan. Without recovery, this write fails with
                // "Table name has already been set" — the incident cascade.
                plans.monitoring = originalPlan;
                const second = storage.write( 'monitoring', GOOD_MSG, 'p1' );
                expect( second ).to.deep.equal( { ok: true } );
            } finally {
                // Teardown, learned the hard way (2026-07-06 exit-hang root
                // cause). storage.shutdown() would flush the buffered row
                // against the dead address and hang: the client's retry loop
                // never settles. Skipping shutdown alone is not enough either
                // — the adapter's idle-flush timer stays alive and fires the
                // SAME send ~5s later, from inside whatever test is then
                // running. So: empty the client buffer first (public reset())
                // — the idle flush then finds nothing to send, settles as a
                // no-op, and zeroes the adapter's counter — then close the
                // transport. Real shutdown() becomes safe against a dead
                // transport only when it is time-bounded (the Kind-4 work).
                rawSender.reset();
                await rawSender.close();
            }
        } );

    } );

} );

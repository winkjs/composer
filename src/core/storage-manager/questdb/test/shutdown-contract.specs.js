// core/storage-manager/questdb/test/shutdown-contract.specs.js

/**
 * @fileoverview The `shutdown()` of the QuestDB storage adapter
 * (ADR-018 drain-then-close).
 *
 * `shutdown()` flushes what is buffered, then closes the sender. A clean
 * resolve is a delivery statement. Every row still buffered was sent
 * and confirmed. When the final flush fails, the close still happens
 * and the call rejects with a classified `DELIVERY_FAILED`. The call
 * accepts no argument, an empty object, or `{ timeout }`. The budget
 * itself is enforced by the drain and pinned in lossy-shutdown.specs.js.
 *
 * Shutdown is idempotent by identity. The engine latches the first
 * call's promise, and every later call returns that same promise. So a
 * second call can never contradict the first, clean or lossy.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';

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

const ADDRESSES = { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812' };

const GOOD_MSG = { ts: 1000, temp: 20.0, pressure: 90.0 };

describe( 'QuestDB shutdown() contract (ADR-018)', function () {

    let mockSender;
    let deps;

    beforeEach( function () {
        mockSender = makeMockSender();
        deps = makeMockDeps( mockSender );
    } );

    // --------------------------------------------------------------------
    // shutdown()
    // --------------------------------------------------------------------

    describe( 'shutdown()', function () {

        it( 'should close the sender', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            await storage.shutdown();

            expect( mockSender.close.calledOnce ).to.equal( true );
        } );

        it( 'should flush pending rows before shutdown', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await storage.shutdown();

            expect( mockSender.flush.calledOnce ).to.equal( true );
            expect( mockSender.flush.calledBefore( mockSender.close ) ).to.equal( true );
        } );

        it( 'should close even if flush fails — and reject classified (ADR-018)', async function () {
            mockSender.flush.rejects( new Error( 'Flush failed' ) );

            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            // A failed final flush is a data loss — shutdown reports it
            // instead of resolving cleanly. The close still happens first.
            let thrown = null;
            await storage.shutdown().catch( ( err ) => {
                thrown = err;
            } );

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'DELIVERY_FAILED' );
            expect( mockSender.close.calledOnce ).to.equal( true );
        } );

    } );

    // --------------------------------------------------------------------
    // Signature — ADR-018 drain-then-close
    // --------------------------------------------------------------------
    // QuestDB accepts the contract shape `{ timeout }` per ADR-018, and
    // enforces it: delivery waits race the budget, and an overrun throws
    // classified SHUTDOWN_TIMEOUT with the dropped-row count (pinned by
    // lossy-shutdown.specs.js). These tests verify the SIGNATURE accepts
    // all three documented call shapes.

    describe( 'shutdown() signature accepts the ADR-018 call shapes', function () {

        it( 'accepts no arg — historical call shape', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            await storage.shutdown();
        } );

        it( 'accepts empty object {} — destructure default applies', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            await storage.shutdown( {} );
        } );

        it( 'accepts { timeout: N } — explicit contract form', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            await storage.shutdown( { timeout: 100 } );
        } );

    } );

    // --------------------------------------------------------------------
    // Idempotent by identity — ADR-018
    // --------------------------------------------------------------------
    // The engine latches the outcome of the first call. A re-run after
    // a lossy first call would find an empty buffer and resolve clean,
    // contradicting the recorded loss. Returning the same promise is
    // what makes that contradiction impossible. The outcome side is
    // pinned in flush-accounting.specs.js. This is the identity side.

    describe( 'shutdown() returns one promise for every call', function () {

        it( 'a second shutdown() call returns the same promise as the first, after a clean and after a lossy first call', async function () {
            // Clean: nothing buffered, the drain resolves.
            const clean = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            const firstClean = clean.shutdown();
            const secondClean = clean.shutdown();

            expect( secondClean ).to.equal( firstClean );
            await firstClean;

            // Lossy: the final flush fails, so the drain rejects with
            // DELIVERY_FAILED. The later call must hand back that same
            // rejected promise, never a fresh clean one.
            const lossySender = makeMockSender();
            lossySender.flush.rejects( new Error( 'Flush failed' ) );
            const lossy = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, makeMockDeps( lossySender ) );
            lossy.write( 'monitoring', GOOD_MSG, 'p1' );

            const firstLossy = lossy.shutdown();
            const secondLossy = lossy.shutdown();

            expect( secondLossy ).to.equal( firstLossy );
            const thrown = await firstLossy.catch( ( err ) => err );
            expect( thrown.code ).to.equal( 'DELIVERY_FAILED' );
        } );

    } );

} );

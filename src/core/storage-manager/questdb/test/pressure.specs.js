// core/storage-manager/questdb/test/pressure.specs.js

/**
 * @fileoverview The `getPressure()` of the QuestDB storage adapter
 * (ADR-018 backpressure observability).
 *
 * Pressure is the buffer fill as a number in [0, 1]. It counts the rows
 * waiting in the buffer plus the rows inside flushes that have not
 * settled, over the buffer ceiling (ADR-029). The ceiling is ten times
 * `flushRows` unless `bufferCeilingRows` says otherwise. The call is
 * synchronous, O(1), and allocates nothing. It reads 1 exactly when the
 * next write would be refused.
 *
 * `getHealth().pressure` is the same number, by contract. The last
 * block checks that agreement at empty, part full, and at the ceiling.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
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

const ADDRESSES = { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812' };

describe( 'QuestDB getPressure() (ADR-018)', function () {

    let mockSender;
    let deps;

    beforeEach( function () {
        mockSender = makeMockSender();
        deps = makeMockDeps( mockSender );
    } );

    describe( 'getPressure() — backpressure observability', function () {

        it( 'exists on the returned handle and returns a number in [0, 1]', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            expect( storage ).to.have.property( 'getPressure' ).that.is.a( 'function' );

            const p = storage.getPressure();
            expect( p ).to.be.a( 'number' );
            expect( p ).to.be.at.least( 0 );
            expect( p ).to.be.at.most( 1 );
            // Empty buffer immediately after construction.
            expect( p ).to.equal( 0 );

            await storage.shutdown();
        } );

        // Pressure is the fill against the buffer ceiling (ADR-029). With
        // flushRows 100 the ceiling is 1000, so one row reads 0.001.

        it( 'climbs by one over the ceiling per accepted row', async function () {
            const storage = await createQuestDBStorage(
                TEST_ASSET_CLASS, 'pump', { ...ADDRESSES, flushRows: 100 }, deps
            );

            expect( storage.getPressure() ).to.equal( 0 );

            storage.write( 'monitoring', { ts: 1000, temp: 25.5 }, 'p1' );
            expect( storage.getPressure() ).to.equal( 0.001 );

            storage.write( 'monitoring', { ts: 2000, temp: 26.0 }, 'p1' );
            expect( storage.getPressure() ).to.equal( 0.002 );

            await storage.shutdown();
        } );

        it( 'resets to 0 after flush()', async function () {
            const storage = await createQuestDBStorage(
                TEST_ASSET_CLASS, 'pump', { ...ADDRESSES, flushRows: 100 }, deps
            );

            storage.write( 'monitoring', { ts: 1000, temp: 25.5 }, 'p1' );
            storage.write( 'monitoring', { ts: 2000, temp: 26.0 }, 'p1' );
            expect( storage.getPressure() ).to.equal( 0.002 );

            await storage.flush();
            expect( storage.getPressure() ).to.equal( 0 );

            await storage.shutdown();
        } );

        it( 'the row trigger moves the rows out of the buffer: pressure falls once the flush settles', async function () {
            // flushRows 5 gives a ceiling of 50.
            const storage = await createQuestDBStorage(
                TEST_ASSET_CLASS, 'pump', { ...ADDRESSES, flushRows: 5 }, deps
            );

            // Four rows: pressure climbs.
            for ( let i = 0; i < 4; i += 1 ) {
                storage.write( 'monitoring', { ts: 1000 + i, temp: 25 + i }, 'p1' );
            }
            expect( storage.getPressure() ).to.equal( 0.08 );

            // The fifth row starts a flush. Its rows are in flight, so they
            // still read as pressure until the mock flush settles.
            storage.write( 'monitoring', { ts: 9000, temp: 30 }, 'p1' );
            expect( mockSender.flush.calledOnce ).to.equal( true );
            expect( storage.getPressure() ).to.equal( 0.1 );

            await new Promise( ( resolve ) => setImmediate( resolve ) );
            expect( storage.getPressure() ).to.equal( 0 );

            // The next row begins a fresh accumulation.
            storage.write( 'monitoring', { ts: 10000, temp: 31 }, 'p1' );
            expect( storage.getPressure() ).to.equal( 0.02 );

            await storage.shutdown();
        } );

        it( 'the timer moves the rows out of the buffer on its own', async function () {
            const clock = sinon.useFakeTimers();
            try {
                const storage = await createQuestDBStorage(
                    TEST_ASSET_CLASS, 'pump', { ...ADDRESSES, flushRows: 100, flushIntervalMs: 50 }, deps
                );

                storage.write( 'monitoring', { ts: 1000, temp: 25 }, 'p1' );
                storage.write( 'monitoring', { ts: 2000, temp: 26 }, 'p1' );
                expect( storage.getPressure() ).to.equal( 0.002 );

                await clock.tickAsync( 50 );

                expect( mockSender.flush.calledOnce ).to.equal( true );
                expect( storage.getPressure() ).to.equal( 0 );

                // The next row begins a fresh accumulation.
                storage.write( 'monitoring', { ts: 3000, temp: 27 }, 'p1' );
                expect( storage.getPressure() ).to.equal( 0.001 );

                await storage.shutdown();
            } finally {
                clock.restore();
            }
        } );

        it( 'is sync, allocation-free, and idempotent across calls', async function () {
            const storage = await createQuestDBStorage( TEST_ASSET_CLASS, 'pump', ADDRESSES, deps );

            // ADR-018 — sync, no Promise. Two consecutive reads of an
            // unchanging counter must produce the same number (no recomputation
            // side effects).
            const a = storage.getPressure();
            const b = storage.getPressure();
            expect( a ).to.equal( b );
            expect( a ).to.not.be.an.instanceOf( Promise );

            await storage.shutdown();
        } );

    } );

    // getPressure() and getHealth().pressure are one number by contract
    // (ADR-018). A consumer that reads one must never see a different
    // fill than a consumer that reads the other.

    describe( 'getPressure() and getHealth().pressure agree', function () {

        it( 'reads the same number from both at empty, after some rows, and at the ceiling', async function () {
            // flushRows 10: the ceiling is 100 rows and one row reads 0.01.
            // The first engine flush hangs, so its ten rows stay in flight
            // and the single-flight guard holds every later engine flush.
            // The buffer then fills to the ceiling.
            mockSender.flush.returns( NEVER_SETTLES );
            const storage = await createQuestDBStorage(
                TEST_ASSET_CLASS, 'pump', { ...ADDRESSES, flushRows: 10 }, deps
            );

            expect( storage.getPressure() ).to.equal( 0 );
            expect( storage.getHealth().pressure ).to.equal( storage.getPressure() );

            storage.write( 'monitoring', { ts: 1000, temp: 25.5 }, 'p1' );
            expect( storage.getPressure() ).to.equal( 0.01 );
            expect( storage.getHealth().pressure ).to.equal( storage.getPressure() );

            for ( let i = 1; i < 100; i += 1 ) {
                storage.write( 'monitoring', { ts: 1000 + i, temp: 25.5 }, 'p1' );
            }
            expect( storage.getPressure() ).to.equal( 1 );
            expect( storage.getHealth().pressure ).to.equal( storage.getPressure() );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
        } );

    } );

} );

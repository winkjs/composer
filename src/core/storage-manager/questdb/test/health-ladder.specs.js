// core/storage-manager/questdb/test/health-ladder.specs.js

/**
 * @fileoverview Health reads flush outcomes (ADR-029).
 *
 * Before this change `getHealth()` read buffering, the pause, and
 * pressure. It did not read flush outcomes. A server that answered
 * every send with an error kept the probe passing, so delivery never
 * paused, and health stayed green while every flush failed. Now the
 * ledger records each settled flush, and health reads a ladder:
 * yellow on the first failed flush, red on the second in a row or on
 * any abandoned flush, green again on the next success.
 *
 * Three fields join the health object. `consecutiveFlushFailures` says
 * whether trouble is current. `lastFlushAt` says when rows last
 * landed. `lastFlushError` says what the last failure was, as
 * `{ message, abandoned, at }`, and it stays readable after recovery.
 *
 * Every tracked flush counts: the row and timer triggers, the recovery
 * flush after a mid-row throw, an explicit `flush()`, and the drain's
 * final flush. A late result on an abandoned flush is inert here as
 * everywhere. The write path does not change.
 *
 * Every case here was written before the engine changed and proven red
 * against the 2b engine.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createQuestDBStorage } from '../index.js';
import {
    makeMockSender,
    makeMockDeps,
    NEVER_SETTLES,
    makeScriptedProbe
} from './test-helpers.js';

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

const ADDRESSES = { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812' };

/** A fixed wall clock, so every timestamp has a value the spec can name. */
const NOW = 1735500000000;

/** The complete key set of the health object. */
const HEALTH_KEYS = [
    'status', 'connected', 'pressure',
    'consecutiveWriteErrors', 'bufferedRows', 'inFlightRows',
    'abandonedFlushes', 'pausedSince',
    'consecutiveFlushFailures', 'lastFlushAt', 'lastFlushError'
];

/** Writes `count` good rows. */
const writeRows = function ( storage, count ) {
    for ( let i = 0; i < count; i += 1 ) {
        storage.write( 'monitoring', GOOD_MSG, 'p1' );
    }
}; // writeRows()

describe( 'QuestDB health ladder (ADR-029)', function () {

    let mockSender;
    let deps;
    let probe;
    let clock;

    const makeStorage = ( options = {} ) => createQuestDBStorage(
        TEST_ASSET_CLASS,
        'pump',
        { ...ADDRESSES, flushRows: 2, flushIntervalMs: 1000, onDeliveryFailure: sinon.stub(), ...options },
        deps
    );

    /** Writes two rows, so the row trigger starts one flush, and lets it settle. */
    const flushOnce = async function ( storage ) {
        writeRows( storage, 2 );
        await clock.tickAsync( 0 );
    }; // flushOnce()

    beforeEach( function () {
        clock = sinon.useFakeTimers( { now: NOW } );
        mockSender = makeMockSender();
        probe = makeScriptedProbe();
        deps = makeMockDeps( mockSender );
        deps.probeFn = probe.probeFn;
    } );

    afterEach( function () {
        clock.restore();
        sinon.restore();
    } );

    describe( 'the surface', function () {

        it( 'starts with no failures, no last flush, and no last error', async function () {
            const storage = await makeStorage();

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'green' );
            expect( health.consecutiveFlushFailures ).to.equal( 0 );
            expect( health.lastFlushAt ).to.equal( null );
            expect( health.lastFlushError ).to.equal( null );
        } );

        it( 'carries exactly the documented keys', async function () {
            const storage = await makeStorage();

            expect( storage.getHealth() ).to.have.all.keys( HEALTH_KEYS );
        } );

        it( 'a healthy flush sets lastFlushAt and leaves every other reading green', async function () {
            const storage = await makeStorage();
            await clock.tickAsync( 10 );

            await flushOnce( storage );

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'green' );
            expect( health.connected ).to.equal( true );
            expect( health.lastFlushAt ).to.equal( NOW + 10 );
            expect( health.consecutiveFlushFailures ).to.equal( 0 );
            expect( health.lastFlushError ).to.equal( null );
            expect( health.consecutiveWriteErrors ).to.equal( 0 );
        } );
    } );

    describe( 'the ladder', function () {

        it( 'reads yellow after the first failed flush, still connected', async function () {
            mockSender.flush.onFirstCall().rejects( new Error( 'disk full' ) );
            const storage = await makeStorage();

            await flushOnce( storage );

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'yellow' );
            expect( health.connected ).to.equal( true );
            expect( health.consecutiveFlushFailures ).to.equal( 1 );
            expect( health.lastFlushError ).to.deep.equal( { message: 'disk full', abandoned: false, at: NOW } );
            expect( health.lastFlushAt ).to.equal( null );
            // Buffering and delivery are different failures.
            expect( health.consecutiveWriteErrors ).to.equal( 0 );
            expect( health.pausedSince ).to.equal( null );
        } );

        it( 'reads red and not connected after the second failed flush in a row', async function () {
            mockSender.flush.rejects( new Error( 'disk full' ) );
            const storage = await makeStorage();

            await flushOnce( storage );
            await flushOnce( storage );

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'red' );
            expect( health.connected ).to.equal( false );
            expect( health.consecutiveFlushFailures ).to.equal( 2 );
            // The probe passed, so this is a server that answers and refuses.
            expect( health.pausedSince ).to.equal( null );
        } );

        it( 'reads green again after a success, and keeps the last error readable', async function () {
            mockSender.flush.onFirstCall().rejects( new Error( 'disk full' ) );
            const storage = await makeStorage();

            await flushOnce( storage );
            await clock.tickAsync( 10 );
            await flushOnce( storage );

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'green' );
            expect( health.connected ).to.equal( true );
            expect( health.consecutiveFlushFailures ).to.equal( 0 );
            expect( health.lastFlushAt ).to.equal( NOW + 10 );
            expect( health.lastFlushError ).to.deep.equal( { message: 'disk full', abandoned: false, at: NOW } );
        } );

        it( 'reads red after one abandoned flush, even when the probe passes', async function () {
            mockSender.flush.returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushDeadlineMs: 300 } );

            writeRows( storage, 2 );
            await clock.tickAsync( 300 );

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'red' );
            expect( health.connected ).to.equal( false );
            expect( health.consecutiveFlushFailures ).to.equal( 1 );
            expect( health.abandonedFlushes ).to.equal( 1 );
            expect( health.lastFlushError.abandoned ).to.equal( true );
            expect( health.lastFlushError.at ).to.equal( NOW + 300 );
            expect( health.lastFlushError.message ).to.include( 'no answer within 300 ms' );
            expect( health.pausedSince ).to.equal( null );
        } );

        it( 'reads red while delivery is paused, and green after the catch-up flush lands', async function () {
            mockSender.flush.onFirstCall().rejects( new Error( 'ECONNREFUSED' ) );
            const storage = await makeStorage();
            probe.setResult( 'refused' );

            await flushOnce( storage );
            writeRows( storage, 3 );

            let health = storage.getHealth();
            expect( health.status ).to.equal( 'red' );
            expect( health.pausedSince ).to.equal( NOW );
            expect( health.consecutiveFlushFailures ).to.equal( 1 );

            probe.setResult( 'answers' );
            await clock.tickAsync( 1000 );

            health = storage.getHealth();
            expect( health.status ).to.equal( 'green' );
            expect( health.connected ).to.equal( true );
            expect( health.consecutiveFlushFailures ).to.equal( 0 );
            expect( health.lastFlushAt ).to.equal( NOW + 1000 );
            expect( health.lastFlushError.message ).to.equal( 'ECONNREFUSED' );
        } );
    } );

    describe( 'every tracked flush counts', function () {

        it( 'a timer-path failure while write-idle', async function () {
            mockSender.flush.rejects( new Error( 'disk full' ) );
            const storage = await makeStorage( { flushRows: 100 } );

            writeRows( storage, 1 );
            await clock.tickAsync( 1000 );

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'yellow' );
            expect( health.consecutiveFlushFailures ).to.equal( 1 );
            expect( health.lastFlushError.at ).to.equal( NOW + 1000 );
        } );

        it( 'an explicit flush() that rejects', async function () {
            mockSender.flush.rejects( new Error( 'disk full' ) );
            const storage = await makeStorage( { flushRows: 100 } );

            writeRows( storage, 1 );
            let rejected = null;
            await storage.flush().catch( ( err ) => {
                rejected = err;
            } );

            expect( rejected.message ).to.equal( 'disk full' );
            const health = storage.getHealth();
            expect( health.status ).to.equal( 'yellow' );
            expect( health.consecutiveFlushFailures ).to.equal( 1 );
        } );

        it( 'the recovery flush after a mid-row throw', async function () {
            mockSender.flush.rejects( new Error( 'disk full' ) );
            mockSender.floatColumn.withArgs( 'temp', 99 ).throws( new Error( 'boom' ) );
            const storage = await makeStorage( { flushRows: 100 } );

            writeRows( storage, 1 );
            storage.write( 'monitoring', { ts: 1735500000000, temp: 99 }, 'p1' );
            await clock.tickAsync( 0 );

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'yellow' );
            expect( health.consecutiveFlushFailures ).to.equal( 1 );
        } );

        it( 'but a mid-row throw over an empty buffer sends nothing, so red stays red', async function () {
            // Two failed flushes take the ladder to red. Then a poison
            // write arrives with nothing buffered. Recovery must only reset
            // the sender. A flush of an empty buffer resolves at once (the
            // client returns false), and counting it as a success would
            // print "delivery restored" while the endpoint is still dead.
            mockSender.flush.rejects( new Error( 'disk full' ) );
            mockSender.floatColumn.withArgs( 'temp', 99 ).throws( new Error( 'boom' ) );
            const storage = await makeStorage();

            await flushOnce( storage );
            await flushOnce( storage );
            expect( storage.getHealth().status ).to.equal( 'red' );
            const flushesBefore = mockSender.flush.callCount;
            mockSender.flush.resolves( false );

            storage.write( 'monitoring', { ts: NOW, temp: 99 }, 'p1' );
            await clock.tickAsync( 0 );

            const health = storage.getHealth();
            expect( mockSender.flush.callCount ).to.equal( flushesBefore );
            expect( mockSender.reset.calledOnce ).to.equal( true );
            expect( health.status ).to.equal( 'red' );
            expect( health.consecutiveFlushFailures ).to.equal( 2 );
            expect( health.lastFlushAt ).to.equal( null );
        } );

        it( 'the final flush of a shutdown, with connected false from then on', async function () {
            const storage = await makeStorage( { flushRows: 100 } );
            await clock.tickAsync( 10 );

            writeRows( storage, 1 );
            await storage.shutdown();

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'red' );
            expect( health.connected ).to.equal( false );
            expect( health.lastFlushAt ).to.equal( NOW + 10 );
            expect( health.consecutiveFlushFailures ).to.equal( 0 );
        } );

        it( 'but a late result on an abandoned flush changes nothing', async function () {
            let settleFlush = null;
            mockSender.flush.returns( new Promise( ( resolve ) => {
                settleFlush = resolve;
            } ) );
            const storage = await makeStorage( { flushDeadlineMs: 300 } );

            writeRows( storage, 2 );
            await clock.tickAsync( 300 );
            settleFlush( true );
            await clock.tickAsync( 0 );

            const health = storage.getHealth();
            expect( health.status ).to.equal( 'red' );
            expect( health.consecutiveFlushFailures ).to.equal( 1 );
            expect( health.lastFlushAt ).to.equal( null );
        } );
    } );
} );

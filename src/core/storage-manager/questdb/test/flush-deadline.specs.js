// core/storage-manager/questdb/test/flush-deadline.specs.js

/**
 * @fileoverview A deadline on every QuestDB flush (ADR-029).
 *
 * A flush against an unreachable QuestDB can hang without end: the
 * client's retry agent never gives up. Before this change such a flush
 * kept the single-flight guard up for good. Rows collected to the
 * ceiling, every new row was shed, and nothing was reported until
 * shutdown. Now every tracked flush gets one timer. The deadline is
 * derived from the rows the flush carries (`flushDeadlineFor`), or is
 * the fixed `flushDeadlineMs` when the operator set one. A flush past
 * its deadline is abandoned. Its rows leave the in-flight count, the
 * guard is released, the loss is reported once with `abandoned: true`,
 * and `abandonedFlushes` records it. A late result from an abandoned
 * flush changes no counter and prints nothing.
 *
 * The deadline bounds every caller too. An explicit `flush()` rejects
 * at the deadline. The shutdown drain counts an abandoned flush as
 * dropped, so a shutdown with no `{ timeout }` ends at the last
 * deadline instead of waiting for ever.
 *
 * The derived deadline for one row is 25,005 ms: the client's retry
 * window (10,000) plus its request timeout (10,000) plus the transfer
 * time for 512 bytes at 100 KiB a second (5) plus the 5,000 ms margin.
 * The arithmetic is in `resolve-options.js`; the number is pinned here
 * so a change to either side is visible.
 *
 * Every case here was written before the engine changed and proven red
 * against the 2a engine.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createQuestDBStorage } from '../index.js';
import {
    makeMockSender,
    makeMockDeps,
    NEVER_SETTLES,
    ILP_ADDRESS,
    probeOutcomeFor
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

/** The probe finding every failure here carries: the endpoint answers. */
const PROBE_ANSWERS = probeOutcomeFor( ILP_ADDRESS, 'answers' );

/** Writes `count` good rows. */
const writeRows = function ( storage, count ) {
    for ( let i = 0; i < count; i += 1 ) {
        storage.write( 'monitoring', GOOD_MSG, 'p1' );
    }
}; // writeRows()

/** The DELIVERY_FAILED lines a console.error spy captured. */
const deliveryFailedLines = function ( errorSpy ) {
    return errorSpy.getCalls()
        .map( ( call ) => String( call.args[ 0 ] ) )
        .filter( ( line ) => line.includes( '[DELIVERY_FAILED]' ) );
}; // deliveryFailedLines()

describe( 'QuestDB flush deadline (ADR-029)', function () {

    let mockSender;
    let deps;
    let clock;

    const makeStorage = ( options = {} ) => createQuestDBStorage(
        TEST_ASSET_CLASS,
        'pump',
        { ...ADDRESSES, ...options },
        deps
    );

    beforeEach( function () {
        clock = sinon.useFakeTimers();
        mockSender = makeMockSender();
        deps = makeMockDeps( mockSender );
    } );

    afterEach( function () {
        clock.restore();
        sinon.restore();
    } );

    describe( 'health carries the new counters', function () {

        it( 'starts with abandonedFlushes 0 and pausedSince null', async function () {
            const storage = await makeStorage();

            const health = storage.getHealth();
            expect( health.abandonedFlushes ).to.equal( 0 );
            expect( health.pausedSince ).to.equal( null );

            await storage.shutdown();
        } );

    } );

    describe( 'a hung engine flush is abandoned at its deadline', function () {

        it( 'the rows leave the in-flight count and the counter records it', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushIntervalMs: 1000, flushDeadlineMs: 300 } );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await clock.tickAsync( 1000 );
            expect( mockSender.flush.callCount ).to.equal( 1 );
            expect( storage.getHealth().inFlightRows ).to.equal( 1 );

            await clock.tickAsync( 299 );
            expect( storage.getHealth().inFlightRows ).to.equal( 1 );
            expect( storage.getHealth().abandonedFlushes ).to.equal( 0 );

            await clock.tickAsync( 1 );
            expect( storage.getHealth().inFlightRows ).to.equal( 0 );
            expect( storage.getHealth().abandonedFlushes ).to.equal( 1 );
            expect( storage.getPressure() ).to.equal( 0 );

            await storage.shutdown();
        } );

        it( 'the guard is released, so the next tick flushes again', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushIntervalMs: 1000, flushDeadlineMs: 300 } );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await clock.tickAsync( 1300 );
            expect( storage.getHealth().abandonedFlushes ).to.equal( 1 );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await clock.tickAsync( 700 );

            expect( mockSender.flush.callCount ).to.equal( 2 );
            expect( storage.getHealth().inFlightRows ).to.equal( 0 );

            await storage.shutdown();
        } );

        it( 'the derived deadline applies when flushDeadlineMs is unset: one row is abandoned at 25,005 ms', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushIntervalMs: 1000 } );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await clock.tickAsync( 1000 );
            expect( mockSender.flush.callCount ).to.equal( 1 );

            // 10,000 retry + 10,000 request + 5 transfer + 5,000 margin.
            await clock.tickAsync( 25004 );
            expect( storage.getHealth().inFlightRows ).to.equal( 1 );

            await clock.tickAsync( 1 );
            expect( storage.getHealth().inFlightRows ).to.equal( 0 );
            expect( storage.getHealth().abandonedFlushes ).to.equal( 1 );

            await storage.shutdown();
        } );

        it( 'a fixed flushDeadlineMs applies to a row-triggered flush too', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushRows: 2, flushDeadlineMs: 300 } );

            writeRows( storage, 2 );
            expect( mockSender.flush.callCount ).to.equal( 1 );

            await clock.tickAsync( 300 );
            expect( storage.getHealth().abandonedFlushes ).to.equal( 1 );
            expect( storage.getHealth().inFlightRows ).to.equal( 0 );

            await storage.shutdown();
        } );

    } );

    describe( 'an abandoned flush is reported once', function () {

        it( 'to onDeliveryFailure with abandoned true, the exact rows, and the probe finding', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const onDeliveryFailure = sinon.stub();
            const storage = await makeStorage( { flushRows: 2, flushDeadlineMs: 300, onDeliveryFailure } );

            writeRows( storage, 2 );
            await clock.tickAsync( 300 );

            expect( onDeliveryFailure.callCount ).to.equal( 1 );
            const [ err, ctx ] = onDeliveryFailure.firstCall.args;
            expect( err ).to.be.an( 'error' );
            expect( err.code ).to.equal( 'DELIVERY_FAILED' );
            expect( err.message ).to.equal(
                'winkComposer/questdb: flush abandoned, 2 row(s) lost [DELIVERY_FAILED]: no answer within 300 ms'
            );
            expect( ctx ).to.deep.equal( { trigger: 'rows', rowsLost: 2, abandoned: true, probe: PROBE_ANSWERS } );

            await storage.shutdown();
        } );

        it( 'as one classified console line when no handler was given', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const errorSpy = sinon.spy( console, 'error' );
            const storage = await makeStorage( { flushRows: 2, flushDeadlineMs: 300 } );

            writeRows( storage, 2 );
            await clock.tickAsync( 300 );

            const lines = deliveryFailedLines( errorSpy );
            expect( lines ).to.have.lengthOf( 1 );
            expect( lines[ 0 ] ).to.equal(
                'winkComposer/questdb: flush abandoned, 2 row(s) lost [DELIVERY_FAILED]: no answer within 300 ms; ' +
                'probe: 127.0.0.1:9000 answers'
            );

            await storage.shutdown();
        } );

        it( 'a late success after abandonment changes no counter and prints nothing', async function () {
            let release = null;
            mockSender.flush.onFirstCall().returns( new Promise( ( resolve ) => {
                release = resolve;
            } ) );
            const errorSpy = sinon.spy( console, 'error' );
            const onDeliveryFailure = sinon.stub();
            const storage = await makeStorage( { flushRows: 2, flushDeadlineMs: 300, onDeliveryFailure } );

            writeRows( storage, 2 );
            await clock.tickAsync( 300 );
            expect( onDeliveryFailure.callCount ).to.equal( 1 );

            release( true );
            await clock.tickAsync( 0 );

            expect( storage.getHealth().inFlightRows ).to.equal( 0 );
            expect( storage.getHealth().abandonedFlushes ).to.equal( 1 );
            expect( onDeliveryFailure.callCount ).to.equal( 1 );
            expect( deliveryFailedLines( errorSpy ) ).to.have.lengthOf( 0 );

            await storage.shutdown();
        } );

        it( 'a late failure after abandonment is not reported a second time', async function () {
            let fail = null;
            mockSender.flush.onFirstCall().returns( new Promise( ( resolve, reject ) => {
                fail = reject;
            } ) );
            const errorSpy = sinon.spy( console, 'error' );
            const storage = await makeStorage( { flushRows: 2, flushDeadlineMs: 300 } );

            writeRows( storage, 2 );
            await clock.tickAsync( 300 );
            expect( deliveryFailedLines( errorSpy ) ).to.have.lengthOf( 1 );

            fail( new Error( 'late boom' ) );
            await clock.tickAsync( 0 );

            expect( deliveryFailedLines( errorSpy ) ).to.have.lengthOf( 1 );
            expect( storage.getHealth().inFlightRows ).to.equal( 0 );
            expect( storage.getHealth().abandonedFlushes ).to.equal( 1 );

            await storage.shutdown();
        } );

    } );

    describe( 'a flush that settles in time', function () {

        it( 'clears its deadline timer', async function () {
            const storage = await makeStorage( { flushRows: 2, flushDeadlineMs: 300 } );

            writeRows( storage, 2 );
            await clock.tickAsync( 0 );

            // The interval timer is the only timer left.
            expect( clock.countTimers() ).to.equal( 1 );

            await storage.shutdown();
        } );

        it( 'is never abandoned later', async function () {
            const onDeliveryFailure = sinon.stub();
            const storage = await makeStorage( { flushRows: 2, flushDeadlineMs: 300, onDeliveryFailure } );

            writeRows( storage, 2 );
            await clock.tickAsync( 5000 );

            expect( storage.getHealth().abandonedFlushes ).to.equal( 0 );
            expect( onDeliveryFailure.called ).to.equal( false );

            await storage.shutdown();
        } );

    } );

    describe( 'the explicit flush() is bounded too', function () {

        it( 'rejects at the deadline with DELIVERY_FAILED and reports to its caller only', async function () {
            mockSender.flush.returns( NEVER_SETTLES );
            const onDeliveryFailure = sinon.stub();
            const storage = await makeStorage( { flushDeadlineMs: 300, onDeliveryFailure } );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            const outcome = storage.flush().then( () => null, ( err ) => err );
            await clock.tickAsync( 300 );

            const err = await outcome;
            expect( err ).to.be.an( 'error' );
            expect( err.code ).to.equal( 'DELIVERY_FAILED' );
            expect( err.message ).to.include( 'flush abandoned, 1 row(s) lost' );
            expect( onDeliveryFailure.called ).to.equal( false );
            expect( storage.getHealth().abandonedFlushes ).to.equal( 1 );
            expect( storage.getHealth().inFlightRows ).to.equal( 0 );

            await storage.shutdown();
        } );

    } );

    describe( 'shutdown counts an abandoned flush as dropped', function () {

        it( 'with no timeout, the drain ends at the deadline with DELIVERY_FAILED', async function () {
            mockSender.flush.returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushDeadlineMs: 300 } );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            let settled = false;
            const outcome = storage.shutdown().then( () => null, ( err ) => err ).then( ( value ) => {
                settled = true;
                return value;
            } );

            await clock.tickAsync( 299 );
            expect( settled ).to.equal( false );

            await clock.tickAsync( 1 );
            const err = await outcome;
            expect( err ).to.be.an( 'error' );
            expect( err.code ).to.equal( 'DELIVERY_FAILED' );
            expect( err.dropped ).to.deep.equal( { count: 1 } );
            expect( err.cause.message ).to.include( 'flush abandoned, 1 row(s) lost' );
        } );

        it( 'with a timeout longer than the deadline, DELIVERY_FAILED still wins', async function () {
            mockSender.flush.returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushDeadlineMs: 300 } );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            const outcome = storage.shutdown( { timeout: 10000 } ).then( () => null, ( err ) => err );
            await clock.tickAsync( 300 );

            const err = await outcome;
            expect( err.code ).to.equal( 'DELIVERY_FAILED' );
            expect( err.dropped ).to.deep.equal( { count: 1 } );
        } );

        it( 'a flush abandoned before shutdown is not counted twice', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const onDeliveryFailure = sinon.stub();
            const storage = await makeStorage( { flushRows: 2, flushDeadlineMs: 300, onDeliveryFailure } );

            writeRows( storage, 2 );
            await clock.tickAsync( 300 );
            expect( onDeliveryFailure.callCount ).to.equal( 1 );

            // Nothing is buffered and the abandoned flush is already
            // reported, so shutdown owes nothing and resolves clean.
            const outcome = storage.shutdown( { timeout: 10 } ).then( () => 'clean', ( err ) => err );
            await clock.tickAsync( 10 );

            expect( await outcome ).to.equal( 'clean' );
        } );

        it( 'an engine flush abandoned during the drain is reported by shutdown alone', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const onDeliveryFailure = sinon.stub();
            const storage = await makeStorage( { flushRows: 2, flushDeadlineMs: 300, onDeliveryFailure } );

            writeRows( storage, 2 );
            const outcome = storage.shutdown( { timeout: 10000 } ).then( () => null, ( err ) => err );
            await clock.tickAsync( 300 );

            const err = await outcome;
            expect( err.code ).to.equal( 'DELIVERY_FAILED' );
            expect( err.dropped ).to.deep.equal( { count: 2 } );
            expect( onDeliveryFailure.called, 'shutdown owns a loss during the drain' ).to.equal( false );
        } );

    } );

    describe( 'cost', function () {

        it( 'one timer per flush and none per row', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushRows: 10 } );

            writeRows( storage, 9 );
            expect( clock.countTimers(), 'only the interval timer before the flush' ).to.equal( 1 );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            expect( clock.countTimers(), 'the interval timer plus one deadline' ).to.equal( 2 );

            const shutdownPromise = storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
            await shutdownPromise;
        } );

    } );

} );

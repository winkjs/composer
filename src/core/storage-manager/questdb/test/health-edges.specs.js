// core/storage-manager/questdb/test/health-edges.specs.js

/**
 * @fileoverview Health edges log once each (ADR-029).
 *
 * Before this change the delivery ladder that `getHealth()` reads
 * changed state in silence whenever the flow gave an
 * `onDeliveryFailure` handler. Yellow on the first failed flush, red on
 * the second or on an abandonment, and green when a flush landed again
 * printed nothing. Shedding at the ceiling printed nothing from the
 * adapter. The pause and the resume were the only edges that printed,
 * and the resume printed at info, below the floor a remote log
 * transport keeps.
 *
 * Now every change of delivery state prints one line through the
 * logger facade, whether or not the flow gave a handler. Four rules
 * bound the noise. Log the change, never the state. Never a line per
 * flush or per tick, however long an outage lasts. Log with or without
 * a handler, because the callback serves programs and the line serves
 * people. Derive the state with one function, `deliveryStateOf`, used
 * by the edge detector and by `getHealth()`, so the two never disagree.
 *
 * The lines, in the ADR-028 grammar:
 * - degraded (warn), red (error), restored (warn) carry the token
 *   `DELIVERY_HEALTH`; the restored line names the episode length and
 *   the rows reported lost in it;
 * - the pause is a red edge (added 2026-09-10, from the RevPi gate):
 *   `getHealth()` reads red the moment delivery pauses, so the red
 *   line prints there, before the `CIRCUIT_OPEN` line, and a later
 *   failed flush adds no second red line; the resume prints no ladder
 *   line, because the ladder only steps down until a flush lands;
 * - shedding began and shedding ended (warn) carry `STORAGE_FULL`, the
 *   code the refused write returns; the ended line names the count;
 * - the resume line keeps `CIRCUIT_OPEN` and rises to warn.
 *
 * The clock is fake, so every "after N s" has a value the spec can
 * name. Every case here was written before the engine changed and
 * proven red against the engine that read the ladder in silence.
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

/** A fixed wall clock, so every duration has a value the spec can name. */
const NOW = 1735500000000;

const DEGRADED_LINE = 'winkComposer/questdb: delivery degraded, 1 flush failed [DELIVERY_HEALTH]: disk full';
const RED_LINE = 'winkComposer/questdb: delivery red after 2 failed flush(es) [DELIVERY_HEALTH]: disk full';
const PAUSED_RED_LINE = 'winkComposer/questdb: delivery red, paused after 1 failed flush(es) [DELIVERY_HEALTH]: 127.0.0.1:9000 refused';

/** Writes `count` good rows and returns the results. */
const writeRows = function ( storage, count ) {
    const results = [];
    for ( let i = 0; i < count; i += 1 ) {
        results.push( storage.write( 'monitoring', GOOD_MSG, 'p1' ) );
    }
    return results;
}; // writeRows()

/** The lines a console spy captured that carry the given token. */
const linesWith = function ( spy, token ) {
    return spy.getCalls()
        .map( ( call ) => String( call.args[ 0 ] ) )
        .filter( ( line ) => line.includes( token ) );
}; // linesWith()

/** The first spy call whose line carries the given text. */
const callWith = function ( spy, text ) {
    return spy.getCalls().find( ( call ) => String( call.args[ 0 ] ).includes( text ) );
}; // callWith()

/** A flush promise the spec settles by hand, to model a flush that hangs. */
const settleable = function () {
    let settle = null;
    const promise = new Promise( ( resolve ) => {
        settle = resolve;
    } );
    return { promise, settle };
}; // settleable()

describe( 'QuestDB health edges (ADR-029)', function () {

    let mockSender;
    let deps;
    let probe;
    let clock;
    let warnSpy;
    let errorSpy;
    let logSpy;

    const makeStorage = ( options = {} ) => createQuestDBStorage(
        TEST_ASSET_CLASS,
        'pump',
        { ...ADDRESSES, flushRows: 2, flushIntervalMs: 1000, onDeliveryFailure: sinon.stub(), ...options },
        deps
    );

    /** The same storage with no handler, so the per-flush loss lines print too. */
    const makeStorageNoHandler = ( options = {} ) => createQuestDBStorage(
        TEST_ASSET_CLASS,
        'pump',
        { ...ADDRESSES, flushRows: 2, flushIntervalMs: 1000, ...options },
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
        warnSpy = sinon.spy( console, 'warn' );
        errorSpy = sinon.spy( console, 'error' );
        logSpy = sinon.spy( console, 'log' );
    } );

    afterEach( function () {
        clock.restore();
        sinon.restore();
    } );

    describe( 'the delivery ladder', function () {

        it( 'fail, fail, land: degraded, red, restored, each once and in that order', async function () {
            const onDeliveryFailure = sinon.stub();
            mockSender.flush.onCall( 0 ).rejects( new Error( 'disk full' ) );
            mockSender.flush.onCall( 1 ).rejects( new Error( 'disk full' ) );
            mockSender.flush.onCall( 2 ).resolves( false );
            const storage = await makeStorage( { onDeliveryFailure } );

            await flushOnce( storage );
            await clock.tickAsync( 2000 );
            await flushOnce( storage );
            await clock.tickAsync( 3000 );
            await flushOnce( storage );

            expect( linesWith( warnSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [
                DEGRADED_LINE,
                'winkComposer/questdb: delivery restored after 5 s, 4 row(s) reported lost meanwhile [DELIVERY_HEALTH]'
            ] );
            expect( linesWith( errorSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [ RED_LINE ] );

            const degraded = callWith( warnSpy, 'delivery degraded' );
            const red = callWith( errorSpy, 'delivery red' );
            const restored = callWith( warnSpy, 'delivery restored' );
            expect( degraded.calledBefore( red ) ).to.equal( true );
            expect( red.calledBefore( restored ) ).to.equal( true );

            // The handler still hears every lost flush; the lines are for people.
            expect( onDeliveryFailure.callCount ).to.equal( 2 );

            await storage.shutdown();
        } );

        it( 'abandon, land: red then restored, and no degraded line', async function () {
            mockSender.flush.onCall( 0 ).returns( NEVER_SETTLES );
            mockSender.flush.onCall( 1 ).resolves( false );
            const storage = await makeStorage( { flushDeadlineMs: 300 } );

            writeRows( storage, 2 );
            await clock.tickAsync( 300 );
            await clock.tickAsync( 700 );
            await flushOnce( storage );

            expect( linesWith( errorSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [
                'winkComposer/questdb: delivery red after 1 failed flush(es) [DELIVERY_HEALTH]: ' +
                'winkComposer/questdb: flush abandoned, 2 row(s) lost [DELIVERY_FAILED]: no answer within 300 ms'
            ] );
            expect( linesWith( warnSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [
                'winkComposer/questdb: delivery restored after 1 s, 2 row(s) reported lost meanwhile [DELIVERY_HEALTH]'
            ] );

            await storage.shutdown();
        } );

        it( 'fail, land: degraded then restored, never red', async function () {
            mockSender.flush.onCall( 0 ).rejects( new Error( 'disk full' ) );
            mockSender.flush.onCall( 1 ).resolves( false );
            const storage = await makeStorage();

            await flushOnce( storage );
            await clock.tickAsync( 1000 );
            await flushOnce( storage );

            expect( linesWith( warnSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [
                DEGRADED_LINE,
                'winkComposer/questdb: delivery restored after 1 s, 2 row(s) reported lost meanwhile [DELIVERY_HEALTH]'
            ] );
            expect( linesWith( errorSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [] );

            await storage.shutdown();
        } );

        it( 'five failures in a row print one degraded line and one red line, and ticks add nothing', async function () {
            mockSender.flush.rejects( new Error( 'disk full' ) );
            const storage = await makeStorage();

            for ( let i = 0; i < 5; i += 1 ) {
                await flushOnce( storage ); // eslint-disable-line no-await-in-loop
            }
            await clock.tickAsync( 5000 );

            expect( storage.getHealth().consecutiveFlushFailures ).to.equal( 5 );
            expect( linesWith( warnSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [ DEGRADED_LINE ] );
            expect( linesWith( errorSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [ RED_LINE ] );

            await storage.shutdown().catch( () => undefined );
        } );

        it( 'without a handler, the per-flush loss lines and the edge lines both print', async function () {
            mockSender.flush.rejects( new Error( 'disk full' ) );
            const storage = await makeStorageNoHandler();

            await flushOnce( storage );
            await flushOnce( storage );

            expect( linesWith( errorSpy, '[DELIVERY_FAILED]' ) ).to.have.lengthOf( 2 );
            expect( linesWith( errorSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [ RED_LINE ] );
            expect( linesWith( warnSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [ DEGRADED_LINE ] );

            await storage.shutdown().catch( () => undefined );
        } );

        it( 'the failed final flush of a shutdown prints the red line beside the rejection', async function () {
            mockSender.flush.rejects( new Error( 'disk full' ) );
            const storage = await makeStorage( { flushRows: 100 } );

            writeRows( storage, 1 );
            await storage.flush().catch( () => undefined );
            writeRows( storage, 1 );
            const err = await storage.shutdown().then( () => null, ( e ) => e );

            expect( err.code ).to.equal( 'DELIVERY_FAILED' );
            expect( linesWith( warnSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [ DEGRADED_LINE ] );
            expect( linesWith( errorSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [ RED_LINE ] );
        } );
    } );

    describe( 'shedding', function () {

        /**
         * Fills the adapter to a ceiling of 4 with one hung flush of 2
         * rows and 2 buffered rows, then refuses `refused` more.
         */
        const fillAndRefuse = async function ( storage, refused ) {
            writeRows( storage, 2 );
            writeRows( storage, 2 );
            const results = writeRows( storage, refused );
            await clock.tickAsync( 0 );
            return results;
        }; // fillAndRefuse()

        it( 'one line when shedding begins, one when the buffer has room again, with the exact count', async function () {
            const first = settleable();
            mockSender.flush.onCall( 0 ).returns( first.promise );
            mockSender.flush.onCall( 1 ).resolves( false );
            const storage = await makeStorage( { bufferCeilingRows: 4, flushDeadlineMs: 60000 } );

            const results = await fillAndRefuse( storage, 3 );

            expect( results.map( ( r ) => r.error.code ) ).to.deep.equal( [ 'STORAGE_FULL', 'STORAGE_FULL', 'STORAGE_FULL' ] );
            expect( linesWith( warnSpy, '[STORAGE_FULL]' ) ).to.deep.equal( [
                'winkComposer/questdb: shedding began at the ceiling of 4 rows [STORAGE_FULL]: new rows are refused until the endpoint takes them'
            ] );

            first.settle( true );
            await clock.tickAsync( 0 );
            await clock.tickAsync( 1000 );

            expect( linesWith( warnSpy, '[STORAGE_FULL]' ) ).to.have.lengthOf( 2 );
            expect( linesWith( warnSpy, '[STORAGE_FULL]' )[ 1 ] ).to.equal(
                'winkComposer/questdb: shedding ended, 3 row(s) refused [STORAGE_FULL]: the buffer has room again'
            );

            await clock.tickAsync( 1000 );
            expect( linesWith( warnSpy, '[STORAGE_FULL]' ) ).to.have.lengthOf( 2 );

            await storage.shutdown();
        } );

        it( 'the tick prints nothing while shedding continues', async function () {
            const first = settleable();
            mockSender.flush.onCall( 0 ).returns( first.promise );
            mockSender.flush.onCall( 1 ).resolves( false );
            const storage = await makeStorage( { bufferCeilingRows: 4, flushDeadlineMs: 60000 } );

            await fillAndRefuse( storage, 1 );
            await clock.tickAsync( 1000 );
            await clock.tickAsync( 1000 );
            writeRows( storage, 2 );

            expect( linesWith( warnSpy, '[STORAGE_FULL]' ) ).to.have.lengthOf( 1 );

            first.settle( true );
            await clock.tickAsync( 0 );
            await clock.tickAsync( 1000 );

            expect( linesWith( warnSpy, '[STORAGE_FULL]' )[ 1 ] ).to.equal(
                'winkComposer/questdb: shedding ended, 3 row(s) refused [STORAGE_FULL]: the buffer has room again'
            );

            await storage.shutdown();
        } );

        it( 'a second episode prints a second pair', async function () {
            const first = settleable();
            const third = settleable();
            mockSender.flush.onCall( 0 ).returns( first.promise );
            mockSender.flush.onCall( 1 ).resolves( false );
            mockSender.flush.onCall( 2 ).returns( third.promise );
            mockSender.flush.onCall( 3 ).resolves( false );
            const storage = await makeStorage( { bufferCeilingRows: 4, flushDeadlineMs: 60000 } );

            await fillAndRefuse( storage, 2 );
            first.settle( true );
            await clock.tickAsync( 0 );
            await clock.tickAsync( 1000 );

            await fillAndRefuse( storage, 1 );
            third.settle( true );
            await clock.tickAsync( 0 );
            await clock.tickAsync( 1000 );

            expect( linesWith( warnSpy, '[STORAGE_FULL]' ) ).to.deep.equal( [
                'winkComposer/questdb: shedding began at the ceiling of 4 rows [STORAGE_FULL]: new rows are refused until the endpoint takes them',
                'winkComposer/questdb: shedding ended, 2 row(s) refused [STORAGE_FULL]: the buffer has room again',
                'winkComposer/questdb: shedding began at the ceiling of 4 rows [STORAGE_FULL]: new rows are refused until the endpoint takes them',
                'winkComposer/questdb: shedding ended, 1 row(s) refused [STORAGE_FULL]: the buffer has room again'
            ] );

            await storage.shutdown();
        } );
    } );

    describe( 'the resume line', function () {

        it( 'prints at warn, and a whole outage reads degraded, paused, resumed, restored', async function () {
            mockSender.flush.onCall( 0 ).rejects( new Error( 'disk full' ) );
            mockSender.flush.onCall( 1 ).resolves( false );
            const storage = await makeStorage();
            probe.setResult( 'refused' );

            writeRows( storage, 2 );
            writeRows( storage, 3 );
            await clock.tickAsync( 0 );
            probe.setResult( 'answers' );
            await clock.tickAsync( 1000 );

            const lines = linesWith( warnSpy, 'winkComposer/questdb' );
            expect( lines ).to.have.lengthOf( 4 );
            expect( lines[ 0 ] ).to.equal( DEGRADED_LINE );
            expect( lines[ 1 ] ).to.include( 'delivery paused, 3 row(s) held [CIRCUIT_OPEN]' );
            expect( lines[ 2 ] ).to.equal(
                'winkComposer/questdb: delivery resumed after 1 s, 3 row(s) held [CIRCUIT_OPEN]: 127.0.0.1:9000 answers'
            );
            expect( lines[ 3 ] ).to.equal(
                'winkComposer/questdb: delivery restored after 1 s, 2 row(s) reported lost meanwhile [DELIVERY_HEALTH]'
            );
            expect( linesWith( logSpy, '[CIRCUIT_OPEN]' ) ).to.deep.equal( [] );

            // The pause is the red edge: `getHealth()` reads red the moment
            // delivery pauses, so the ladder prints its red line there, once,
            // before the pause line. (Surfaced 2026-09-10 on the RevPi rig:
            // the red line waited for a second failed flush that a paused
            // delivery never starts, so the log stayed at "degraded" while
            // health read red.)
            expect( linesWith( errorSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [ PAUSED_RED_LINE ] );
            const red = callWith( errorSpy, 'delivery red' );
            expect( callWith( warnSpy, 'delivery degraded' ).calledBefore( red ) ).to.equal( true );
            expect( red.calledBefore( callWith( warnSpy, 'delivery paused' ) ) ).to.equal( true );

            await storage.shutdown();
        } );

        it( 'a shutdown while paused prints no second red line', async function () {
            mockSender.flush.rejects( new Error( 'disk full' ) );
            const storage = await makeStorage();
            probe.setResult( 'refused' );

            await flushOnce( storage );
            writeRows( storage, 1 );
            const err = await storage.shutdown().then( () => null, ( e ) => e );

            expect( err.code ).to.equal( 'DELIVERY_FAILED' );
            expect( linesWith( warnSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [ DEGRADED_LINE ] );
            expect( linesWith( errorSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [ PAUSED_RED_LINE ] );
        } );

        it( 'a shutdown while paused whose drain lands prints one restored line beside the clean stop', async function () {
            mockSender.flush.onCall( 0 ).rejects( new Error( 'disk full' ) );
            mockSender.flush.onCall( 1 ).resolves( false );
            const storage = await makeStorage();
            probe.setResult( 'refused' );

            await flushOnce( storage );
            writeRows( storage, 1 );
            await storage.shutdown();

            // The gate never resumes at shutdown, so the landing itself
            // clears the pause mirror, once, and the episode closes.
            expect( linesWith( warnSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [
                DEGRADED_LINE,
                'winkComposer/questdb: delivery restored after 0 s, 2 row(s) reported lost meanwhile [DELIVERY_HEALTH]'
            ] );
            expect( linesWith( errorSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [ PAUSED_RED_LINE ] );
            expect( storage.getHealth().pausedSince ).to.equal( null );
        } );
    } );

    describe( 'a landing while paused', function () {

        // While the gate runs, only its resume clears the pause mirror.
        // An explicit flush can land during a pause, and the ladder must
        // stay red until the probe passes, because the gate still holds
        // new rows. (Found by the fresh-eyes review of 2026-09-11: the
        // first cut cleared the mirror on every landing, so health read
        // green and connected while the gate was still paused.)
        it( 'an explicit flush that lands while paused keeps red until the resume, which then prints restored', async function () {
            mockSender.flush.onCall( 0 ).rejects( new Error( 'disk full' ) );
            mockSender.flush.onCall( 1 ).resolves( false );
            const storage = await makeStorage();
            probe.setResult( 'refused' );

            await flushOnce( storage );
            expect( storage.getHealth().status ).to.equal( 'red' );

            // The endpoint is back, but no probe has run yet. A caller
            // flushes one held row by hand, and it lands.
            writeRows( storage, 1 );
            await storage.flush();
            const health = storage.getHealth();
            expect( health.status ).to.equal( 'red' );
            expect( health.connected ).to.equal( false );
            expect( health.consecutiveFlushFailures ).to.equal( 0 );
            expect( health.pausedSince ).to.equal( NOW );
            expect( linesWith( warnSpy, 'delivery restored' ) ).to.deep.equal( [] );

            // The tick probe passes: resumed, then restored, and green.
            probe.setResult( 'answers' );
            await clock.tickAsync( 1000 );

            expect( linesWith( warnSpy, 'winkComposer/questdb' ) ).to.deep.equal( [
                DEGRADED_LINE,
                'winkComposer/questdb: delivery paused, 0 row(s) held [CIRCUIT_OPEN]: 127.0.0.1:9000 refused',
                'winkComposer/questdb: delivery resumed after 1 s, 0 row(s) held [CIRCUIT_OPEN]: 127.0.0.1:9000 answers',
                'winkComposer/questdb: delivery restored after 1 s, 2 row(s) reported lost meanwhile [DELIVERY_HEALTH]'
            ] );
            expect( linesWith( errorSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [ PAUSED_RED_LINE ] );
            const after = storage.getHealth();
            expect( after.status ).to.equal( 'green' );
            expect( after.connected ).to.equal( true );
            expect( after.pausedSince ).to.equal( null );

            await storage.shutdown();
        } );

        it( 'a pause that follows a landing starts the episode at the pause, so the restored line reads its true length', async function () {
            mockSender.flush.onCall( 0 ).rejects( new Error( 'disk full' ) );
            mockSender.flush.onCall( 1 ).resolves( false );
            const storage = await makeStorage();
            probe.hang();

            // The failed flush starts a probe that hangs. A flush by hand
            // lands meanwhile, so the ladder returns to green before the
            // probe reports. Then the probe fails and the gate pauses.
            await flushOnce( storage );
            writeRows( storage, 2 );
            await storage.flush();
            expect( storage.getHealth().status ).to.equal( 'green' );
            probe.release( 'refused' );
            await clock.tickAsync( 0 );
            expect( storage.getHealth().status ).to.equal( 'red' );

            probe.setResult( 'answers' );
            await clock.tickAsync( 1000 );

            expect( linesWith( errorSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [
                'winkComposer/questdb: delivery red, paused after 0 failed flush(es) [DELIVERY_HEALTH]: 127.0.0.1:9000 refused'
            ] );
            expect( linesWith( warnSpy, '[DELIVERY_HEALTH]' ) ).to.deep.equal( [
                DEGRADED_LINE,
                'winkComposer/questdb: delivery restored after 0 s, 2 row(s) reported lost meanwhile [DELIVERY_HEALTH]',
                'winkComposer/questdb: delivery restored after 1 s, 0 row(s) reported lost meanwhile [DELIVERY_HEALTH]'
            ] );
            expect( storage.getHealth().status ).to.equal( 'green' );

            await storage.shutdown();
        } );
    } );

    describe( 'deliveryStateOf', function () {

        it( 'is exported by the tracker and reads every ledger shape the ladder names', async function () {
            const { deliveryStateOf } = await import( '../flush-tracker.js' );

            expect( deliveryStateOf ).to.be.a( 'function' );
            expect( deliveryStateOf( { consecutiveFlushFailures: 0, lastFlushError: null } ) ).to.equal( 'green' );
            expect( deliveryStateOf( { consecutiveFlushFailures: 0, lastFlushError: { abandoned: true } } ) ).to.equal( 'green' );
            expect( deliveryStateOf( { consecutiveFlushFailures: 1, lastFlushError: { abandoned: false } } ) ).to.equal( 'yellow' );
            expect( deliveryStateOf( { consecutiveFlushFailures: 1, lastFlushError: { abandoned: true } } ) ).to.equal( 'red' );
            expect( deliveryStateOf( { consecutiveFlushFailures: 2, lastFlushError: { abandoned: false } } ) ).to.equal( 'red' );
            // A paused delivery is red whatever the failure count says.
            expect( deliveryStateOf( { consecutiveFlushFailures: 1, lastFlushError: { abandoned: false }, pausedSince: NOW } ) ).to.equal( 'red' );
            expect( deliveryStateOf( { consecutiveFlushFailures: 1, lastFlushError: { abandoned: false }, pausedSince: null } ) ).to.equal( 'yellow' );
        } );

        it( 'agrees with getHealth() at fail, pause, resume, land', async function () {
            const { deliveryStateOf } = await import( '../flush-tracker.js' );
            mockSender.flush.onCall( 0 ).rejects( new Error( 'disk full' ) );
            mockSender.flush.onCall( 1 ).resolves( false );
            const storage = await makeStorage();
            probe.setResult( 'refused' );
            const seen = [];
            const read = function () {
                const health = storage.getHealth();
                seen.push( [ deliveryStateOf( health ), health.status, health.connected ] );
            };

            await flushOnce( storage );
            read();
            probe.setResult( 'answers' );
            await clock.tickAsync( 1000 );
            // Nothing was held, so the resume starts no catch-up flush. The
            // ladder steps down to yellow: one failure stays on the ledger
            // until a flush lands.
            read();
            await flushOnce( storage );
            read();

            expect( seen ).to.deep.equal( [
                [ 'red', 'red', false ],
                [ 'yellow', 'yellow', true ],
                [ 'green', 'green', true ]
            ] );

            await storage.shutdown();
        } );

        it( 'agrees with getHealth() at every step of fail, fail, land', async function () {
            const { deliveryStateOf } = await import( '../flush-tracker.js' );
            mockSender.flush.onCall( 0 ).rejects( new Error( 'disk full' ) );
            mockSender.flush.onCall( 1 ).rejects( new Error( 'disk full' ) );
            mockSender.flush.onCall( 2 ).resolves( false );
            const storage = await makeStorage();
            const seen = [];

            for ( let i = 0; i < 3; i += 1 ) {
                await flushOnce( storage ); // eslint-disable-line no-await-in-loop
                const health = storage.getHealth();
                seen.push( [ deliveryStateOf( health ), health.status, health.connected ] );
            }

            expect( seen ).to.deep.equal( [
                [ 'yellow', 'yellow', true ],
                [ 'red', 'red', false ],
                [ 'green', 'green', true ]
            ] );

            await storage.shutdown();
        } );
    } );
} );

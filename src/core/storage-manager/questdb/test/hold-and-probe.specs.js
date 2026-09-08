// core/storage-manager/questdb/test/hold-and-probe.specs.js

/**
 * @fileoverview Hold and probe: the QuestDB adapter stops sending into
 * a dead endpoint (ADR-029, amendment of 2026-09-05).
 *
 * Before this change a QuestDB restart of 30 seconds cost every row
 * written during it. Each interval tick started a flush into the dead
 * endpoint, each flush failed or hung, and each failure lost its
 * batch. Now a failed or abandoned engine flush runs the ADR-030 probe
 * against `ilpUrl`, once, off the hot path. The probe is one TCP
 * connect per resolved address. Its finding travels with the loss
 * report, so an operator reads which address refused and which
 * answered.
 *
 * A failing probe pauses delivery. No engine flush starts, rows
 * collect in the client's buffer up to the ceiling, and each interval
 * tick runs one probe. One `CIRCUIT_OPEN` warn line prints on pause
 * with the held row count. Health reads red and not connected, with
 * `pausedSince`. When a tick probe passes, one info line prints and
 * one flush carries everything held. A restart then costs only the
 * batch that was on the wire when the port closed.
 *
 * A passing probe changes nothing: the failure was one the server
 * answered, such as a full disk, and the flush is reported as before.
 * The probe runs on every failed engine flush while not paused, so an
 * endpoint that dies in the middle of a failure streak is caught at
 * the next failure. An explicit `flush()` owns its own error and does
 * not probe. A failure while paused is reported without a new probe,
 * because the tick already probes.
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
    probeOutcomeFor,
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

/** A fixed wall clock, so `pausedSince` has a value the spec can name. */
const NOW = 1735500000000;

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

describe( 'QuestDB hold and probe (ADR-029)', function () {

    let mockSender;
    let deps;
    let probe;
    let clock;

    const makeStorage = ( options = {} ) => createQuestDBStorage(
        TEST_ASSET_CLASS,
        'pump',
        { ...ADDRESSES, ...options },
        deps
    );

    /**
     * Builds a storage with `flushRows: 2`, fails its first flush, and
     * lets the probe report `probeResult`. Two rows are lost. Then
     * `held` more rows are written, so they sit in the buffer.
     */
    const failFirstFlush = async function ( probeResult, held, options = {} ) {
        mockSender.flush.onFirstCall().rejects( new Error( 'ECONNREFUSED' ) );
        const storage = await makeStorage( { flushRows: 2, flushIntervalMs: 1000, ...options } );
        // Set after setup, so the factory's own setup probes pass.
        probe.setResult( probeResult );

        writeRows( storage, 2 );
        writeRows( storage, held );
        await clock.tickAsync( 0 );
        return storage;
    }; // failFirstFlush()

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

    describe( 'the gate survives a probe outcome its describer cannot read', function () {

        // The gate must not depend on the probe's own robustness. A
        // probe that returns a shape the describer cannot read would
        // otherwise reject the chain. The guard would then stay held
        // for ever, with no report (fresh-eyes review, 2026-09-08).

        it( 'reports the loss with a fallback finding, pauses, and the guard is free for the resume', async function () {
            // The two setup probes pass. The engine's first probe returns
            // an unreadable shape. Every later probe passes again.
            let calls = 0;
            deps.probeFn = function ( address ) {
                calls += 1;
                return Promise.resolve( ( calls === 3 ) ? {} : probeOutcomeFor( address, 'answers' ) );
            };
            mockSender.flush.onFirstCall().rejects( new Error( 'ECONNREFUSED' ) );
            const onDeliveryFailure = sinon.stub();
            const warnSpy = sinon.spy( console, 'warn' );
            const storage = await makeStorage( { flushRows: 2, flushIntervalMs: 1000, onDeliveryFailure } );

            writeRows( storage, 2 );
            writeRows( storage, 1 );
            await clock.tickAsync( 0 );

            expect( onDeliveryFailure.callCount, 'the loss is reported once' ).to.equal( 1 );
            expect( onDeliveryFailure.firstCall.args[ 1 ].probe ).to.deep.equal( {} );
            expect( storage.getHealth().pausedSince, 'an unreadable outcome pauses' ).to.equal( NOW );
            const pauseLines = linesWith( warnSpy, '[CIRCUIT_OPEN]' );
            expect( pauseLines ).to.have.lengthOf( 1 );
            expect( pauseLines[ 0 ] ).to.include( 'the probe\'s description failed: ' );

            // The tick probes again, the probe passes, and the held row
            // flushes: the guard was released, not held for ever.
            await clock.tickAsync( 1000 );
            expect( calls ).to.equal( 4 );
            expect( storage.getHealth().pausedSince ).to.equal( null );
            expect( mockSender.flush.callCount, 'the resume flush started' ).to.equal( 2 );

            await storage.shutdown();
        } );

    } );

    describe( 'a failed engine flush runs the probe', function () {

        it( 'once per failed flush, against the ILP endpoint', async function () {
            mockSender.flush.rejects( new Error( 'boom' ) );
            const storage = await makeStorage( { flushRows: 2, onDeliveryFailure: sinon.stub() } );

            writeRows( storage, 2 );
            await clock.tickAsync( 0 );
            expect( probe.engineCalls() ).to.equal( 1 );
            expect( probe.probeFn.lastCall.args[ 0 ] ).to.include( { host: '127.0.0.1', port: 9000 } );

            writeRows( storage, 2 );
            await clock.tickAsync( 0 );
            expect( probe.engineCalls() ).to.equal( 2 );

            await storage.shutdown();
        } );

        it( 'a passing probe changes nothing, and the report carries the finding', async function () {
            const onDeliveryFailure = sinon.stub();
            const storage = await failFirstFlush( 'answers', 0, { onDeliveryFailure } );

            expect( onDeliveryFailure.callCount ).to.equal( 1 );
            const [ err, ctx ] = onDeliveryFailure.firstCall.args;
            expect( err.message ).to.equal( 'ECONNREFUSED' );
            expect( ctx ).to.deep.equal( {
                trigger: 'rows', rowsLost: 2, abandoned: false, probe: probeOutcomeFor( ILP_ADDRESS, 'answers' )
            } );

            const health = storage.getHealth();
            expect( health.connected ).to.equal( true );
            expect( health.pausedSince ).to.equal( null );

            writeRows( storage, 2 );
            expect( mockSender.flush.callCount, 'delivery goes on' ).to.equal( 2 );

            await storage.shutdown();
        } );

        it( 'the console line ends with the finding when no handler was given', async function () {
            const errorSpy = sinon.spy( console, 'error' );
            const storage = await failFirstFlush( 'answers', 0 );

            const lines = linesWith( errorSpy, '[DELIVERY_FAILED]' );
            expect( lines ).to.have.lengthOf( 1 );
            expect( lines[ 0 ] ).to.equal(
                'winkComposer/questdb: flush failed, 2 row(s) lost [DELIVERY_FAILED]: ECONNREFUSED; ' +
                'probe: 127.0.0.1:9000 answers'
            );

            await storage.shutdown();
        } );

        it( 'no new engine flush starts while the probe runs', async function () {
            mockSender.flush.onFirstCall().rejects( new Error( 'boom' ) );
            const storage = await makeStorage( { flushRows: 2, onDeliveryFailure: sinon.stub() } );
            probe.hang();

            writeRows( storage, 2 );
            await clock.tickAsync( 0 );
            expect( probe.engineCalls() ).to.equal( 1 );

            writeRows( storage, 4 );
            await clock.tickAsync( 1000 );
            expect( mockSender.flush.callCount, 'the guard holds until the probe answers' ).to.equal( 1 );
            expect( storage.getHealth().bufferedRows ).to.equal( 4 );

            probe.release( 'answers' );
            await clock.tickAsync( 0 );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            expect( mockSender.flush.callCount ).to.equal( 2 );
            expect( storage.getHealth().inFlightRows ).to.equal( 5 );

            await storage.shutdown();
        } );

        it( 'a flush that fails while a probe runs is reported without a second probe', async function () {
            const onDeliveryFailure = sinon.stub();
            mockSender.flush.onFirstCall().rejects( new Error( 'boom' ) );
            const storage = await makeStorage( { flushRows: 2, onDeliveryFailure } );
            probe.hang();

            writeRows( storage, 2 );
            await clock.tickAsync( 0 );
            expect( probe.engineCalls() ).to.equal( 1 );

            // A mid-row throw starts the recovery flush, which fails while
            // the first failure's probe is still running. Nothing was
            // buffered, so it carries no rows.
            mockSender.at.onCall( mockSender.at.callCount ).throws( new Error( 'mid-row' ) );
            mockSender.flush.onSecondCall().rejects( new Error( 'boom again' ) );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await clock.tickAsync( 0 );

            expect( onDeliveryFailure.callCount ).to.equal( 1 );
            expect( onDeliveryFailure.firstCall.args[ 1 ] ).to.deep.equal( {
                trigger: 'recovery', rowsLost: 0, abandoned: false, probe: null
            } );
            expect( probe.engineCalls(), 'one probe at a time' ).to.equal( 1 );

            probe.release( 'answers' );
            await clock.tickAsync( 0 );
            expect( onDeliveryFailure.callCount ).to.equal( 2 );
            expect( onDeliveryFailure.secondCall.args[ 1 ].trigger ).to.equal( 'rows' );

            await storage.shutdown();
        } );

        it( 'a rejecting probe counts as a failed probe', async function () {
            const warnSpy = sinon.spy( console, 'warn' );
            mockSender.flush.onFirstCall().rejects( new Error( 'boom' ) );
            const storage = await makeStorage( { flushRows: 2, onDeliveryFailure: sinon.stub() } );
            probe.rejectWith( new Error( 'probe boom' ) );

            writeRows( storage, 2 );
            await clock.tickAsync( 0 );

            const lines = linesWith( warnSpy, '[CIRCUIT_OPEN]' );
            expect( lines ).to.have.lengthOf( 1 );
            expect( lines[ 0 ] ).to.include( '[CIRCUIT_OPEN]: the probe itself failed: probe boom' );
            expect( storage.getHealth().connected ).to.equal( false );

            await storage.shutdown();
        } );

    } );

    describe( 'a failing probe pauses delivery', function () {

        it( 'one CIRCUIT_OPEN warn line names the held rows and the finding', async function () {
            const warnSpy = sinon.spy( console, 'warn' );
            const storage = await failFirstFlush( 'refused', 3 );

            const lines = linesWith( warnSpy, '[CIRCUIT_OPEN]' );
            expect( lines ).to.have.lengthOf( 1 );
            expect( lines[ 0 ] ).to.equal(
                'winkComposer/questdb: delivery paused, 3 row(s) held [CIRCUIT_OPEN]: 127.0.0.1:9000 refused'
            );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
        } );

        it( 'health reads red and not connected, with pausedSince', async function () {
            const storage = await failFirstFlush( 'refused', 3 );

            const health = storage.getHealth();
            expect( health.connected ).to.equal( false );
            expect( health.status ).to.equal( 'red' );
            expect( health.pausedSince ).to.equal( NOW );
            expect( health.bufferedRows ).to.equal( 3 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
        } );

        it( 'the loss report carries the failing finding', async function () {
            const onDeliveryFailure = sinon.stub();
            const storage = await failFirstFlush( 'refused', 0, { onDeliveryFailure } );

            expect( onDeliveryFailure.callCount ).to.equal( 1 );
            expect( onDeliveryFailure.firstCall.args[ 1 ] ).to.deep.equal( {
                trigger: 'rows', rowsLost: 2, abandoned: false, probe: probeOutcomeFor( ILP_ADDRESS, 'refused' )
            } );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
        } );

        it( 'the row trigger starts no flush while paused', async function () {
            const storage = await failFirstFlush( 'refused', 3 );

            writeRows( storage, 6 );

            expect( mockSender.flush.callCount ).to.equal( 1 );
            expect( storage.getHealth().bufferedRows ).to.equal( 9 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
        } );

        it( 'the timer starts no flush while paused, and probes once per tick', async function () {
            const storage = await failFirstFlush( 'refused', 3 );
            expect( probe.engineCalls() ).to.equal( 1 );

            await clock.tickAsync( 1000 );
            expect( mockSender.flush.callCount ).to.equal( 1 );
            expect( probe.engineCalls() ).to.equal( 2 );

            await clock.tickAsync( 1000 );
            expect( probe.engineCalls() ).to.equal( 3 );
            expect( mockSender.flush.callCount ).to.equal( 1 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
        } );

        it( 'nothing prints per tick', async function () {
            const warnSpy = sinon.spy( console, 'warn' );
            const logSpy = sinon.spy( console, 'log' );
            const errorSpy = sinon.spy( console, 'error' );
            const storage = await failFirstFlush( 'refused', 3 );
            const before = [ warnSpy.callCount, logSpy.callCount, errorSpy.callCount ];

            await clock.tickAsync( 3000 );

            expect( [ warnSpy.callCount, logSpy.callCount, errorSpy.callCount ] ).to.deep.equal( before );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
        } );

        it( 'a hung tick probe is not doubled by the next tick', async function () {
            const storage = await failFirstFlush( 'refused', 3 );
            probe.hang();

            await clock.tickAsync( 1000 );
            expect( probe.engineCalls() ).to.equal( 2 );
            await clock.tickAsync( 2000 );
            expect( probe.engineCalls(), 'one probe in flight at a time' ).to.equal( 2 );

            probe.release( 'refused' );
            await clock.tickAsync( 0 );
            await clock.tickAsync( 1000 );
            expect( probe.engineCalls() ).to.equal( 3 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
        } );

        it( 'the ceiling still sheds while paused', async function () {
            // flushRows 2 gives a ceiling of 20. Two rows were lost with
            // the failed flush, so 20 more fit and the 21st is shed.
            const storage = await failFirstFlush( 'refused', 3 );

            const results = writeRows( storage, 18 );
            expect( results[ 16 ] ).to.deep.equal( { ok: true } );
            expect( results[ 17 ].ok ).to.equal( false );
            expect( results[ 17 ].error.code ).to.equal( 'STORAGE_FULL' );
            expect( storage.getPressure() ).to.equal( 1 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
        } );

        it( 'an abandoned flush runs the probe too, and can pause', async function () {
            const warnSpy = sinon.spy( console, 'warn' );
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushIntervalMs: 1000, flushDeadlineMs: 300, onDeliveryFailure: sinon.stub() } );
            probe.setResult( 'refused' );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await clock.tickAsync( 1300 );

            expect( probe.engineCalls() ).to.equal( 1 );
            expect( linesWith( warnSpy, '[CIRCUIT_OPEN]' ) ).to.have.lengthOf( 1 );
            expect( storage.getHealth().pausedSince ).to.equal( NOW + 1300 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
        } );

        it( 'a failure while paused is reported without a new probe', async function () {
            const onDeliveryFailure = sinon.stub();
            const storage = await failFirstFlush( 'refused', 3, { onDeliveryFailure } );
            expect( probe.engineCalls() ).to.equal( 1 );

            // A mid-row throw starts the recovery flush, which carries the
            // three held rows into the dead endpoint and fails.
            mockSender.at.onCall( mockSender.at.callCount ).throws( new Error( 'mid-row' ) );
            mockSender.flush.onSecondCall().rejects( new Error( 'still down' ) );
            const result = storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await clock.tickAsync( 0 );

            expect( result.ok ).to.equal( false );
            expect( result.error.code ).to.equal( 'SEND_FAILED' );
            expect( onDeliveryFailure.callCount ).to.equal( 2 );
            expect( onDeliveryFailure.secondCall.args[ 1 ] ).to.deep.equal( {
                trigger: 'recovery', rowsLost: 3, abandoned: false, probe: null
            } );
            expect( probe.engineCalls(), 'the tick probes; a failure while paused does not' ).to.equal( 1 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
        } );

        it( 'a failure while paused prints one line without a finding when no handler was given', async function () {
            const errorSpy = sinon.spy( console, 'error' );
            const storage = await failFirstFlush( 'refused', 3 );

            mockSender.at.onCall( mockSender.at.callCount ).throws( new Error( 'mid-row' ) );
            mockSender.flush.onSecondCall().rejects( new Error( 'still down' ) );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await clock.tickAsync( 0 );

            const lines = linesWith( errorSpy, '[DELIVERY_FAILED]' );
            expect( lines ).to.have.lengthOf( 2 );
            expect( lines[ 1 ] ).to.equal(
                'winkComposer/questdb: flush failed, 3 row(s) lost [DELIVERY_FAILED]: still down'
            );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
        } );

        it( 'an explicit flush() while paused starts, and reports to its caller only', async function () {
            const onDeliveryFailure = sinon.stub();
            const storage = await failFirstFlush( 'refused', 3, { onDeliveryFailure } );
            mockSender.flush.onSecondCall().rejects( new Error( 'still down' ) );

            const err = await storage.flush().then( () => null, ( e ) => e );

            expect( err.message ).to.equal( 'still down' );
            expect( mockSender.flush.callCount ).to.equal( 2 );
            expect( onDeliveryFailure.callCount, 'the caller owns the error' ).to.equal( 1 );
            expect( probe.engineCalls() ).to.equal( 1 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
        } );

    } );

    describe( 'a passing tick probe resumes delivery', function () {

        it( 'one warn line, pausedSince cleared, one flush carries everything held', async function () {
            const warnSpy = sinon.spy( console, 'warn' );
            const storage = await failFirstFlush( 'refused', 3 );

            probe.setResult( 'answers' );
            await clock.tickAsync( 1000 );

            // The pause line, then the resume line, both at warn.
            const lines = linesWith( warnSpy, '[CIRCUIT_OPEN]' );
            expect( lines ).to.have.lengthOf( 2 );
            expect( lines[ 1 ] ).to.equal(
                'winkComposer/questdb: delivery resumed after 1 s, 3 row(s) held [CIRCUIT_OPEN]: 127.0.0.1:9000 answers'
            );

            const health = storage.getHealth();
            expect( health.pausedSince ).to.equal( null );
            expect( health.connected ).to.equal( true );
            expect( mockSender.flush.callCount ).to.equal( 2 );
            expect( health.bufferedRows ).to.equal( 0 );
            expect( health.inFlightRows ).to.equal( 0 );

            await storage.shutdown();
        } );

        it( 'a second outage gets a fresh probe and a fresh pause line', async function () {
            const warnSpy = sinon.spy( console, 'warn' );
            const storage = await failFirstFlush( 'refused', 3 );

            probe.setResult( 'answers' );
            await clock.tickAsync( 1000 );
            expect( storage.getHealth().pausedSince ).to.equal( null );

            probe.setResult( 'refused' );
            mockSender.flush.onThirdCall().rejects( new Error( 'ECONNREFUSED' ) );
            writeRows( storage, 2 );
            await clock.tickAsync( 0 );

            expect( probe.engineCalls() ).to.equal( 3 );
            // Pause, resume, pause: the resume line is warn too.
            expect( linesWith( warnSpy, '[CIRCUIT_OPEN]' ) ).to.have.lengthOf( 3 );
            expect( storage.getHealth().pausedSince ).to.equal( NOW + 1000 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
        } );

        it( 'a probe that settles after shutdown starts nothing', async function () {
            const warnSpy = sinon.spy( console, 'warn' );
            const onDeliveryFailure = sinon.stub();
            mockSender.flush.onFirstCall().rejects( new Error( 'boom' ) );
            const storage = await makeStorage( { flushRows: 2, onDeliveryFailure } );
            probe.hang();

            writeRows( storage, 2 );
            await clock.tickAsync( 0 );
            await storage.shutdown();

            probe.release( 'refused' );
            await clock.tickAsync( 0 );

            expect( onDeliveryFailure.callCount, 'the loss is still reported' ).to.equal( 1 );
            expect( linesWith( warnSpy, '[CIRCUIT_OPEN]' ) ).to.have.lengthOf( 0 );
            expect( mockSender.flush.callCount ).to.equal( 1 );
        } );

        it( 'a tick probe that passes after shutdown resumes nothing', async function () {
            const logSpy = sinon.spy( console, 'log' );
            const storage = await failFirstFlush( 'refused', 3 );
            probe.hang();
            await clock.tickAsync( 1000 );
            expect( probe.engineCalls() ).to.equal( 2 );

            // The drain's final flush lands the held rows. The hung tick
            // probe then passes, too late to matter.
            await storage.shutdown();
            probe.release( 'answers' );
            await clock.tickAsync( 0 );

            expect( linesWith( logSpy, '[CIRCUIT_OPEN]' ) ).to.have.lengthOf( 0 );
            expect( mockSender.flush.callCount ).to.equal( 2 );
        } );

        it( 'a resume with nothing held starts no flush', async function () {
            const storage = await failFirstFlush( 'refused', 0 );

            probe.setResult( 'answers' );
            await clock.tickAsync( 1000 );

            expect( storage.getHealth().pausedSince ).to.equal( null );
            expect( mockSender.flush.callCount ).to.equal( 1 );

            await storage.shutdown();
        } );

        it( 'a resume while an engine flush is still in flight leaves the guard to it', async function () {
            const onDeliveryFailure = sinon.stub();
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( {
                flushRows: 2, flushIntervalMs: 1000, flushDeadlineMs: 5000, onDeliveryFailure
            } );
            probe.setResult( 'refused' );

            // Flush #1 hangs and holds the guard. A mid-row throw then runs
            // the recovery flush, which fails and pauses delivery.
            writeRows( storage, 2 );
            mockSender.at.onCall( mockSender.at.callCount ).throws( new Error( 'mid-row' ) );
            mockSender.flush.onSecondCall().rejects( new Error( 'ECONNREFUSED' ) );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await clock.tickAsync( 0 );
            expect( storage.getHealth().connected ).to.equal( false );

            writeRows( storage, 3 );
            probe.setResult( 'answers' );
            await clock.tickAsync( 1000 );

            expect( storage.getHealth().pausedSince ).to.equal( null );
            expect( mockSender.flush.callCount, 'flush #1 still holds the guard' ).to.equal( 2 );
            expect( storage.getHealth().bufferedRows ).to.equal( 3 );

            const shutdownPromise = storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
            await shutdownPromise;
        } );

    } );

    describe( 'shutdown while paused', function () {

        it( 'attempts the final flush and resolves clean when the endpoint answers', async function () {
            const storage = await failFirstFlush( 'refused', 3 );

            await storage.shutdown();

            expect( mockSender.flush.callCount ).to.equal( 2 );
            expect( storage.getHealth().bufferedRows ).to.equal( 0 );
        } );

        it( 'reports the held rows dropped when the final flush fails', async function () {
            const storage = await failFirstFlush( 'refused', 3 );
            mockSender.flush.onSecondCall().rejects( new Error( 'still down' ) );

            const err = await storage.shutdown().then( () => null, ( e ) => e );

            expect( err.code ).to.equal( 'DELIVERY_FAILED' );
            expect( err.dropped ).to.deep.equal( { count: 3 } );
        } );

    } );

    describe( 'accounting across a pause', function () {

        it( 'accepted rows equal landed plus reported lost, and shed rows are refused', async function () {
            const onDeliveryFailure = sinon.stub();
            const storage = await failFirstFlush( 'refused', 0, { onDeliveryFailure } );

            const results = writeRows( storage, 25 );
            const accepted = results.filter( ( r ) => r.ok ).length;
            const shed = results.filter( ( r ) => !r.ok && ( r.error.code === 'STORAGE_FULL' ) ).length;
            expect( accepted ).to.equal( 20 );
            expect( shed ).to.equal( 5 );

            probe.setResult( 'answers' );
            await clock.tickAsync( 1000 );

            const lost = onDeliveryFailure.getCalls().reduce( ( sum, call ) => sum + call.args[ 1 ].rowsLost, 0 );
            expect( lost ).to.equal( 2 );
            expect( mockSender.flush.callCount ).to.equal( 2 );
            expect( storage.getHealth().bufferedRows ).to.equal( 0 );
            expect( storage.getHealth().inFlightRows ).to.equal( 0 );
            // 22 rows were accepted in all: 2 lost with the first flush,
            // 20 held and then landed by the resume flush.
            expect( 2 + accepted ).to.equal( lost + 20 );

            await storage.shutdown();
        } );

    } );

} );

// core/storage-manager/questdb/test/flush-engine.specs.js

/**
 * @fileoverview The flush engine composer owns (ADR-029).
 *
 * Before this change the QuestDB client decided when a batch left the
 * process, and composer only guessed at what was still buffered. Now
 * the client's own flush trigger is off (`auto_flush=off`) and composer
 * starts every flush itself. Two triggers exist. A write that brings
 * the buffer to `flushRows` starts a flush at once, inside `write()`,
 * without waiting for it. A timer starts a flush every
 * `flushIntervalMs` when anything is buffered, so a slow stream still
 * lands within about one interval. Only one engine flush runs at a
 * time: while one is in flight, both triggers wait and rows collect.
 * An explicit `flush()` call is the caller's own decision and starts a
 * flush regardless.
 *
 * Because the client copies the rows out of its buffer when a flush
 * starts, a failed flush has lost its rows. The engine reports that
 * loss once per flush: to `onDeliveryFailure` when the caller gave
 * one, with the trigger and the exact count, otherwise as one
 * classified `DELIVERY_FAILED` console line. The counters behind
 * `getPressure()` and `getHealth()` are exact, because the engine sees
 * every flush start and settle. Pressure is the fill of the buffer
 * against `bufferCeilingRows`, the point where writes are refused.
 *
 * The five legacy keys (`flushMode`, `idleFlushAfterMs`,
 * `idleFlushCheckMs`, `autoFlushRows`, `autoFlushIntervalMs`) are
 * still accepted. One `DEPRECATED_OPTION` line names them at setup.
 *
 * Every case here was written before the engine and proven red.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createQuestDBStorage, buildSenderConfig } from '../index.js';
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

const ADDRESSES = { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812' };

/** Writes `count` good rows and returns the results. */
const writeRows = function ( storage, count ) {
    const results = [];
    for ( let i = 0; i < count; i += 1 ) {
        results.push( storage.write( 'monitoring', GOOD_MSG, 'p1' ) );
    }
    return results;
}; // writeRows()

/** One macrotask turn, so a settled flush has run its handlers. */
const settle = function () {
    return new Promise( ( resolve ) => setImmediate( resolve ) );
}; // settle()

describe( 'QuestDB flush engine (ADR-029)', function () {

    let mockSender;
    let deps;
    let clock = null;

    const makeStorage = ( options = {} ) => createQuestDBStorage(
        TEST_ASSET_CLASS,
        'pump',
        { ...ADDRESSES, ...options },
        deps
    );

    beforeEach( function () {
        mockSender = makeMockSender();
        deps = makeMockDeps( mockSender );
    } );

    afterEach( function () {
        if ( clock ) {
            clock.restore();
            clock = null;
        }
        sinon.restore();
    } );

    describe( 'the client never flushes on its own', function () {

        it( 'buildSenderConfig always turns the client trigger off', function () {
            const config = buildSenderConfig( { ilpUrl: '127.0.0.1:9000' } );

            expect( config ).to.include( 'http::addr=127.0.0.1:9000;' );
            expect( config ).to.include( 'auto_flush=off;' );
        } );

        it( 'buildSenderConfig carries the buffer and retry settings when given', function () {
            const config = buildSenderConfig( { ilpUrl: '127.0.0.1:9000', maxBufSize: 1048576, retryTimeout: 30000 } );

            expect( config ).to.include( 'init_buf_size=1048576;' );
            expect( config ).to.include( 'retry_timeout=30000;' );
        } );

        it( 'the sender the factory builds has the trigger off and no client row or time trigger', async function () {
            const storage = await makeStorage( { flushRows: 7 } );

            const config = deps.SenderClass.fromConfig.firstCall.args[ 0 ];
            expect( config ).to.include( 'auto_flush=off;' );
            expect( config ).to.not.include( 'auto_flush_rows' );
            expect( config ).to.not.include( 'auto_flush_interval' );

            await storage.shutdown();
        } );

    } );

    describe( 'row trigger', function () {

        it( 'the write that reaches flushRows starts a flush inside write()', async function () {
            const storage = await makeStorage( { flushRows: 3 } );

            writeRows( storage, 2 );
            expect( mockSender.flush.called ).to.equal( false );
            expect( storage.getHealth().bufferedRows ).to.equal( 2 );

            const third = storage.write( 'monitoring', GOOD_MSG, 'p1' );
            expect( third ).to.deep.equal( { ok: true } );
            expect( mockSender.flush.callCount ).to.equal( 1 );

            await storage.shutdown();
        } );

        it( 'the rows move from buffered to in flight when the flush starts, and leave when it settles', async function () {
            let release = null;
            mockSender.flush.onFirstCall().returns( new Promise( ( resolve ) => {
                release = resolve;
            } ) );
            const storage = await makeStorage( { flushRows: 3 } );

            writeRows( storage, 3 );
            expect( storage.getHealth().bufferedRows ).to.equal( 0 );
            expect( storage.getHealth().inFlightRows ).to.equal( 3 );

            release( true );
            await settle();
            expect( storage.getHealth().inFlightRows ).to.equal( 0 );
            expect( storage.getPressure() ).to.equal( 0 );

            await storage.shutdown();
        } );

        it( 'write() returns before the flush settles, even when it never does', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushRows: 2 } );

            const results = writeRows( storage, 2 );
            expect( results[ 1 ] ).to.deep.equal( { ok: true } );
            expect( mockSender.flush.callCount ).to.equal( 1 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
        } );

        it( 'a skipped row does not count toward the threshold', async function () {
            const storage = await makeStorage( { flushRows: 2, onWarning: sinon.stub() } );

            // No designated timestamp: the plan skips the row before it
            // touches the sender.
            storage.write( 'monitoring', { temp: 25.5 }, 'p1' );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );

            expect( mockSender.flush.called ).to.equal( false );
            expect( storage.getHealth().bufferedRows ).to.equal( 1 );

            await storage.shutdown();
        } );

    } );

    describe( 'timer trigger', function () {

        it( 'flushes whatever is buffered once flushIntervalMs has passed', async function () {
            clock = sinon.useFakeTimers();
            const storage = await makeStorage( { flushIntervalMs: 1000 } );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await clock.tickAsync( 999 );
            expect( mockSender.flush.called ).to.equal( false );

            await clock.tickAsync( 1 );
            expect( mockSender.flush.callCount ).to.equal( 1 );
            expect( storage.getHealth().bufferedRows ).to.equal( 0 );

            await storage.shutdown();
        } );

        it( 'does not wait for the stream to go idle', async function () {
            // The old idle timer waited for a quiet gap after the last
            // write. Rows written every tick would then never land
            // until shutdown. The interval timer flushes on schedule.
            clock = sinon.useFakeTimers();
            const storage = await makeStorage( { flushIntervalMs: 1000 } );

            for ( let i = 0; i < 4; i += 1 ) {
                storage.write( 'monitoring', GOOD_MSG, 'p1' );
                // eslint-disable-next-line no-await-in-loop -- one tick per write, by design
                await clock.tickAsync( 500 );
            }

            expect( mockSender.flush.callCount ).to.equal( 2 );

            await storage.shutdown();
        } );

        it( 'an empty buffer starts no flush', async function () {
            clock = sinon.useFakeTimers();
            const storage = await makeStorage( { flushIntervalMs: 100 } );

            await clock.tickAsync( 1000 );

            expect( mockSender.flush.called ).to.equal( false );

            await storage.shutdown();
        } );

        it( 'the legacy idleFlushCheckMs sets the interval', async function () {
            clock = sinon.useFakeTimers();
            sinon.stub( console, 'warn' );
            const storage = await makeStorage( { idleFlushCheckMs: 250 } );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await clock.tickAsync( 250 );

            expect( mockSender.flush.callCount ).to.equal( 1 );

            await storage.shutdown();
        } );

        it( 'shutdown stops the timer', async function () {
            clock = sinon.useFakeTimers();
            const storage = await makeStorage( { flushIntervalMs: 100 } );

            await storage.shutdown();
            const callsAtShutdown = mockSender.flush.callCount;

            await clock.tickAsync( 1000 );
            expect( mockSender.flush.callCount ).to.equal( callsAtShutdown );
        } );

    } );

    describe( 'one engine flush at a time', function () {

        it( 'the row trigger waits while a flush is in flight, and rows keep collecting', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushRows: 2 } );

            writeRows( storage, 2 );
            expect( mockSender.flush.callCount ).to.equal( 1 );

            writeRows( storage, 3 );
            expect( mockSender.flush.callCount ).to.equal( 1 );
            expect( storage.getHealth().bufferedRows ).to.equal( 3 );
            expect( storage.getHealth().inFlightRows ).to.equal( 2 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
        } );

        it( 'the timer waits while a flush is in flight', async function () {
            clock = sinon.useFakeTimers();
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushRows: 2, flushIntervalMs: 100 } );

            writeRows( storage, 2 );
            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await clock.tickAsync( 1000 );

            expect( mockSender.flush.callCount ).to.equal( 1 );

            // The shutdown budget runs on the faked clock too, so it needs
            // a tick to expire.
            const shutdownPromise = storage.shutdown( { timeout: 10 } ).catch( () => undefined );
            await clock.tickAsync( 10 );
            await shutdownPromise;
        } );

        it( 'the triggers resume once the flush settles', async function () {
            let release = null;
            mockSender.flush.onFirstCall().returns( new Promise( ( resolve ) => {
                release = resolve;
            } ) );
            const storage = await makeStorage( { flushRows: 2 } );

            writeRows( storage, 4 );
            expect( mockSender.flush.callCount ).to.equal( 1 );

            release( true );
            await settle();
            writeRows( storage, 1 );
            expect( mockSender.flush.callCount ).to.equal( 2 );

            await storage.shutdown();
        } );

        it( 'the triggers resume after a failed flush too', async function () {
            mockSender.flush.onFirstCall().rejects( new Error( 'boom' ) );
            const storage = await makeStorage( { flushRows: 2, onDeliveryFailure: sinon.stub() } );

            writeRows( storage, 2 );
            await settle();
            writeRows( storage, 2 );

            expect( mockSender.flush.callCount ).to.equal( 2 );

            await storage.shutdown();
        } );

        it( 'an explicit flush() starts a flush even while an engine flush is in flight', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushRows: 2 } );

            writeRows( storage, 3 );
            await storage.flush();

            expect( mockSender.flush.callCount ).to.equal( 2 );
            expect( storage.getHealth().bufferedRows ).to.equal( 0 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
        } );

        it( 'an explicit flush() with nothing buffered is a no-op', async function () {
            const storage = await makeStorage();

            await storage.flush();

            expect( mockSender.flush.called ).to.equal( false );

            await storage.shutdown();
        } );

    } );

    describe( 'a failed engine flush is reported once, with the exact loss', function () {

        it( 'routes a failed row-triggered flush to onDeliveryFailure', async function () {
            const flushError = new Error( 'ECONNREFUSED' );
            mockSender.flush.onFirstCall().rejects( flushError );
            const onDeliveryFailure = sinon.stub();
            const storage = await makeStorage( { flushRows: 2, onDeliveryFailure } );

            writeRows( storage, 2 );
            await settle();

            expect( onDeliveryFailure.callCount ).to.equal( 1 );
            const [ err, ctx ] = onDeliveryFailure.firstCall.args;
            expect( err ).to.equal( flushError );
            expect( ctx ).to.deep.equal( { trigger: 'rows', rowsLost: 2, abandoned: false } );
            expect( storage.getPressure() ).to.equal( 0 );

            await storage.shutdown();
        } );

        it( 'routes a failed timer flush to onDeliveryFailure', async function () {
            clock = sinon.useFakeTimers();
            mockSender.flush.onFirstCall().rejects( new Error( 'boom' ) );
            const onDeliveryFailure = sinon.stub();
            const storage = await makeStorage( { flushIntervalMs: 100, onDeliveryFailure } );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await clock.tickAsync( 100 );

            expect( onDeliveryFailure.callCount ).to.equal( 1 );
            expect( onDeliveryFailure.firstCall.args[ 1 ] ).to.deep.equal( { trigger: 'timer', rowsLost: 1, abandoned: false } );

            await storage.shutdown();
        } );

        it( 'prints one classified DELIVERY_FAILED line when no handler was given', async function () {
            mockSender.flush.onFirstCall().rejects( new Error( 'boom' ) );
            const errorSpy = sinon.spy( console, 'error' );
            const storage = await makeStorage( { flushRows: 2 } );

            writeRows( storage, 2 );
            await settle();

            const lines = errorSpy.getCalls()
                .map( ( call ) => String( call.args[ 0 ] ) )
                .filter( ( line ) => line.includes( '[DELIVERY_FAILED]' ) );
            expect( lines ).to.have.lengthOf( 1 );
            expect( lines[ 0 ] ).to.include( 'winkComposer/questdb: flush failed, 2 row(s) lost [DELIVERY_FAILED]: boom' );

            await storage.shutdown();
        } );

    } );

    describe( 'exact accounting', function () {

        it( 'getHealth() carries bufferedRows and inFlightRows and no flushMode', async function () {
            const storage = await makeStorage();

            const health = storage.getHealth();
            expect( health.bufferedRows ).to.equal( 0 );
            expect( health.inFlightRows ).to.equal( 0 );
            expect( health ).to.not.have.property( 'flushMode' );

            await storage.shutdown();
        } );

        it( 'pressure is the fill against the derived ceiling, ten times flushRows', async function () {
            const storage = await makeStorage( { flushRows: 10 } );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            expect( storage.getPressure() ).to.equal( 0.01 );

            await storage.shutdown();
        } );

        it( 'pressure is the fill against an explicit ceiling', async function () {
            const storage = await makeStorage( { flushRows: 10, bufferCeilingRows: 50 } );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            expect( storage.getPressure() ).to.equal( 0.02 );

            await storage.shutdown();
        } );

        it( 'rows in a hung flush read as pressure until it settles', async function () {
            mockSender.flush.onFirstCall().returns( NEVER_SETTLES );
            const storage = await makeStorage( { flushRows: 2 } );

            writeRows( storage, 2 );
            expect( storage.getPressure() ).to.equal( 0.1 );

            await storage.shutdown( { timeout: 10 } ).catch( () => undefined );
        } );

        it( 'pressure is exact with the default settings', async function () {
            // 5000 rows a flush, ceiling 50000: one row is 1/50000.
            const storage = await makeStorage();

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            expect( storage.getPressure() ).to.equal( 0.00002 );

            await storage.shutdown();
        } );

    } );

    describe( 'deprecated keys', function () {

        it( 'prints one DEPRECATED_OPTION line naming every legacy key in use', async function () {
            const warnSpy = sinon.stub( console, 'warn' );
            const storage = await makeStorage( { flushMode: 'manual', autoFlushRows: 4 } );

            const lines = warnSpy.getCalls()
                .map( ( call ) => String( call.args[ 0 ] ) )
                .filter( ( line ) => line.includes( '[DEPRECATED_OPTION]' ) );
            expect( lines ).to.have.lengthOf( 1 );
            expect( lines[ 0 ] ).to.include( 'flushMode is ignored' );
            expect( lines[ 0 ] ).to.include( 'autoFlushRows maps to flushRows' );

            await storage.shutdown();
        } );

        it( 'a mapped legacy autoFlushRows sets the row trigger', async function () {
            sinon.stub( console, 'warn' );
            const storage = await makeStorage( { autoFlushRows: 4 } );

            writeRows( storage, 3 );
            expect( mockSender.flush.called ).to.equal( false );
            writeRows( storage, 1 );
            expect( mockSender.flush.callCount ).to.equal( 1 );

            await storage.shutdown();
        } );

        it( 'prints nothing when no legacy key is in use', async function () {
            const warnSpy = sinon.stub( console, 'warn' );
            const storage = await makeStorage( { flushRows: 4 } );

            const lines = warnSpy.getCalls()
                .map( ( call ) => String( call.args[ 0 ] ) )
                .filter( ( line ) => line.includes( '[DEPRECATED_OPTION]' ) );
            expect( lines ).to.have.lengthOf( 0 );

            await storage.shutdown();
        } );

    } );

    describe( 'refusals allocate nothing per call', function () {

        it( 'write() during shutdown returns one shared SHUTTING_DOWN result', async function () {
            const storage = await makeStorage();
            await storage.shutdown();

            const first = storage.write( 'monitoring', GOOD_MSG, 'p1' );
            const second = storage.write( 'monitoring', GOOD_MSG, 'p1' );

            expect( first.ok ).to.equal( false );
            expect( first.error.code ).to.equal( 'SHUTTING_DOWN' );
            expect( first.error.message ).to.include( '[SHUTTING_DOWN]' );
            expect( second ).to.equal( first );
        } );

    } );

} );

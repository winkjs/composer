// core/storage-manager/questdb/test/callback-containment.specs.js

/**
 * @fileoverview Containment of a broken onDeliveryFailure callback.
 *
 * The storage adapter reports lost rows through the user's
 * `onDeliveryFailure`. Per ADR-018, a bug inside that callback must
 * cost only its own output, never the adapter. Without the guard, a
 * throw inside the callback surfaces as an unhandled rejection from
 * the flush chain, and Node 15+ ends the process on that. The specs
 * here drive the three trigger paths — the at-flush site inside the
 * persist plan, the idle-flush timer, and the mid-row recovery
 * flush — with a throwing and an async-rejecting handler each.
 *
 * The final pin guards ADR-027's exclusion: a throwing `onWarning`
 * is strict mode. Its throw IS the control flow that rejects the
 * row, so the guard must never contain it.
 */

/* eslint-disable no-throw-literal */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createQuestDBStorage } from '../index.js';
import { makeMockSender, makeMockDeps } from './test-helpers.js';

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

// One macrotask turn: lets a pending rejection reach its .catch (or
// the unhandledRejection trap) before the assertions run.
const settle = function () {
    return new Promise( ( resolve ) => setImmediate( resolve ) );
}; // settle()

// Poll until `condition()` is true or ~500ms elapse; the idle-flush
// timer in these tests fires within a few ticks.
const waitFor = async function ( condition ) {
    for ( let i = 0; i < 50 && !condition(); i += 1 ) {
        // eslint-disable-next-line no-await-in-loop -- wait-for-condition poll
        await new Promise( ( r ) => setTimeout( r, 10 ) );
    }
}; // waitFor()

describe( 'QuestDB storage — a broken onDeliveryFailure is contained (ADR-018)', function () {

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

    // Idle-flush timings for the tests that need the timer to fire.
    const IDLE_OPTS = { idleFlushAfterMs: 1, idleFlushCheckMs: 10 };

    // Every fault the guard contains must ALSO not leak as an
    // unhandled rejection — that leak is the process-killing failure
    // this story removes. The trap collects; each test asserts.
    const unhandled = [];
    const trapRejection = function ( err ) {
        unhandled.push( err );
    };

    // The classified lines this suite greps for.
    const faultLines = ( spy ) => spy.getCalls()
        .map( ( call ) => String( call.args[ 0 ] ) )
        .filter( ( line ) => line.includes( 'CALLBACK_FAILED' ) && line.includes( 'onDeliveryFailure' ) );

    before( function () {
        process.on( 'unhandledRejection', trapRejection );
    } );

    after( function () {
        process.removeListener( 'unhandledRejection', trapRejection );
    } );

    beforeEach( function () {
        mockSender = makeMockSender();
        deps = makeMockDeps( mockSender );
        unhandled.length = 0;
    } );

    afterEach( function () {
        sinon.restore();
    } );

    describe( 'at-flush site (persist plan)', function () {

        it( 'contains a throwing handler; writes keep succeeding', async function () {
            // resetBehavior first: the mock's default `returnsThis()` takes
            // precedence over a later callsFake, which would silently make
            // this trigger inert (at() must return a rejecting thenable).
            mockSender.at.resetBehavior();
            mockSender.at.callsFake( () => Promise.reject( new Error( 'at flush failed' ) ) );
            const onDeliveryFailure = sinon.stub().throws( new Error( 'handler down' ) );
            const storage = await makeStorage( { onDeliveryFailure } );
            const spy = sinon.spy( console, 'error' );

            const first = storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await settle();
            const second = storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await settle();

            expect( first ).to.deep.equal( { ok: true } );
            expect( second ).to.deep.equal( { ok: true } );
            expect( onDeliveryFailure.callCount ).to.equal( 2 );
            const lines = faultLines( spy );
            expect( lines ).to.have.lengthOf( 2 );
            expect( lines[ 0 ] ).to.contain( 'winkComposer/questdb' );
            expect( lines[ 0 ] ).to.contain( 'handler down' );
            expect( unhandled ).to.have.lengthOf( 0 );
            await storage.shutdown( { timeout: 1000 } );
        } );

        it( 'contains an async-rejecting handler — no unhandled rejection', async function () {
            mockSender.at.resetBehavior();
            mockSender.at.callsFake( () => Promise.reject( new Error( 'at flush failed' ) ) );
            const onDeliveryFailure = sinon.stub().callsFake(
                () => Promise.reject( new Error( 'async handler down' ) )
            );
            const storage = await makeStorage( { onDeliveryFailure } );
            const spy = sinon.spy( console, 'error' );

            const result = storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await settle();
            await settle();

            expect( result ).to.deep.equal( { ok: true } );
            const lines = faultLines( spy );
            expect( lines ).to.have.lengthOf( 1 );
            expect( lines[ 0 ] ).to.contain( 'async handler down' );
            expect( unhandled ).to.have.lengthOf( 0 );
            await storage.shutdown( { timeout: 1000 } );
        } );

    } );

    describe( 'idle-flush site', function () {

        it( 'contains a throwing handler; the timer and later writes survive', async function () {
            const idleError = new Error( 'idle boom' );
            mockSender.flush.onFirstCall().rejects( idleError );
            const onDeliveryFailure = sinon.stub().throws( new Error( 'handler down' ) );
            const storage = await makeStorage( { ...IDLE_OPTS, onDeliveryFailure } );
            const spy = sinon.spy( console, 'error' );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await waitFor( () => onDeliveryFailure.called );
            await settle();

            // Two-argument passthrough at this site: the raw error and
            // the idle-flush context reach the handler unchanged.
            expect( onDeliveryFailure.firstCall.args[ 0 ] ).to.equal( idleError );
            expect( onDeliveryFailure.firstCall.args[ 1 ] ).to.deep.equal( { idleFlush: true, rowsLost: 1 } );
            const lines = faultLines( spy );
            expect( lines ).to.have.lengthOf( 1 );
            expect( lines[ 0 ] ).to.contain( 'handler down' );
            expect( unhandled ).to.have.lengthOf( 0 );
            // The adapter survives its reporter's bug: a later write and
            // a clean shutdown still work.
            expect( storage.write( 'monitoring', GOOD_MSG, 'p1' ) ).to.deep.equal( { ok: true } );
            await storage.shutdown( { timeout: 1000 } );
        } );

        it( 'contains an async-rejecting handler — no unhandled rejection', async function () {
            mockSender.flush.onFirstCall().rejects( new Error( 'idle boom' ) );
            const onDeliveryFailure = sinon.stub().callsFake(
                () => Promise.reject( new Error( 'async handler down' ) )
            );
            const storage = await makeStorage( { ...IDLE_OPTS, onDeliveryFailure } );
            const spy = sinon.spy( console, 'error' );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await waitFor( () => onDeliveryFailure.called );
            await settle();
            await settle();

            const lines = faultLines( spy );
            expect( lines ).to.have.lengthOf( 1 );
            expect( lines[ 0 ] ).to.contain( 'async handler down' );
            expect( unhandled ).to.have.lengthOf( 0 );
            await storage.shutdown( { timeout: 1000 } );
        } );

        it( 'contains `throw null` from the handler — the detail reads "null"', async function () {
            mockSender.flush.onFirstCall().rejects( new Error( 'idle boom' ) );
            let fired = false;
            const onDeliveryFailure = function () {
                fired = true;
                throw null;
            };
            const storage = await makeStorage( { ...IDLE_OPTS, onDeliveryFailure } );
            const spy = sinon.spy( console, 'error' );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await waitFor( () => fired );
            await settle();

            const lines = faultLines( spy );
            expect( lines ).to.have.lengthOf( 1 );
            expect( lines[ 0 ] ).to.contain( 'null' );
            expect( unhandled ).to.have.lengthOf( 0 );
            await storage.shutdown( { timeout: 1000 } );
        } );

    } );

    describe( 'recovery site (mid-row write error)', function () {

        it( 'contains a throwing handler; err and ctx still arrive unchanged', async function () {
            const flushError = new Error( 'ECONNREFUSED' );
            mockSender.flush.onFirstCall().rejects( flushError );
            mockSender.floatColumn.onFirstCall().throws( new Error( 'mid-row boom' ) );
            const onDeliveryFailure = sinon.stub().throws( new Error( 'handler down' ) );
            const storage = await makeStorage( { onDeliveryFailure } );
            const spy = sinon.spy( console, 'error' );

            const first = storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await settle();

            expect( first.ok ).to.equal( false );
            expect( first.error.code ).to.equal( 'SEND_FAILED' );
            // Two-argument passthrough: the guard hands the raw error and
            // context to the handler exactly as the unguarded call did.
            expect( onDeliveryFailure.calledOnce ).to.equal( true );
            expect( onDeliveryFailure.firstCall.args[ 0 ] ).to.equal( flushError );
            expect( onDeliveryFailure.firstCall.args[ 1 ] ).to.deep.equal( { recovery: true } );
            const lines = faultLines( spy );
            expect( lines ).to.have.lengthOf( 1 );
            expect( lines[ 0 ] ).to.contain( 'handler down' );
            expect( unhandled ).to.have.lengthOf( 0 );
            // The sender recovered despite the broken reporter.
            expect( storage.write( 'monitoring', GOOD_MSG, 'p1' ) ).to.deep.equal( { ok: true } );
            await storage.shutdown( { timeout: 1000 } );
        } );

        it( 'contains an async-rejecting handler — no unhandled rejection', async function () {
            mockSender.flush.onFirstCall().rejects( new Error( 'ECONNREFUSED' ) );
            mockSender.floatColumn.onFirstCall().throws( new Error( 'mid-row boom' ) );
            const onDeliveryFailure = sinon.stub().callsFake(
                () => Promise.reject( new Error( 'async handler down' ) )
            );
            const storage = await makeStorage( { onDeliveryFailure } );
            const spy = sinon.spy( console, 'error' );

            storage.write( 'monitoring', GOOD_MSG, 'p1' );
            await settle();
            await settle();

            const lines = faultLines( spy );
            expect( lines ).to.have.lengthOf( 1 );
            expect( lines[ 0 ] ).to.contain( 'async handler down' );
            expect( unhandled ).to.have.lengthOf( 0 );
            await storage.shutdown( { timeout: 1000 } );
        } );

    } );

    describe( 'the ADR-027 exclusion: onWarning stays unwrapped', function () {

        it( 'a strict-mode onWarning throw still rejects the row — no CALLBACK_FAILED', async function () {
            const onWarning = ( msg ) => {
                throw new Error( msg );
            };
            const storage = await makeStorage( { onWarning } );
            const spy = sinon.spy( console, 'error' );

            const result = storage.write( 'monitoring', { ts: 1735500000000, temp: NaN }, 'p1' );

            // The throw IS the strict-mode control flow: the row is
            // rejected with the warning's own message.
            expect( result.ok ).to.equal( false );
            expect( result.error.code ).to.equal( 'SEND_FAILED' );
            expect( result.error.message ).to.match( /column 'temp' is NaN/ );
            const classified = spy.getCalls()
                .filter( ( call ) => String( call.args[ 0 ] ).includes( 'CALLBACK_FAILED' ) );
            expect( classified ).to.have.lengthOf( 0 );
            expect( unhandled ).to.have.lengthOf( 0 );
            await storage.shutdown( { timeout: 1000 } );
        } );

    } );

} );

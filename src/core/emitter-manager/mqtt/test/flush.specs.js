// core/emitter-manager/mqtt/test/flush.specs.js

/**
 * @fileoverview MQTT emitter — `flush()`, the sink-floor method
 * ADR-018 §6 lists beside `shutdown()`.
 *
 * A flush waits for every accepted message to reach a settled outcome,
 * the same wait the shutdown drain runs, without closing anything and
 * without refusing new work. It resolves when the unacked counter
 * reaches zero within the budget. When the budget passes first it
 * rejects with `DELIVERY_FAILED` and `pending: { count }`, the code
 * QuestDB's flush uses when its own deadline passes.
 *
 * Tests drive the shared manual-ack mock: an acknowledgment happens only
 * when the test fires a captured publish callback.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';

import { createEmitter } from '../emitter.js';
import { makeMockClient, fireConnect, testCodec } from './test-helpers.js';

const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );

describe( 'mqtt emitter — flush()', function () {

    let mock;
    let emitter;
    let ackedUpTo;

    const ackStranded = function () {
        const calls = mock.publishCalls;
        while ( ackedUpTo < calls.length ) {
            calls[ ackedUpTo ].cb();
            ackedUpTo += 1;
        }
    }; // ackStranded()

    beforeEach( async function () {
        mock = makeMockClient( { manualAcks: true } );
        ackedUpTo = 0;
        emitter = await createEmitter( {
            brokerUrl: 'mqtt://127.0.0.1',
            connectGraceMs: 0,
            codec: testCodec,
            mqttConnectFn: () => mock.client
        } );
        fireConnect( mock.eventHandlers );
    } );

    afterEach( async function () {
        ackStranded();
        await Promise.resolve( emitter.shutdown( { timeout: 200 } ) ).catch( () => undefined );
    } );

    it( 'is on the handle and resolves at once when nothing is pending', async function () {
        expect( typeof emitter.flush ).to.equal( 'function' );

        const started = Date.now();
        await emitter.flush();

        expect( Date.now() - started ).to.be.below( 50 );
    } );

    it( 'resolves when the acknowledgments land during the wait, and keeps accepting work', async function () {
        expect( emitter.publishNow( 'wink/a', { v: 1 } ).ok ).to.equal( true );
        expect( emitter.publishNow( 'wink/b', { v: 2 } ).ok ).to.equal( true );
        expect( emitter.getHealth().stats.unacked ).to.equal( 2 );

        setTimeout( ackStranded, 60 );
        await emitter.flush( { timeout: 2000 } );

        expect( emitter.getPressure() ).to.equal( 0 );
        // A flush closes nothing and refuses nothing.
        expect( emitter.publishNow( 'wink/c', { v: 3 } ) ).to.deep.equal( { ok: true } );
        expect( mock.endCalls.length ).to.equal( 0 );
    } );

    it( 'rejects DELIVERY_FAILED with the pending count when the budget passes first', async function () {
        expect( emitter.publishNow( 'wink/a', { v: 1 } ).ok ).to.equal( true );
        expect( emitter.publishNow( 'wink/b', { v: 2 } ).ok ).to.equal( true );

        let thrown = null;
        await emitter.flush( { timeout: 100 } ).catch( ( err ) => {
            thrown = err;
        } );

        expect( thrown ).to.be.an( 'error' );
        expect( thrown.code ).to.equal( 'DELIVERY_FAILED' );
        expect( thrown.pending ).to.deep.equal( { count: 2 } );
        expect( thrown.message ).to.contain( 'winkComposer/mqttEmitter: flush ended with 2 message(s) unacknowledged [DELIVERY_FAILED]' );
        // The messages are still in flight: nothing was dropped or closed.
        expect( emitter.getHealth().stats.unacked ).to.equal( 2 );
        expect( mock.endCalls.length ).to.equal( 0 );
    } );

    it( 'a flush during shutdown waits on the same counter and settles with it', async function () {
        expect( emitter.publishNow( 'wink/a', { v: 1 } ).ok ).to.equal( true );

        const closing = emitter.shutdown( { timeout: 2000 } );
        const flushing = emitter.flush( { timeout: 2000 } );
        await sleep( 60 );
        ackStranded();
        await Promise.all( [ closing, flushing ] );

        expect( emitter.getPressure() ).to.equal( 0 );
    } );

    it( 'a non-finite or non-positive budget falls back to the default, as shutdown does', async function () {
        expect( emitter.publishNow( 'wink/a', { v: 1 } ).ok ).to.equal( true );

        for ( const timeout of [ Infinity, NaN, 0, -5 ] ) {
            const pending = emitter.flush( { timeout } );
            // eslint-disable-next-line no-await-in-loop
            await sleep( 30 );
            // Still waiting after 30 ms: a collapsed budget would have
            // rejected by now.
            expect( emitter.getHealth().stats.unacked, `timeout: ${String( timeout )}` ).to.equal( 1 );
            ackStranded();
            // eslint-disable-next-line no-await-in-loop
            await pending;
            expect( emitter.publishNow( 'wink/again', { v: 1 } ).ok ).to.equal( true );
        }
        ackStranded();
    } );

} );

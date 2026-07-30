// core/emitter-manager/mqtt/test/lossy-shutdown.specs.js

/**
 * @fileoverview MQTT emitter lossy-shutdown reporting (ADR-018).
 *
 * The drain loop waits for the unacked counter to reach zero within the
 * `{ timeout }` budget; when the budget expires, the emitter closes the
 * client and whatever is still unacknowledged goes undelivered. Pre-fix,
 * that force-close resolved cleanly — indistinguishable from a clean
 * drain. Now it rejects with classified SHUTDOWN_TIMEOUT and
 * `dropped: { count }` — the counter's exact value (proven red before
 * the fix).
 *
 * ADR-021 inverted the disconnected case: it used to resolve clean
 * because the disk-backed store held pending messages for the next
 * session. With no disk store, nothing survives the process, so a
 * disconnected shutdown with unacknowledged messages reports the loss
 * exactly like a connected one. That inversion is pinned in
 * shutdown-drain.specs.js; this file covers the report itself and the
 * teardown-before-report ordering.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';

import { createEmitter } from '../emitter.js';
import { makeMockClient, fireConnect, testCodec } from './test-helpers.js';

describe( 'MQTT emitter lossy-shutdown reporting', function () {

    let mock;
    let emitter;

    beforeEach( function () {
        mock = makeMockClient( { manualAcks: true } );
    } );

    afterEach( async function () {
        if ( emitter ) {
            // Settle anything a test left stranded so teardown is clean.
            mock.publishCalls.forEach( ( call ) => call.cb() );
            // The shutdown outcome is latched: this returns
            // the first call's promise; the catch absorbs a recorded
            // lossy outcome during teardown.
            await Promise.resolve( emitter.shutdown() ).catch( () => undefined );
            emitter = null;
        }
    } );

    const makeEmitter = () => createEmitter( {
        brokerUrl: 'mqtt://localhost',
        connectGraceMs: 0,
        codec: testCodec,
        mqttConnectFn: () => mock.client
    } );

    it( 'rejects with SHUTDOWN_TIMEOUT and the exact undelivered count when the drain cannot complete', async function () {
        emitter = makeEmitter();
        fireConnect( mock.eventHandlers );

        // Two publishes whose acknowledgments never arrive: the drain
        // loop exhausts the whole budget and closes with unacked = 2.
        expect( emitter.publishNow( 'wink/a', { v: 1 } ).ok ).to.equal( true );
        expect( emitter.publishNow( 'wink/b', { v: 2 } ).ok ).to.equal( true );

        let thrown = null;
        await emitter.shutdown( { timeout: 300 } ).catch( ( err ) => {
            thrown = err;
        } );

        expect( thrown, 'force-close with undelivered messages must not resolve cleanly' ).to.be.an( 'error' );
        expect( thrown.code ).to.equal( 'SHUTDOWN_TIMEOUT' );
        expect( thrown.dropped ).to.deep.equal( { count: 2 } );

        // Settle the stranded callbacks before afterEach re-runs shutdown.
        mock.publishCalls.forEach( ( call ) => call.cb() );
    } );

    it( 'the client is still closed before the throw (teardown first, then the report)', async function () {
        emitter = makeEmitter();
        fireConnect( mock.eventHandlers );
        expect( emitter.publishNow( 'wink/a', { v: 1 } ).ok ).to.equal( true );

        await emitter.shutdown( { timeout: 300 } ).catch( () => undefined );

        expect( mock.endCalls.length, 'client.end must run before the loss report' ).to.be.at.least( 1 );

        mock.publishCalls.forEach( ( call ) => call.cb() );
    } );

    it( 'resolves cleanly when the drain completes (acknowledgments arrive mid-drain)', async function () {
        // The acknowledgments land while the drain loop is waiting, so
        // the loop genuinely runs before the counter reaches zero.
        emitter = makeEmitter();
        fireConnect( mock.eventHandlers );
        expect( emitter.publishNow( 'wink/a', { v: 1 } ).ok ).to.equal( true );
        expect( emitter.publishNow( 'wink/b', { v: 2 } ).ok ).to.equal( true );

        setTimeout( () => {
            mock.publishCalls.forEach( ( call ) => call.cb() );
        }, 60 );

        await emitter.shutdown( { timeout: 2000 } );

        expect( emitter.getPressure() ).to.equal( 0 );
    } );

} );

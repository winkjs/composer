// core/emitter-manager/mqtt/test/connect-grace.specs.js

/**
 * @fileoverview MQTT emitter — the first-connack grace in createEmitter.
 *
 * The factory waits for the client's first 'connect' event or a bounded
 * budget (`connectGraceMs`: config → MQTT_CONNECT_GRACE_MS env → 500 ms
 * default), whichever comes first, then hands back the handle. This file
 * pins the whole surface: the always-async return shape (a promise at
 * every grace, resolved without a wait at 0), the connect-first and
 * expiry-first paths, listener cleanup, the config precedence chain,
 * and the classified validation refusal. The grace replaced the wiring
 * layer's fixed `sleep(240)` — the workaround for the pre-connack loss
 * ADR-021 eliminated.
 *
 * Uses the shared mock client (never fires 'connect' on its own), so
 * every path is driven deliberately. Real-broker behavior is pinned in
 * e2e-mqtt-cold-start.specs.js and the slow recovery spec.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createEmitter } from '../emitter.js';
import { ENV_VARS } from '../../../env-vars.js';
import { makeMockClient, fireConnect, refusalOf, testCodec } from './test-helpers.js';
import { monotonicNow } from '../../../utils/clock/index.js';
import { TIMER_FLOOR_MARGIN_MS } from '../../../test/timer-floor.js';

describe( 'mqtt emitter — first-connack grace', function () {

    let mock;
    let emitter;

    const makeConfig = function ( overrides = {} ) {
        return {
            brokerUrl: 'mqtt://127.0.0.1',
            codec: testCodec,
            mqttConnectFn: () => mock.client,
            ...overrides
        };
    }; // makeConfig()

    beforeEach( function () {
        mock = makeMockClient();
        emitter = null;
    } );

    afterEach( async function () {
        if ( emitter ) {
            await Promise.resolve( emitter.shutdown() ).catch( () => undefined );
            emitter = null;
        }
        sinon.restore();
    } );

    describe( 'return shape', function () {

        it( 'grace 0 returns a promise that resolves without waiting for a connack', async function () {
            // The factory is async at every grace, as QuestDB's is. The
            // mock never fires 'connect', so a factory that waited on it
            // would hang here; grace 0 attaches no one-shot listener.
            const result = createEmitter( makeConfig( { connectGraceMs: 0 } ) );

            expect( typeof result.then ).to.equal( 'function' );
            emitter = await result;

            expect( emitter ).to.have.property( 'publishNow' );
            expect( emitter ).to.have.property( 'shutdown' );
            expect( emitter ).to.have.property( 'getHealth' );
            expect( emitter ).to.have.property( 'getPressure' );
            expect( emitter.getHealth().connected ).to.equal( false );
            expect( mock.client.once.called ).to.equal( false );
        } );

        it( 'grace > 0 returns a thenable resolving to the working handle', async function () {
            const result = createEmitter( makeConfig( { connectGraceMs: 1000 } ) );

            expect( typeof result.then ).to.equal( 'function' );

            fireConnect( mock.eventHandlers, mock.onceHandlers );
            emitter = await result;

            expect( emitter ).to.have.property( 'publishNow' );
            expect( emitter ).to.have.property( 'shutdown' );
            expect( emitter ).to.have.property( 'getHealth' );
            expect( emitter ).to.have.property( 'getPressure' );
        } );

    } );

    describe( 'connect-first path', function () {

        it( 'resolves promptly on connack, well under the budget, already connected', async function () {
            // A generous budget: if the factory waited it out instead of
            // resolving on the event, the elapsed assertion fails.
            const started = monotonicNow();
            const result = createEmitter( makeConfig( { connectGraceMs: 2000 } ) );

            setImmediate( () => fireConnect( mock.eventHandlers, mock.onceHandlers ) );
            emitter = await result;
            const elapsed = monotonicNow() - started;

            expect( elapsed ).to.be.below( 1000 );
            // Attach-order invariant: the permanent state handler runs
            // before the wait's one-shot, so a connect-resolved handle
            // already reports connected.
            expect( emitter.getHealth().connected ).to.equal( true );
        } );

        it( 'a connack-resolved handle keeps the permanent state machinery intact', async function () {
            const result = createEmitter( makeConfig( { connectGraceMs: 1000 } ) );
            fireConnect( mock.eventHandlers, mock.onceHandlers );
            emitter = await result;

            mock.eventHandlers.offline();
            expect( emitter.getHealth().connected ).to.equal( false );

            fireConnect( mock.eventHandlers, mock.onceHandlers );
            expect( emitter.getHealth().connected ).to.equal( true );
            expect( emitter.getHealth().stats.reconnects ).to.equal( 1 );
        } );

    } );

    describe( 'expiry path — the recovering posture', function () {

        it( 'resolves after the budget when connect never fires; the handle works and buffers', async function () {
            const started = monotonicNow();
            emitter = await createEmitter( makeConfig( { connectGraceMs: 30 } ) );
            const elapsed = monotonicNow() - started;

            expect( elapsed ).to.be.at.least( 30 - TIMER_FLOOR_MARGIN_MS );
            expect( emitter.getHealth().connected ).to.equal( false );

            // Recovering posture: the handle is fully functional — a
            // publish is accepted into the buffer, not refused.
            const publishResult = emitter.publishNow( 'test/topic', { value: 1 } );
            expect( publishResult ).to.deep.equal( { ok: true } );
            expect( mock.publishCalls.length ).to.equal( 1 );
        } );

        it( 'removes its one-shot listener on expiry — no leak', async function () {
            emitter = await createEmitter( makeConfig( { connectGraceMs: 30 } ) );

            expect( ( mock.onceHandlers.connect || [] ).length ).to.equal( 0 );
        } );

        it( 'a late connack after expiry still flips connected and is not a reconnect', async function () {
            emitter = await createEmitter( makeConfig( { connectGraceMs: 30 } ) );
            expect( emitter.getHealth().connected ).to.equal( false );

            fireConnect( mock.eventHandlers, mock.onceHandlers );

            expect( emitter.getHealth().connected ).to.equal( true );
            // The first connack is the first connack, however late — the
            // reconnects counter must not move.
            expect( emitter.getHealth().stats.reconnects ).to.equal( 0 );
        } );

    } );

    describe( 'config precedence — explicit → env → default', function () {

        it( 'explicit config beats the env value', async function () {
            sinon.stub( ENV_VARS, 'mqttConnectGraceMs' ).value( 30 );

            emitter = await createEmitter( makeConfig( { connectGraceMs: 0 } ) );

            // Env said 30; explicit 0 wins — no first-connack wait was
            // armed, so no one-shot listener exists.
            expect( mock.client.once.called ).to.equal( false );
        } );

        it( 'falls back to the env value when the key is omitted', async function () {
            sinon.stub( ENV_VARS, 'mqttConnectGraceMs' ).value( 30 );

            const started = monotonicNow();
            const result = createEmitter( makeConfig() );
            expect( typeof result.then ).to.equal( 'function' );

            emitter = await result;
            const elapsed = monotonicNow() - started;

            expect( elapsed ).to.be.at.least( 30 - TIMER_FLOOR_MARGIN_MS );
            expect( emitter.getHealth().connected ).to.equal( false );
        } );

        it( 'null falls through to the env value (?? semantics)', async function () {
            sinon.stub( ENV_VARS, 'mqttConnectGraceMs' ).value( 0 );

            emitter = await createEmitter( makeConfig( { connectGraceMs: null } ) );

            // Env said 0, so no wait was armed.
            expect( mock.client.once.called ).to.equal( false );
        } );

    } );

    describe( 'validation — classified, rejected before any side effect', function () {

        it( 'rejects every non-non-negative-integer shape with INVALID_CONFIG', async function () {
            const badValues = [ -1, 0.5, '500', true, NaN, Infinity ];

            for ( const bad of badValues ) {
                // eslint-disable-next-line no-await-in-loop
                const thrown = await refusalOf( createEmitter( makeConfig( { connectGraceMs: bad } ) ) );
                expect( thrown, `value: ${String( bad )}` ).to.be.an( 'error' );
                expect( thrown.code, `value: ${String( bad )}` ).to.equal( 'INVALID_CONFIG' );
                expect( thrown.message, `value: ${String( bad )}` ).to.contain( 'connectGraceMs' );
            }
            // The refusal is pre-side-effect: no client was ever created.
            expect( mock.client.on.called ).to.equal( false );
        } );

    } );

} );

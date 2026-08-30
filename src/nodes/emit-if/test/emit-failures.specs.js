// nodes/emit-if/test/emit-failures.specs.js

/**
 * @fileoverview emitIf publish-failure handling.
 *
 * Mirrors persistIf's write-failure suite (write-failures.specs.js) — the
 * two output gates share one failure model:
 * - No connectivity pre-check: the node publishes unconditionally and reads
 *   the `{ ok }` result (ADR-018 — during an MQTT disconnect the publish
 *   must still be accepted into the emitter's in-process buffer, not be
 *   skipped).
 * - Error returns surface message + code in the last* fields; never throw.
 * - Loud episodes: first failure per episode logs console.error; repeats
 *   stay quiet until a successful publish closes the episode. The first*
 *   fields keep the episode-opening error (the cause) and survive recovery.
 * - Status signals (helpers.js) ride the same episode fields.
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { describe, it, afterEach } from 'mocha';
import { init, update, reset } from '../index.js';
import { emitStatusSignal } from '../helpers.js';
import { createMockEmitter } from './test-helpers.js';

const FAIL_STORE = { ok: false, error: { code: 'STORAGE_FULL', message: 'store at pressure limit' } };
const FAIL_DOWN = { ok: false, error: { code: 'SHUTTING_DOWN', message: 'emitter is shutting down' } };
const OK = { ok: true };

const makeState = function ( emitter, predicate = ( _msg ) => true ) {
    const state = init( {
        nodeType: 'Emit If',
        name: 'loudEmit',
        predicate,
        target: 'mqtt',
        insightType: 'alert'
    } );
    state.emitter = emitter;
    state.topic = 'test/topic';
    return state;
};

describe( 'Emit-If Node — publish failures', function () {

    // A failed assertion between spy creation and its manual restore
    // must not leave console.error wrapped for the rest of the run.
    afterEach( function () {
        sinon.restore();
    } );

    describe( 'update() - publish result handling', function () {

        it( 'publishes without any connectivity pre-check (handle has no isConnected)', function () {
            const emitter = createMockEmitter();
            const state = makeState( emitter );

            update( state, { value: 1 } );

            expect( emitter.publishNow.calledOnce ).to.equal( true );
            expect( state.emissionCount ).to.equal( 1 );
            expect( state.emissionErrors ).to.equal( 0 );
        } );

        it( 'a publish failure surfaces message + code and does not count as an emission', function () {
            const emitter = createMockEmitter( FAIL_STORE );
            const state = makeState( emitter );

            const errorSpy = sinon.spy( console, 'error' );
            update( state, {} );
            errorSpy.restore();

            expect( state.emissionErrors ).to.equal( 1 );
            expect( state.emissionCount ).to.equal( 0 );
            expect( state.lastEmissionError ).to.equal( 'store at pressure limit' );
            expect( state.lastEmissionErrorCode ).to.equal( 'STORAGE_FULL' );
        } );

        it( 'predicate exception clears lastEmissionErrorCode (not part of adapter vocabulary)', function () {
            const emitter = createMockEmitter();
            const state = makeState( emitter, ( _msg ) => {
                throw new Error( 'predicate boom' );
            } );
            // Pre-seed a stale code as if a prior publish failure had set it.
            state.lastEmissionErrorCode = 'STORAGE_FULL';

            const errorSpy = sinon.spy( console, 'error' );
            update( state, {} );
            errorSpy.restore();

            expect( state.lastEmissionError ).to.equal( 'predicate boom' );
            expect( state.lastEmissionErrorCode ).to.equal( null );
        } );

        it( 'skips evaluation entirely when no emitter is wired (mirrors persistIf storage guard)', function () {
            // The spec validator requires a one-parameter predicate; the
            // stub is wrapped so its call count stays observable.
            const predicate = sinon.stub().returns( true );
            const state = makeState( null, ( msg ) => predicate( msg ) );

            const result = update( state, {} );

            expect( result ).to.equal( state );
            expect( predicate.called ).to.equal( false );
            expect( state.passCount ).to.equal( 1 );
            expect( state.emissionErrors ).to.equal( 0 );
        } );

    } );

    describe( 'update() - publish-failure episodes', function () {

        it( 'logs console.error once per episode, naming node, insightType, code and message', function () {
            const emitter = createMockEmitter( FAIL_STORE );
            const state = makeState( emitter );
            const errorSpy = sinon.spy( console, 'error' );

            update( state, {} );
            update( state, {} );

            errorSpy.restore();
            expect( errorSpy.callCount ).to.equal( 1 );
            const logged = errorSpy.firstCall.args[ 0 ];
            expect( logged ).to.include( 'winkComposer/emitIf' );
            expect( logged ).to.include( 'loudEmit' );
            expect( logged ).to.include( 'alert' );
            expect( logged ).to.include( 'STORAGE_FULL' );
            expect( logged ).to.include( 'store at pressure limit' );
        } );

        it( 'captures firstEmissionError/Code at episode start while last* keeps moving', function () {
            const emitter = createMockEmitter();
            emitter.publishNow = sinon.stub();
            emitter.publishNow.onCall( 0 ).returns( FAIL_STORE );
            emitter.publishNow.onCall( 1 ).returns( FAIL_DOWN );
            const state = makeState( emitter );
            const errorSpy = sinon.spy( console, 'error' );

            update( state, {} );
            update( state, {} );

            errorSpy.restore();
            expect( state.firstEmissionError ).to.equal( 'store at pressure limit' );
            expect( state.firstEmissionErrorCode ).to.equal( 'STORAGE_FULL' );
            expect( state.lastEmissionError ).to.equal( 'emitter is shutting down' );
            expect( state.lastEmissionErrorCode ).to.equal( 'SHUTTING_DOWN' );
        } );

        it( 'a successful publish closes the episode: next failure logs again and overwrites first*', function () {
            const emitter = createMockEmitter();
            emitter.publishNow = sinon.stub();
            emitter.publishNow.onCall( 0 ).returns( FAIL_STORE );
            emitter.publishNow.onCall( 1 ).returns( OK );
            emitter.publishNow.onCall( 2 ).returns( FAIL_DOWN );
            const state = makeState( emitter );
            const errorSpy = sinon.spy( console, 'error' );

            update( state, {} );   // episode 1 opens — logs
            update( state, {} );   // recovery — closes episode
            update( state, {} );   // episode 2 opens — logs again

            errorSpy.restore();
            expect( errorSpy.callCount ).to.equal( 2 );
            expect( state.firstEmissionError ).to.equal( 'emitter is shutting down' );
            expect( state.firstEmissionErrorCode ).to.equal( 'SHUTTING_DOWN' );
        } );

        it( 'first* fields survive recovery for post-mortem reads', function () {
            const emitter = createMockEmitter();
            emitter.publishNow = sinon.stub();
            emitter.publishNow.onCall( 0 ).returns( FAIL_STORE );
            emitter.publishNow.onCall( 1 ).returns( OK );
            const state = makeState( emitter );
            const errorSpy = sinon.spy( console, 'error' );

            update( state, {} );
            update( state, {} );

            errorSpy.restore();
            expect( state.emissionCount ).to.equal( 1 );
            expect( state.firstEmissionError ).to.equal( 'store at pressure limit' );
            expect( state.firstEmissionErrorCode ).to.equal( 'STORAGE_FULL' );
        } );

        it( 'init starts the episode fields empty', function () {
            const state = makeState( createMockEmitter() );

            expect( state.emitErrorLogged ).to.equal( false );
            expect( state.firstEmissionError ).to.equal( null );
            expect( state.firstEmissionErrorCode ).to.equal( null );
            expect( state.lastEmissionErrorCode ).to.equal( null );
        } );

        it( 'reset clears the episode fields', function () {
            const emitter = createMockEmitter( FAIL_STORE );
            const state = makeState( emitter );
            const errorSpy = sinon.spy( console, 'error' );
            update( state, {} );
            errorSpy.restore();

            reset( state );

            expect( state.emitErrorLogged ).to.equal( false );
            expect( state.firstEmissionError ).to.equal( null );
            expect( state.firstEmissionErrorCode ).to.equal( null );
            expect( state.lastEmissionErrorCode ).to.equal( null );
        } );

    } );

    describe( 'status signals ride the same failure episode', function () {

        it( 'a failed status-signal publish feeds the episode fields', function () {
            // Predicate returns false (no data publish), then throws — the
            // error-state transition emits a $disable status signal, and THAT
            // publish fails. The failure must land in the same fields.
            let shouldThrow = false;
            const emitter = createMockEmitter( FAIL_STORE );
            const state = makeState( emitter, ( _msg ) => {
                if ( shouldThrow ) {
                    throw new Error( 'predicate boom' );
                }
                return false;
            } );

            const errorSpy = sinon.spy( console, 'error' );
            update( state, {} );           // clean pass, no publish
            shouldThrow = true;
            update( state, {} );           // transition: status signal fails
            errorSpy.restore();

            expect( emitter.publishNow.calledOnce ).to.equal( true );
            expect( state.firstEmissionError ).to.equal( 'store at pressure limit' );
            expect( state.firstEmissionErrorCode ).to.equal( 'STORAGE_FULL' );
            // The predicate exception then takes the last* fields (it is the
            // later event), with the code cleared to null as always.
            expect( state.lastEmissionError ).to.equal( 'predicate boom' );
            expect( state.lastEmissionErrorCode ).to.equal( null );
            // Two errors counted: the failed signal and the predicate throw.
            expect( state.emissionErrors ).to.equal( 2 );
        } );

        it( 'returns silently when no emitter is wired (defensive guard for direct callers)', function () {
            // update() guards the emitter before its catch can reach this
            // helper, so the guard is exercised directly: the helper is
            // exported and must stay safe for any future caller.
            const state = makeState( null );

            expect( () => emitStatusSignal( state, true, 'reason' ) ).to.not.throw();
            expect( state.emissionErrors ).to.equal( 0 );
        } );

        it( 'counts a non-conformant failure return with the static fallback error', function () {
            // Contract guarantees { error } on ok:false. A missing error
            // used to be ignored — no counter moved, nothing logged. Now it
            // is counted as a failure with the fallback code, so a broken
            // adapter cannot fail silently.
            const emitter = createMockEmitter( { ok: false } );
            const state = makeState( emitter );

            const errorSpy = sinon.spy( console, 'error' );
            expect( () => emitStatusSignal( state, true, 'reason' ) ).to.not.throw();
            errorSpy.restore();

            expect( state.emissionErrors ).to.equal( 1 );
            expect( state.lastEmissionErrorCode ).to.equal( 'MALFORMED_RESULT' );
            expect( state.emitErrorLogged ).to.equal( true );
        } );

        it( 'a status-signal publish returning undefined cannot throw out of update()', function () {
            // Predicate throws → update()'s catch emits a status signal. A
            // non-conforming emitter returning undefined from THAT publish
            // used to raise a TypeError inside the catch — escaping
            // update() and killing the pipeline.
            const emitter = { publishNow: sinon.stub().returns( undefined ) };
            const state = makeState( emitter, ( _msg ) => {
                throw new Error( 'predicate boom' );
            } );

            const errorSpy = sinon.spy( console, 'error' );
            expect( () => update( state, {} ) ).to.not.throw();
            errorSpy.restore();

            expect( state.inErrorState ).to.equal( true );
            // Two errors counted: the malformed signal publish, then the
            // predicate throw (which takes the last* fields, code null).
            expect( state.emissionErrors ).to.equal( 2 );
            expect( state.firstEmissionErrorCode ).to.equal( 'MALFORMED_RESULT' );
            expect( state.lastEmissionError ).to.equal( 'predicate boom' );
            expect( state.lastEmissionErrorCode ).to.equal( null );
        } );

        it( 'a successful status signal does not disturb the episode fields', function () {
            let shouldThrow = true;
            const emitter = createMockEmitter();
            const state = makeState( emitter, ( _msg ) => {
                if ( shouldThrow ) {
                    throw new Error( 'predicate boom' );
                }
                return false;
            } );

            const errorSpy = sinon.spy( console, 'error' );
            update( state, {} );           // transition in: $disable signal, ok
            shouldThrow = false;
            update( state, {} );           // transition out: recovery signal, ok
            errorSpy.restore();

            expect( emitter.publishNow.callCount ).to.equal( 2 );
            expect( state.emitErrorLogged ).to.equal( false );
            expect( state.firstEmissionError ).to.equal( null );
            expect( state.firstEmissionErrorCode ).to.equal( null );
        } );

    } );

    describe( 'malformed publish results on the data path', function () {

        it( 'counts { ok: false } with no error object as a failure with the fallback code', function () {
            const emitter = createMockEmitter( { ok: false } );
            const state = makeState( emitter );

            const errorSpy = sinon.spy( console, 'error' );
            update( state, { value: 1 } );
            errorSpy.restore();

            expect( state.emissionCount ).to.equal( 0 );
            expect( state.emissionErrors ).to.equal( 1 );
            expect( state.lastEmissionErrorCode ).to.equal( 'MALFORMED_RESULT' );
            expect( state.firstEmissionErrorCode ).to.equal( 'MALFORMED_RESULT' );
            expect( errorSpy.callCount ).to.equal( 1 );
            expect( errorSpy.firstCall.args[ 0 ] ).to.include( 'MALFORMED_RESULT' );
            // A broken adapter is not a predicate episode.
            expect( state.inErrorState ).to.equal( false );
        } );

        it( 'a publishNow returning undefined is counted, never thrown', function () {
            const emitter = { publishNow: sinon.stub().returns( undefined ) };
            const state = makeState( emitter );

            const errorSpy = sinon.spy( console, 'error' );
            expect( () => update( state, { value: 1 } ) ).to.not.throw();
            errorSpy.restore();

            expect( state.emissionErrors ).to.equal( 1 );
            expect( state.lastEmissionErrorCode ).to.equal( 'MALFORMED_RESULT' );
            expect( state.inErrorState ).to.equal( false );
        } );

        it( 'episode suppression and recovery apply to malformed results', function () {
            const emitter = createMockEmitter( { ok: false } );
            const state = makeState( emitter );

            const errorSpy = sinon.spy( console, 'error' );
            update( state, { value: 1 } );                 // opens episode, logs
            update( state, { value: 2 } );                 // suppressed
            emitter.publishNow.returns( OK );
            update( state, { value: 3 } );                 // closes episode
            emitter.publishNow.returns( { ok: false } );
            update( state, { value: 4 } );                 // new episode logs again
            errorSpy.restore();

            expect( state.emissionErrors ).to.equal( 3 );
            expect( state.emissionCount ).to.equal( 1 );
            expect( errorSpy.callCount ).to.equal( 2 );
        } );

    } );

    describe( 'update() - throwing emitter (contract violation)', function () {

        // A conforming emitter never throws from publishNow — it answers
        // { ok } (ADR-018). A throwing emitter is a broken adapter. The
        // gate contains it in its own failure episode with the
        // framework-substituted MALFORMED_RESULT code, so the fault is
        // blamed on the adapter — never on the user's predicate, and
        // never escaped into the pipeline where it would cost the whole
        // message.

        it( 'contains a throwing publishNow in the adapter episode — never a predicate error', function () {
            const emitter = { publishNow: sinon.stub().throws( new Error( 'emitter exploded' ) ) };
            const state = makeState( emitter );

            const errorSpy = sinon.spy( console, 'error' );
            const run = function () {
                update( state, { value: 1 } );
            };
            expect( run ).to.not.throw();
            errorSpy.restore();

            expect( state.emissionCount ).to.equal( 0 );
            expect( state.emissionErrors ).to.equal( 1 );
            expect( state.lastEmissionErrorCode ).to.equal( 'MALFORMED_RESULT' );
            expect( state.lastEmissionError ).to.contain( 'threw' );
            expect( state.lastEmissionError ).to.contain( 'emitter exploded' );
            // Adapter fault, not user fault: the predicate episode is untouched.
            expect( state.inErrorState ).to.equal( false );
            expect( state.predicateErrorLogged ).to.equal( false );
            expect( errorSpy.callCount ).to.equal( 1 );
        } );

        it( 'closes the throw-opened episode on the next successful publish', function () {
            const emitter = { publishNow: sinon.stub() };
            emitter.publishNow.onFirstCall().throws( new Error( 'emitter exploded' ) );
            emitter.publishNow.returns( { ok: true } );
            const state = makeState( emitter );

            const errorSpy = sinon.spy( console, 'error' );
            update( state, { value: 1 } );
            update( state, { value: 2 } );
            errorSpy.restore();

            expect( state.emissionErrors ).to.equal( 1 );
            expect( state.emissionCount ).to.equal( 1 );
            expect( state.emitErrorLogged ).to.equal( false );
        } );

        it( 'contains the combined path: predicate throw plus throwing emitter in the status signal', function () {
            // Today's live double-throw: the predicate catch publishes a
            // status signal, and a throwing emitter there escapes
            // update() entirely. Both faults must be contained: the
            // predicate opens its episode, the adapter fault lands in
            // the emission episode.
            const emitter = { publishNow: sinon.stub().throws( new Error( 'emitter exploded' ) ) };
            const state = makeState( emitter, ( _msg ) => {
                throw new Error( 'predicate boom' );
            } );

            const errorSpy = sinon.spy( console, 'error' );
            const run = function () {
                update( state, { value: 1 } );
            };
            expect( run ).to.not.throw();
            errorSpy.restore();

            expect( state.inErrorState ).to.equal( true );
            // The first* fields keep the episode-opening cause (the
            // adapter fault from the signal publish); the last* fields
            // then carry the predicate fault that triggered it.
            expect( state.firstEmissionError ).to.contain( 'emitter exploded' );
            expect( state.firstEmissionErrorCode ).to.equal( 'MALFORMED_RESULT' );
            expect( state.lastEmissionError ).to.equal( 'predicate boom' );
        } );

    } );

} );

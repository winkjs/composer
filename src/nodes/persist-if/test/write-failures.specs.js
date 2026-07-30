// nodes/persist-if/test/write-failures.specs.js

/**
 * @fileoverview persistIf write-failure handling.
 *
 * Two concerns, split from persist-if.specs.js:
 * - Error returns: a storage `{ ok: false }` surfaces message + code in the
 *   last* fields and never throws into the pipeline.
 * - Loud episodes: a storage failure must reach a human, not just a state
 *   field (the 2026-06-10 incident: every failure absorbed into state, flow
 *   green). First failure per episode logs console.error; repeats stay quiet
 *   until a successful write closes the episode. The first* fields keep the
 *   episode-opening error — in a cascade the LAST error is the symptom and
 *   the FIRST is the cause — and survive recovery for post-mortem reads.
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { describe, it, afterEach } from 'mocha';
import { init, update, reset } from '../index.js';
import { createMockStorage } from './test-helpers.js';

describe( 'Persist-If Node — write failures', function () {

    // A failed assertion between spy creation and its manual restore
    // must not leave console.error wrapped for the rest of the run.
    afterEach( function () {
        sinon.restore();
    } );

    describe( 'update() - write errors', function () {

        it( 'increments persistErrors and surfaces error message + code when write returns error', function () {
            const storage = createMockStorage( {
                writeResult: {
                    ok: false,
                    error: { code: 'SEND_FAILED', message: 'simulated mock failure' }
                }
            } );
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = storage;

            const errorSpy = sinon.spy( console, 'error' );
            update( state, {} );
            errorSpy.restore();

            expect( state.persistErrors ).to.equal( 1 );
            expect( state.lastPersistError ).to.equal( 'simulated mock failure' );
            expect( state.lastPersistErrorCode ).to.equal( 'SEND_FAILED' );
            expect( state.persistCount ).to.equal( 0 );
        } );

        it( 'distinguishes INVALID_INSIGHT_TYPE from SEND_FAILED via lastPersistErrorCode', function () {
            const storage = createMockStorage( {
                writeResult: {
                    ok: false,
                    error: { code: 'INVALID_INSIGHT_TYPE', message: 'no plan for X' }
                }
            } );
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = storage;

            const errorSpy = sinon.spy( console, 'error' );
            update( state, {} );
            errorSpy.restore();

            expect( state.lastPersistErrorCode ).to.equal( 'INVALID_INSIGHT_TYPE' );
            // Sanity: a downstream observer can route on code alone, no
            // need to parse the message string.
        } );

        it( 'predicate exception clears lastPersistErrorCode (not part of adapter vocabulary)', function () {
            const storage = createMockStorage();
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => {
                    throw new Error( 'predicate boom' );
                },
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = storage;
            // Pre-seed a stale code as if a prior storage error had set it.
            state.lastPersistErrorCode = 'SEND_FAILED';

            update( state, {} );

            expect( state.lastPersistError ).to.equal( 'predicate boom' );
            expect( state.lastPersistErrorCode ).to.equal( null );
        } );

    } );

    describe( 'update() - write-failure episodes', function () {

        const FAIL_SEND = { ok: false, error: { code: 'SEND_FAILED', message: 'boom one' } };
        const FAIL_TYPE = { ok: false, error: { code: 'INVALID_INSIGHT_TYPE', message: 'boom two' } };
        const OK = { ok: true };

        const makeState = function ( storage ) {
            const state = init( {
                nodeType: 'Persist If',
                name: 'loudTest',
                predicate: ( _msg ) => true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = storage;
            return state;
        };

        it( 'logs console.error once per episode, naming node, insightType, code and message', function () {
            const storage = createMockStorage( { writeResult: FAIL_SEND } );
            const state = makeState( storage );
            const errorSpy = sinon.spy( console, 'error' );

            update( state, {} );
            update( state, {} );

            errorSpy.restore();
            expect( errorSpy.callCount ).to.equal( 1 );
            const logged = errorSpy.firstCall.args[ 0 ];
            expect( logged ).to.include( 'WinkComposer/persistIf' );
            expect( logged ).to.include( 'loudTest' );
            expect( logged ).to.include( 'temperature' );
            expect( logged ).to.include( 'SEND_FAILED' );
            expect( logged ).to.include( 'boom one' );
        } );

        it( 'captures firstPersistError/Code at episode start while last* keeps moving', function () {
            const storage = createMockStorage();
            storage.write = sinon.stub();
            storage.write.onCall( 0 ).returns( FAIL_SEND );
            storage.write.onCall( 1 ).returns( FAIL_TYPE );
            const state = makeState( storage );
            const errorSpy = sinon.spy( console, 'error' );

            update( state, {} );
            update( state, {} );

            errorSpy.restore();
            expect( state.firstPersistError ).to.equal( 'boom one' );
            expect( state.firstPersistErrorCode ).to.equal( 'SEND_FAILED' );
            expect( state.lastPersistError ).to.equal( 'boom two' );
            expect( state.lastPersistErrorCode ).to.equal( 'INVALID_INSIGHT_TYPE' );
        } );

        it( 'a successful write closes the episode: next failure logs again and overwrites first*', function () {
            const storage = createMockStorage();
            storage.write = sinon.stub();
            storage.write.onCall( 0 ).returns( FAIL_SEND );
            storage.write.onCall( 1 ).returns( OK );
            storage.write.onCall( 2 ).returns( FAIL_TYPE );
            const state = makeState( storage );
            const errorSpy = sinon.spy( console, 'error' );

            update( state, {} );   // episode 1 opens — logs
            update( state, {} );   // recovery — closes episode
            update( state, {} );   // episode 2 opens — logs again

            errorSpy.restore();
            expect( errorSpy.callCount ).to.equal( 2 );
            expect( state.firstPersistError ).to.equal( 'boom two' );
            expect( state.firstPersistErrorCode ).to.equal( 'INVALID_INSIGHT_TYPE' );
        } );

        it( 'first* fields survive recovery for post-mortem reads', function () {
            const storage = createMockStorage();
            storage.write = sinon.stub();
            storage.write.onCall( 0 ).returns( FAIL_SEND );
            storage.write.onCall( 1 ).returns( OK );
            const state = makeState( storage );
            const errorSpy = sinon.spy( console, 'error' );

            update( state, {} );
            update( state, {} );

            errorSpy.restore();
            expect( state.persistCount ).to.equal( 1 );
            expect( state.firstPersistError ).to.equal( 'boom one' );
            expect( state.firstPersistErrorCode ).to.equal( 'SEND_FAILED' );
        } );

        it( 'init starts the episode fields empty', function () {
            const state = makeState( createMockStorage() );

            expect( state.writeErrorLogged ).to.equal( false );
            expect( state.firstPersistError ).to.equal( null );
            expect( state.firstPersistErrorCode ).to.equal( null );
        } );

        it( 'reset clears the episode fields', function () {
            const storage = createMockStorage( { writeResult: FAIL_SEND } );
            const state = makeState( storage );
            const errorSpy = sinon.spy( console, 'error' );
            update( state, {} );
            errorSpy.restore();

            reset( state );

            expect( state.writeErrorLogged ).to.equal( false );
            expect( state.firstPersistError ).to.equal( null );
            expect( state.firstPersistErrorCode ).to.equal( null );
        } );

    } );

    describe( 'malformed write results', function () {

        const makeState = function ( storage ) {
            const state = init( {
                nodeType: 'Persist If',
                name: 'malformedTest',
                predicate: ( _msg ) => true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = storage;
            return state;
        };

        it( 'counts { ok: false } with no error object as a failure with the fallback code', function () {
            const storage = createMockStorage( { writeResult: { ok: false } } );
            const state = makeState( storage );

            const errorSpy = sinon.spy( console, 'error' );
            update( state, {} );
            errorSpy.restore();

            expect( state.persistCount ).to.equal( 0 );
            expect( state.persistErrors ).to.equal( 1 );
            expect( state.lastPersistErrorCode ).to.equal( 'MALFORMED_RESULT' );
            expect( state.firstPersistErrorCode ).to.equal( 'MALFORMED_RESULT' );
            expect( errorSpy.callCount ).to.equal( 1 );
            expect( errorSpy.firstCall.args[ 0 ] ).to.include( 'MALFORMED_RESULT' );
            // A broken adapter is not a predicate episode.
            expect( state.inErrorState ).to.equal( false );
        } );

        it( 'a write returning undefined is counted, never thrown', function () {
            const storage = { write: sinon.stub().returns( undefined ) };
            const state = makeState( storage );

            const errorSpy = sinon.spy( console, 'error' );
            expect( () => update( state, {} ) ).to.not.throw();
            errorSpy.restore();

            expect( state.persistErrors ).to.equal( 1 );
            expect( state.lastPersistErrorCode ).to.equal( 'MALFORMED_RESULT' );
            expect( state.inErrorState ).to.equal( false );
        } );

        it( 'episode suppression and recovery apply to malformed results', function () {
            const storage = createMockStorage( { writeResult: { ok: false } } );
            const state = makeState( storage );

            const errorSpy = sinon.spy( console, 'error' );
            update( state, {} );                        // opens episode, logs
            update( state, {} );                        // suppressed
            storage.write.returns( { ok: true } );
            update( state, {} );                        // closes episode
            storage.write.returns( { ok: false } );
            update( state, {} );                        // new episode logs again
            errorSpy.restore();

            expect( state.persistErrors ).to.equal( 3 );
            expect( state.persistCount ).to.equal( 1 );
            expect( errorSpy.callCount ).to.equal( 2 );
        } );

    } );

} );

// nodes/persist-if/test/persist-if.specs.js

/**
 * @fileoverview Tests for persistIf node
 *
 * Tests cover:
 * - Initialization and validation
 * - Predicate evaluation
 * - Storage write operations
 * - Statistics tracking
 * - Pass-through behavior
 * - Introspection metadata
 *
 * Write-failure handling (error returns, loud episodes) lives in
 * `write-failures.specs.js`; the shared mock storage factory in
 * `test-helpers.js`.
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { describe, it } from 'mocha';
import {
    init,
    update,
    publishTo,
    reset,
    recompute,
    getNodeType,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getCapabilities,
    getDSLMetadata
} from '../index.js';
import { createMockStorage } from './test-helpers.js';

// ============================================================================
// INITIALIZATION TESTS
// ============================================================================

describe( 'Persist-If Node', function () {

    describe( 'init()', function () {

        it( 'initializes with valid spec', function () {
            const state = init( {
                nodeType: 'Persist If',
                name: 'persister',
                predicate: ( msg ) => msg.persist === true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );

            expect( state.nodeType ).to.equal( 'Persist If' );
            expect( state.name ).to.equal( 'persister' );
            expect( state.predicate ).to.be.a( 'function' );
            expect( state.insightType ).to.equal( 'temperature' );
            expect( state.storageName ).to.equal( 'testStorage' );
        } );

        it( 'initializes statistics to zero', function () {
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'test',
                storageName: 'testStorage'
            } );

            expect( state.persistCount ).to.equal( 0 );
            expect( state.passCount ).to.equal( 0 );
            expect( state.persistErrors ).to.equal( 0 );
            expect( state.lastPersistTime ).to.equal( null );
            expect( state.lastPersistError ).to.equal( null );
        } );

        it( 'initializes error state to false', function () {
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'test',
                storageName: 'testStorage'
            } );

            expect( state.inErrorState ).to.equal( false );
        } );

        it( 'silently ignores a legacy timestampField key (pending: option-surface audit)', function () {
            // timestampField was removed 2026-07-21 — it was observability-only;
            // the stored row's time always comes from the insight type's
            // designatedTimestamp column. Node spec schemas do not arm
            // _propertyNames, so an unknown spec key passes validation silently
            // today. A pre-release option-surface audit is planned to add
            // unknown-key rejection to node specs; FLIP this test to assert
            // rejection when that lands.
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'test',
                storageName: 'testStorage',
                timestampField: 'eventTime'
            } );

            expect( state.timestampField ).to.equal( undefined );
        } );

        it( 'sets storage to null initially', function () {
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'test',
                storageName: 'testStorage'
            } );

            expect( state.storage ).to.equal( null );
        } );

        it( 'stores optional annotate function', function () {
            const annotate = ( msg ) => ( { ...msg, annotated: true } );
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'test',
                storageName: 'testStorage',
                annotate
            } );

            expect( state.annotate ).to.equal( annotate );
        } );

        it( 'sets annotate to null when not provided', function () {
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'test',
                storageName: 'testStorage'
            } );

            expect( state.annotate ).to.equal( null );
        } );

    } );

    // ========================================================================
    // SPEC VALIDATION TESTS
    // ========================================================================

    describe( 'spec validation', function () {

        it( 'throws on missing nodeType', function () {
            expect( () => init( {
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'test',
                storageName: 'testStorage'
            } ) ).to.throw();
        } );

        it( 'throws on wrong nodeType', function () {
            expect( () => init( {
                nodeType: 'WrongType',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'test',
                storageName: 'testStorage'
            } ) ).to.throw();
        } );

        it( 'throws on missing name', function () {
            expect( () => init( {
                nodeType: 'Persist If',
                predicate: ( _msg ) => true,
                insightType: 'test',
                storageName: 'testStorage'
            } ) ).to.throw();
        } );

        it( 'throws on invalid name (not identifier)', function () {
            expect( () => init( {
                nodeType: 'Persist If',
                name: '123-invalid',
                predicate: ( _msg ) => true,
                insightType: 'test',
                storageName: 'testStorage'
            } ) ).to.throw();
        } );

        it( 'throws on missing predicate', function () {
            expect( () => init( {
                nodeType: 'Persist If',
                name: 'test',
                insightType: 'test',
                storageName: 'testStorage'
            } ) ).to.throw();
        } );

        it( 'throws on non-function predicate', function () {
            expect( () => init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: 'not-a-function',
                insightType: 'test',
                storageName: 'testStorage'
            } ) ).to.throw();
        } );

        it( 'throws on wrong predicate arity (needs 1 param)', function () {
            expect( () => init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _a, _b ) => true,
                insightType: 'test',
                storageName: 'testStorage'
            } ) ).to.throw();
        } );

        it( 'throws on missing insightType', function () {
            expect( () => init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                storageName: 'testStorage'
            } ) ).to.throw();
        } );

        it( 'throws on missing storageName', function () {
            expect( () => init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'test'
            } ) ).to.throw();
        } );

        it( 'throws on non-function annotate', function () {
            expect( () => init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'test',
                storageName: 'testStorage',
                annotate: 'not a function'
            } ) ).to.throw();
        } );

        it( 'throws on wrong annotate arity (needs 1 param)', function () {
            expect( () => init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'test',
                storageName: 'testStorage',
                annotate: ( a, _b ) => a
            } ) ).to.throw();
        } );

    } );

    // ========================================================================
    // UPDATE - BASIC PERSISTENCE
    // ========================================================================

    describe( 'update() - basic persistence', function () {

        it( 'persists when predicate returns true', function () {
            const storage = createMockStorage();
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( msg ) => msg.persist === true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = storage;
            state.partitionId = 'sensor-001';

            update( state, { persist: true, value: 42 } );

            expect( storage.write.calledOnce ).to.equal( true );
            expect( storage.write.firstCall.args[ 0 ] ).to.equal( 'temperature' );
            expect( storage.write.firstCall.args[ 1 ] ).to.deep.equal( { persist: true, value: 42 } );
            expect( storage.write.firstCall.args[ 2 ] ).to.equal( 'sensor-001' );
        } );

        it( 'does not persist when predicate returns false', function () {
            const storage = createMockStorage();
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( msg ) => msg.persist === true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = storage;

            update( state, { persist: false, value: 42 } );

            expect( storage.write.called ).to.equal( false );
        } );

        it( 'increments persistCount on successful write', function () {
            const storage = createMockStorage();
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = storage;

            update( state, {} );
            update( state, {} );
            update( state, {} );

            expect( state.persistCount ).to.equal( 3 );
        } );

        it( 'updates lastPersistTime on successful write', function () {
            const storage = createMockStorage();
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = storage;

            const before = Date.now();
            update( state, {} );
            const after = Date.now();

            expect( state.lastPersistTime ).to.be.at.least( before );
            expect( state.lastPersistTime ).to.be.at.most( after );
        } );

        it( 'stamps lastPersistTime with the wall clock, never message time', function () {
            const clock = sinon.useFakeTimers( 1700000000000 );
            try {
                const storage = createMockStorage();
                const state = init( {
                    nodeType: 'Persist If',
                    name: 'test',
                    predicate: ( _msg ) => true,
                    insightType: 'temperature',
                    storageName: 'testStorage'
                } );
                state.storage = storage;

                // The message carries a DIFFERENT time — the stamp must be
                // the wall clock, proving message time plays no part.
                update( state, { eventTime: 1600000000000, value: 42 } );

                expect( state.lastPersistTime ).to.equal( 1700000000000 );
            } finally {
                clock.restore();
            }
        } );

        it( 'increments passCount on every update', function () {
            const storage = createMockStorage();
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( msg ) => msg.persist === true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = storage;

            update( state, { persist: true } );
            update( state, { persist: false } );
            update( state, { persist: true } );

            expect( state.passCount ).to.equal( 3 );
        } );

        it( 'always returns state (pass-through)', function () {
            const storage = createMockStorage();
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( msg ) => msg.persist,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = storage;

            const result1 = update( state, { persist: true } );
            const result2 = update( state, { persist: false } );

            expect( result1 ).to.equal( state );
            expect( result2 ).to.equal( state );
        } );

    } );

    // ========================================================================
    // UPDATE - NO STORAGE
    // ========================================================================

    describe( 'update() - no storage', function () {

        it( 'handles missing storage gracefully', function () {
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            // No storage set

            const result = update( state, {} );

            expect( result ).to.equal( state );
            expect( state.persistCount ).to.equal( 0 );
        } );

        it( 'still increments passCount without storage', function () {
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );

            update( state, {} );
            update( state, {} );

            expect( state.passCount ).to.equal( 2 );
        } );

    } );

    // ========================================================================
    // UPDATE - PREDICATE ERRORS
    // ========================================================================

    describe( 'update() - annotate record shaping', function () {

        it( 'writes the annotated record, not the message', function () {
            const storage = createMockStorage();
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'event',
                storageName: 'testStorage',
                annotate: ( msg ) => ( { eventType: 'signFlip', value: msg.activePower } )
            } );
            state.storage = storage;

            update( state, { activePower: -42 } );

            expect( storage.write.firstCall.args[ 1 ] ).to.deep.equal( {
                eventType: 'signFlip',
                value: -42
            } );
            expect( state.persistCount ).to.equal( 1 );
        } );

        it( 'writes the original message when annotate is not provided', function () {
            const storage = createMockStorage();
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'event',
                storageName: 'testStorage'
            } );
            state.storage = storage;
            const msg = { activePower: -42 };

            update( state, msg );

            expect( storage.write.firstCall.args[ 1 ] ).to.equal( msg );
        } );

        it( 'does not call annotate when the predicate returns false', function () {
            const storage = createMockStorage();
            const annotateSpy = sinon.stub().returns( {} );
            const annotate = ( msg ) => annotateSpy( msg );   // spy wrapped to satisfy arity validation
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => false,
                insightType: 'event',
                storageName: 'testStorage',
                annotate
            } );
            state.storage = storage;

            update( state, {} );

            expect( annotateSpy.called ).to.equal( false );
            expect( storage.write.called ).to.equal( false );
        } );

        it( 'annotate exception joins the predicate error episode and skips the write', function () {
            const storage = createMockStorage();
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'event',
                storageName: 'testStorage',
                annotate: ( _msg ) => {
                    throw new Error( 'annotate boom' );
                }
            } );
            state.storage = storage;

            update( state, {} );

            expect( state.inErrorState ).to.equal( true );
            expect( state.persistErrors ).to.equal( 1 );
            expect( state.lastPersistError ).to.equal( 'annotate boom' );
            expect( state.lastPersistErrorCode ).to.equal( null );
            expect( storage.write.called ).to.equal( false );
            expect( state.persistCount ).to.equal( 0 );
        } );

        it( 'rejects a non-object annotate return inside the node error episode (not SEND_FAILED)', function () {
            const storage = createMockStorage();
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'event',
                storageName: 'testStorage',
                annotate: ( _msg ) => null
            } );
            state.storage = storage;

            update( state, {} );

            expect( state.inErrorState ).to.equal( true );
            expect( state.persistErrors ).to.equal( 1 );
            expect( state.lastPersistError ).to.equal( 'annotate must return an object, got null' );
            expect( state.lastPersistErrorCode ).to.equal( null );   // a flow bug, not an adapter failure
            expect( storage.write.called ).to.equal( false );
        } );

        it( 'rejects an array annotate return (typeof object, still not a record)', function () {
            const storage = createMockStorage();
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'event',
                storageName: 'testStorage',
                annotate: ( _msg ) => [ 1, 2, 3 ]
            } );
            state.storage = storage;

            update( state, {} );

            expect( state.inErrorState ).to.equal( true );
            expect( state.lastPersistError ).to.equal( 'annotate must return an object, got array' );
            expect( storage.write.called ).to.equal( false );
        } );

        it( 'rejects a primitive annotate return with the offending type named', function () {
            const storage = createMockStorage();
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'event',
                storageName: 'testStorage',
                annotate: ( _msg ) => 42
            } );
            state.storage = storage;

            update( state, {} );

            expect( state.lastPersistError ).to.equal( 'annotate must return an object, got number' );
            expect( storage.write.called ).to.equal( false );
        } );

        it( 'recovers from an annotate error episode on the next clean evaluation', function () {
            let shouldThrow = true;
            const storage = createMockStorage();
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'event',
                storageName: 'testStorage',
                annotate: ( msg ) => {
                    if ( shouldThrow ) {
                        throw new Error( 'annotate boom' );
                    }
                    return { shaped: true, value: msg.value };
                }
            } );
            state.storage = storage;

            update( state, { value: 1 } );  // Enters error state
            expect( state.inErrorState ).to.equal( true );

            shouldThrow = false;
            update( state, { value: 2 } );  // Recovers and persists
            expect( state.inErrorState ).to.equal( false );
            expect( state.persistCount ).to.equal( 1 );
            expect( storage.write.firstCall.args[ 1 ] ).to.deep.equal( { shaped: true, value: 2 } );
        } );

    } );

    describe( 'update() - predicate error handling', function () {

        it( 'increments persistErrors on predicate exception', function () {
            const storage = createMockStorage();
            const throwingPredicate = function ( _msg ) {
                throw new Error( 'Test error' );
            };
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: throwingPredicate,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = storage;

            update( state, {} );

            expect( state.persistErrors ).to.equal( 1 );
            expect( state.lastPersistError ).to.equal( 'Test error' );
        } );

        it( 'enters error state on first exception', function () {
            const storage = createMockStorage();
            const throwingPredicate = function ( _msg ) {
                throw new Error( 'Test error' );
            };
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: throwingPredicate,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = storage;

            expect( state.inErrorState ).to.equal( false );
            update( state, {} );
            expect( state.inErrorState ).to.equal( true );
        } );

        it( 'clears error state on successful evaluation', function () {
            let shouldThrow = true;
            const storage = createMockStorage();
            const conditionalPredicate = function ( _msg ) {
                if ( shouldThrow ) {
                    throw new Error( 'Error' );
                }
                return true;
            };
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: conditionalPredicate,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = storage;

            update( state, {} );  // Enters error state
            expect( state.inErrorState ).to.equal( true );

            shouldThrow = false;
            update( state, {} );  // Recovers
            expect( state.inErrorState ).to.equal( false );
        } );

        it( 'always returns state even on error', function () {
            const throwingPredicate = function ( _msg ) {
                throw new Error( 'Test error' );
            };
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: throwingPredicate,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = createMockStorage();

            const result = update( state, {} );
            expect( result ).to.equal( state );
        } );

        it( 'does not write to storage on predicate error', function () {
            const storage = createMockStorage();
            const throwingPredicate = function ( _msg ) {
                throw new Error( 'Test error' );
            };
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: throwingPredicate,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );
            state.storage = storage;

            update( state, {} );

            expect( storage.write.called ).to.equal( false );
        } );

        it( 'logs predicate error to console on first exception', function () {
            const stub = sinon.stub( console, 'error' );
            try {
                const storage = createMockStorage();
                const throwingPredicate = function ( _msg ) {
                    throw new Error( 'predicate threw exception' );
                };
                const state = init( {
                    nodeType: 'Persist If',
                    name: 'test',
                    predicate: throwingPredicate,
                    insightType: 'temperature',
                    storageName: 'testStorage'
                } );
                state.storage = storage;

                update( state, {} );

                expect( stub.calledOnce ).to.equal( true );
                expect( stub.firstCall.args[ 0 ] ).to.include( 'predicate threw exception' );
            } finally {
                stub.restore();
            }
        } );

        it( 'suppresses log on repeated exceptions', function () {
            const stub = sinon.stub( console, 'error' );
            try {
                const storage = createMockStorage();
                const throwingPredicate = function ( _msg ) {
                    throw new Error( 'repeated error' );
                };
                const state = init( {
                    nodeType: 'Persist If',
                    name: 'test',
                    predicate: throwingPredicate,
                    insightType: 'temperature',
                    storageName: 'testStorage'
                } );
                state.storage = storage;

                update( state, {} );
                update( state, {} );

                expect( stub.calledOnce ).to.equal( true );
            } finally {
                stub.restore();
            }
        } );

        it( 'logs again after recovery', function () {
            const stub = sinon.stub( console, 'error' );
            try {
                let shouldThrow = true;
                const storage = createMockStorage();
                const conditionalPredicate = function ( _msg ) {
                    if ( shouldThrow ) {
                        throw new Error( 'intermittent error' );
                    }
                    return true;
                };
                const state = init( {
                    nodeType: 'Persist If',
                    name: 'test',
                    predicate: conditionalPredicate,
                    insightType: 'temperature',
                    storageName: 'testStorage'
                } );
                state.storage = storage;

                // First error — logs
                update( state, {} );
                expect( stub.calledOnce ).to.equal( true );

                // Recovery — clears inErrorState
                shouldThrow = false;
                update( state, {} );
                expect( state.inErrorState ).to.equal( false );

                // Second error — logs again
                shouldThrow = true;
                update( state, {} );
                expect( stub.calledTwice ).to.equal( true );
            } finally {
                stub.restore();
            }
        } );

    } );

    // ========================================================================
    // PUBLISH-TO
    // ========================================================================

    describe( 'publishTo()', function () {

        it( 'does not modify message (pass-through)', function () {
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );

            const msg = { original: 'data' };
            publishTo( state, msg );

            expect( Object.keys( msg ) ).to.deep.equal( [ 'original' ] );
        } );

    } );

    // ========================================================================
    // RESET
    // ========================================================================

    describe( 'reset()', function () {

        it( 'resets statistics to zero', function () {
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );

            state.persistCount = 10;
            state.passCount = 20;
            state.persistErrors = 5;
            state.lastPersistTime = Date.now();
            state.lastPersistError = 'Some error';
            state.inErrorState = true;

            reset( state );

            expect( state.persistCount ).to.equal( 0 );
            expect( state.passCount ).to.equal( 0 );
            expect( state.persistErrors ).to.equal( 0 );
            expect( state.lastPersistTime ).to.equal( null );
            expect( state.lastPersistError ).to.equal( null );
            expect( state.inErrorState ).to.equal( false );
        } );

        it( 'returns state', function () {
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );

            // ADR-004 reset template returns true (parity with emitIf,
            // review decision 3).
            const result = reset( state );
            expect( result ).to.equal( true );
        } );

        it( 'clears error suppression flag', function () {
            const state = init( {
                nodeType: 'Persist If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'temperature',
                storageName: 'testStorage'
            } );

            state.predicateErrorLogged = true;
            reset( state );
            expect( state.predicateErrorLogged ).to.equal( false );
        } );

    } );

    // ========================================================================
    // RECOMPUTE
    // ========================================================================

    describe( 'recompute()', function () {

        it( 'returns true (no numerical state to stabilize)', function () {
            const result = recompute();
            expect( result ).to.equal( true );
        } );

    } );

    // ========================================================================
    // INTROSPECTION
    // ========================================================================

    describe( 'introspect accessors', function () {

        it( 'getNodeType() returns "Persist If"', function () {
            expect( getNodeType() ).to.equal( 'Persist If' );
        } );

        it( 'getSupportedStats() returns empty array', function () {
            const stats = getSupportedStats();
            expect( stats ).to.be.an( 'array' );
            expect( stats ).to.have.length( 0 );
        } );

        it( 'getStatDescriptions() returns empty object', function () {
            const descriptions = getStatDescriptions();
            expect( descriptions ).to.be.an( 'object' );
            expect( Object.keys( descriptions ) ).to.have.length( 0 );
        } );

        it( 'getSupportedControlMethods() returns empty object', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.be.an( 'object' );
            expect( Object.keys( methods ) ).to.have.length( 0 );
        } );

        it( 'getCapabilities() returns description and features', function () {
            const caps = getCapabilities();
            expect( caps ).to.have.property( 'description' );
            expect( caps ).to.have.property( 'features' );
            expect( caps.features ).to.be.an( 'array' );
            expect( caps.features.length ).to.be.greaterThan( 0 );
        } );

        it( 'getSupportedStats() returns defensive copy', function () {
            const stats1 = getSupportedStats();
            const stats2 = getSupportedStats();
            expect( stats1 ).to.not.equal( stats2 );
        } );

        it( 'getCapabilities() returns defensive copy', function () {
            const caps1 = getCapabilities();
            const caps2 = getCapabilities();
            expect( caps1 ).to.not.equal( caps2 );
            expect( caps1.features ).to.not.equal( caps2.features );
        } );

    } );

    // ========================================================================
    // DSL METADATA
    // ========================================================================

    describe( 'getDSLMetadata() and buildSpec', function () {

        it( 'returns DSL metadata with specSchema', function () {
            const meta = getDSLMetadata();
            expect( meta ).to.have.property( 'specSchema' );
            expect( meta ).to.have.property( 'buildSpec' );
        } );

        it( 'specSchema includes required fields', function () {
            const { specSchema } = getDSLMetadata();
            expect( specSchema ).to.have.property( 'nodeType' );
            expect( specSchema ).to.have.property( 'name' );
            expect( specSchema ).to.have.property( 'predicate' );
            expect( specSchema ).to.have.property( 'insightType' );
            expect( specSchema ).to.have.property( 'storageName' );
        } );

        it( 'buildSpec creates valid spec', function () {
            const { buildSpec } = getDSLMetadata();
            const pred = ( msg ) => msg.persist;
            const spec = buildSpec( 'myPersister', pred, {
                insightType: 'temperature',
                storageName: 'testStorage'
            } );

            expect( spec.nodeType ).to.equal( 'Persist If' );
            expect( spec.name ).to.equal( 'myPersister' );
            expect( spec.predicate ).to.equal( pred );
            expect( spec.insightType ).to.equal( 'temperature' );
        } );

        it( 'built spec initializes successfully', function () {
            const { buildSpec } = getDSLMetadata();
            const spec = buildSpec( 'validPersister', ( _msg ) => true, {
                insightType: 'metrics',
                storageName: 'testStorage'
            } );
            const state = init( spec );

            expect( state.nodeType ).to.equal( 'Persist If' );
        } );

    } );

} );

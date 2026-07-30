// nodes/persistence-check/test/persistence-check.specs.js

import { expect } from 'chai';
import sinon from 'sinon';
import { describe, it, beforeEach, afterEach } from 'mocha';
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
    getDSLMetadata,
    DEFAULT_OPTIONS
} from '../index.js';

describe( 'Persistence-Check Node', function () {

    describe( 'init()', function () {
        it( 'initializes with valid spec', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'stable',
                predicate: ( msg ) => msg.value > 50,
                stats: { persistenceConfirmed: { storeAs: 'isStable' } }
            } );

            expect( state.nodeType ).to.equal( 'Persistence Check' );
            expect( state.predicate ).to.be.a( 'function' );
            expect( state.stats ).to.deep.equal( { persistenceConfirmed: { storeAs: 'isStable' } } );
        } );

        it( 'applies default minVotes (3)', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            expect( state.minVotes ).to.equal( 3 );
            expect( state.minVotes ).to.equal( DEFAULT_OPTIONS.minVotes );
        } );

        it( 'applies default outOfTotal (5)', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            expect( state.outOfTotal ).to.equal( 5 );
            expect( state.outOfTotal ).to.equal( DEFAULT_OPTIONS.outOfTotal );
        } );

        it( 'accepts custom minVotes', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } },
                minVotes: 7,
                outOfTotal: 10  // Must be >= minVotes
            } );

            expect( state.minVotes ).to.equal( 7 );
        } );

        it( 'accepts custom outOfTotal', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } },
                outOfTotal: 10
            } );

            expect( state.outOfTotal ).to.equal( 10 );
        } );

        it( 'initializes voting counters to zero', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            expect( state.voteCount ).to.equal( 0 );
            expect( state.unvoteCount ).to.equal( 0 );
        } );

        it( 'initializes persistenceConfirmed to false', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            expect( state.persistenceConfirmed ).to.equal( false );
        } );

        it( 'initializes disable to false', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            expect( state.disable ).to.equal( false );
        } );
    } );

    describe( 'spec validation', function () {
        it( 'throws on missing nodeType', function () {
            expect( () => init( {
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } ) ).to.throw();
        } );

        it( 'throws on wrong nodeType', function () {
            expect( () => init( {
                nodeType: 'WrongType',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } ) ).to.throw();
        } );

        it( 'throws on missing name', function () {
            expect( () => init( {
                nodeType: 'Persistence Check',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } ) ).to.throw();
        } );

        it( 'throws on invalid name', function () {
            expect( () => init( {
                nodeType: 'Persistence Check',
                name: '123-invalid',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } ) ).to.throw();
        } );

        it( 'throws on missing predicate', function () {
            expect( () => init( {
                nodeType: 'Persistence Check',
                name: 'test',
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } ) ).to.throw();
        } );

        it( 'throws on non-function predicate', function () {
            expect( () => init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: 'not-a-function',
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } ) ).to.throw();
        } );

        it( 'throws on wrong predicate arity', function () {
            const twoParamPredicate = function ( _a, _b ) {
                return true;
            };
            expect( () => init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: twoParamPredicate,  // 2 params, needs 1
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } ) ).to.throw();
        } );

        it( 'throws on missing stats', function () {
            expect( () => init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true
            } ) ).to.throw();
        } );

        it( 'throws on invalid stat name', function () {
            expect( () => init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { invalidStat: { storeAs: 'field' } }
            } ) ).to.throw();
        } );

        it( 'throws on non-positive minVotes', function () {
            expect( () => init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } },
                minVotes: 0
            } ) ).to.throw();
        } );

        it( 'throws on non-positive outOfTotal', function () {
            expect( () => init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } },
                outOfTotal: 0
            } ) ).to.throw();
        } );

        it( 'throws when minVotes > outOfTotal', function () {
            expect( () => init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } },
                minVotes: 6,
                outOfTotal: 5
            } ) ).to.throw();
        } );

        it( 'accepts minVotes = outOfTotal', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } },
                minVotes: 5,
                outOfTotal: 5
            } );
            expect( state.minVotes ).to.equal( 5 );
            expect( state.outOfTotal ).to.equal( 5 );
        } );
    } );

    describe( 'update() - voting mechanism', function () {
        it( 'increments voteCount when predicate returns true', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( msg ) => msg.vote === true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            update( state, { vote: true } );
            expect( state.voteCount ).to.equal( 1 );

            update( state, { vote: true } );
            expect( state.voteCount ).to.equal( 2 );
        } );

        it( 'increments unvoteCount when predicate returns false', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( msg ) => msg.vote === true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            update( state, { vote: false } );
            expect( state.unvoteCount ).to.equal( 1 );

            update( state, { vote: false } );
            expect( state.unvoteCount ).to.equal( 2 );
        } );

        it( 'sets persistenceConfirmed when voteCount >= minVotes', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( msg ) => msg.vote,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } },
                minVotes: 3,
                outOfTotal: 5
            } );

            // First two votes - not confirmed yet
            update( state, { vote: true } );
            update( state, { vote: true } );
            expect( state.persistenceConfirmed ).to.equal( false );

            // Third vote - confirmed!
            update( state, { vote: true } );
            expect( state.persistenceConfirmed ).to.equal( true );
        } );

        it( 'resets counters after confirmation', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( msg ) => msg.vote,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } },
                minVotes: 2,
                outOfTotal: 3
            } );

            update( state, { vote: true } );
            update( state, { vote: true } );  // Confirmed

            expect( state.voteCount ).to.equal( 0 );
            expect( state.unvoteCount ).to.equal( 0 );
        } );

        it( 'resets counters when window completes without confirmation', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( msg ) => msg.vote,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } },
                minVotes: 3,
                outOfTotal: 5
            } );

            // 2 votes, 3 unvotes = window complete, not confirmed
            update( state, { vote: true } );
            update( state, { vote: true } );
            update( state, { vote: false } );
            update( state, { vote: false } );
            update( state, { vote: false } );

            expect( state.voteCount ).to.equal( 0 );
            expect( state.unvoteCount ).to.equal( 0 );
            expect( state.persistenceConfirmed ).to.equal( false );
        } );
    } );

    describe( 'update() - early termination', function () {
        it( 'resets early when success becomes mathematically impossible', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( msg ) => msg.vote,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } },
                minVotes: 4,
                outOfTotal: 5
            } );

            // Need 4 out of 5, after 2 unvotes it's impossible
            update( state, { vote: false } );
            expect( state.voteCount ).to.equal( 0 );
            expect( state.unvoteCount ).to.equal( 1 );

            update( state, { vote: false } );
            // Now impossible: 0 votes + 3 remaining < 4 needed
            expect( state.voteCount ).to.equal( 0 );
            expect( state.unvoteCount ).to.equal( 0 );  // Reset
        } );

        it( 'continues if success still possible', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( msg ) => msg.vote,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } },
                minVotes: 3,
                outOfTotal: 5
            } );

            // 1 unvote - still possible with 4 remaining
            update( state, { vote: false } );
            expect( state.unvoteCount ).to.equal( 1 );

            // 1 vote - still possible
            update( state, { vote: true } );
            expect( state.voteCount ).to.equal( 1 );
            expect( state.unvoteCount ).to.equal( 1 );
        } );
    } );

    describe( 'update() - predicate error handling', function () {
        let consoleStub;

        beforeEach( function () {
            consoleStub = sinon.stub( console, 'error' );
        } );

        afterEach( function () {
            consoleStub.restore();
        } );

        it( 'treats exception as false vote', function () {
            const throwingPredicate = function ( _msg ) {
                throw new Error( 'Test error' );
            };
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: throwingPredicate,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            update( state, {} );

            expect( state.unvoteCount ).to.equal( 1 );
            expect( state.voteCount ).to.equal( 0 );
        } );

        it( 'logs predicate errors', function () {
            const throwingPredicate = function ( _msg ) {
                throw new Error( 'Test error' );
            };
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: throwingPredicate,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            update( state, {} );

            expect( consoleStub.calledOnce ).to.equal( true );
            expect( consoleStub.firstCall.args[ 0 ] ).to.include( 'predicate threw exception' );
        } );

        it( 'suppresses log on repeated exceptions', function () {
            const throwingPredicate = function ( _msg ) {
                throw new Error( 'repeated error' );
            };
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'suppression',
                predicate: throwingPredicate,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            update( state, {} );
            update( state, {} );
            update( state, {} );

            expect( consoleStub.calledOnce ).to.equal( true );
        } );

        it( 'logs again after recovery', function () {
            let shouldThrow = true;
            const conditionalPredicate = function ( _msg ) {
                if ( shouldThrow ) {
                    throw new Error( 'intermittent error' );
                }
                return true;
            };
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'recovery',
                predicate: conditionalPredicate,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            // First error — logs
            update( state, {} );
            expect( consoleStub.calledOnce ).to.equal( true );

            // Recovery
            shouldThrow = false;
            update( state, {} );

            // Second error — logs again (new episode)
            shouldThrow = true;
            update( state, {} );
            expect( consoleStub.calledTwice ).to.equal( true );
        } );
    } );

    describe( 'update() - disable behavior', function () {
        it( 'returns state early when disabled', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            state.disable = true;
            const result = update( state, {} );

            expect( result ).to.equal( state );
            expect( state.voteCount ).to.equal( 0 );  // Not incremented
        } );

        it( 'does not evaluate predicate when disabled', function () {
            let predicateCalled = false;
            const trackingPredicate = function ( _msg ) {
                predicateCalled = true;
                return true;
            };
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: trackingPredicate,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            state.disable = true;
            update( state, {} );

            expect( predicateCalled ).to.equal( false );
        } );
    } );

    describe( 'update() - realistic scenarios', function () {
        it( 'handles 3 of 5 voting correctly', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( msg ) => msg.stable,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } },
                minVotes: 3,
                outOfTotal: 5
            } );

            // Pattern: vote, unvote, vote, vote -> confirmed on 3rd vote
            update( state, { stable: true } );   // voteCount = 1
            update( state, { stable: false } );  // unvoteCount = 1
            update( state, { stable: true } );   // voteCount = 2
            update( state, { stable: true } );   // voteCount = 3 -> confirmed!

            expect( state.persistenceConfirmed ).to.equal( true );
        } );

        it( 'handles strict 5 of 5 voting', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( msg ) => msg.stable,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } },
                minVotes: 5,
                outOfTotal: 5
            } );

            // All 5 must be true
            for ( let i = 0; i < 4; i += 1 ) {
                update( state, { stable: true } );
                expect( state.persistenceConfirmed ).to.equal( false );
            }

            update( state, { stable: true } );  // 5th vote
            expect( state.persistenceConfirmed ).to.equal( true );
        } );

        it( 'handles lenient 1 of 5 voting', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( msg ) => msg.alert,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } },
                minVotes: 1,
                outOfTotal: 5
            } );

            // First true vote confirms immediately
            update( state, { alert: true } );
            expect( state.persistenceConfirmed ).to.equal( true );
        } );

        it( 'handles repeated confirmation cycles', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( msg ) => msg.stable,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } },
                minVotes: 2,
                outOfTotal: 3
            } );

            // First cycle: confirmed
            update( state, { stable: true } );
            update( state, { stable: true } );
            expect( state.persistenceConfirmed ).to.equal( true );

            // Counters should be reset
            expect( state.voteCount ).to.equal( 0 );

            // After publishTo, persistenceConfirmed resets
            publishTo( state, {} );

            // Second cycle: not confirmed (too many false)
            update( state, { stable: false } );
            update( state, { stable: false } );
            // Mathematical impossibility - reset
            expect( state.persistenceConfirmed ).to.equal( false );
        } );
    } );

    describe( 'publishTo()', function () {
        it( 'publishes persistenceConfirmed to message', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'isConfirmed' } }
            } );

            state.persistenceConfirmed = true;
            const msg = {};
            publishTo( state, msg );

            expect( msg.isConfirmed ).to.equal( true );
        } );

        it( 'resets persistenceConfirmed after publishing', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'isConfirmed' } }
            } );

            state.persistenceConfirmed = true;
            publishTo( state, {} );

            expect( state.persistenceConfirmed ).to.equal( false );
        } );

        it( 'skips publishing when disabled', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'isConfirmed' } }
            } );

            state.disable = true;
            state.persistenceConfirmed = true;
            const msg = {};
            publishTo( state, msg );

            expect( msg.isConfirmed ).to.equal( undefined );
        } );

        it( 'uses correct storeAs field name', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'myCustomField' } }
            } );

            state.persistenceConfirmed = true;
            const msg = {};
            publishTo( state, msg );

            expect( msg.myCustomField ).to.equal( true );
            expect( msg.persistenceConfirmed ).to.equal( undefined );
        } );
    } );

    describe( 'reset()', function () {
        it( 'resets voting counters', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            state.voteCount = 5;
            state.unvoteCount = 3;
            reset( state );

            expect( state.voteCount ).to.equal( 0 );
            expect( state.unvoteCount ).to.equal( 0 );
        } );

        it( 'resets persistenceConfirmed', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            state.persistenceConfirmed = true;
            reset( state );

            expect( state.persistenceConfirmed ).to.equal( false );
        } );

        it( 'returns state', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            const result = reset( state );
            expect( result ).to.equal( state );
        } );

        it( 'clears error suppression flag', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'test',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            state.predicateErrorLogged = true;
            reset( state );
            expect( state.predicateErrorLogged ).to.equal( false );
        } );
    } );

    describe( 'recompute()', function () {
        it( 'returns true', function () {
            expect( recompute() ).to.equal( true );
        } );
    } );

    describe( 'introspect accessors', function () {
        it( 'getNodeType() returns "Persistence Check"', function () {
            expect( getNodeType() ).to.equal( 'Persistence Check' );
        } );

        it( 'getSupportedStats() returns persistenceConfirmed', function () {
            const stats = getSupportedStats();
            expect( stats ).to.deep.equal( [ 'persistenceConfirmed' ] );
        } );

        it( 'getStatDescriptions() describes persistenceConfirmed', function () {
            const descriptions = getStatDescriptions();
            expect( descriptions ).to.have.property( 'persistenceConfirmed' );
            expect( descriptions.persistenceConfirmed ).to.be.a( 'string' );
        } );

        it( 'getSupportedControlMethods() returns reset/enable/disable', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'reset' );
            expect( methods ).to.have.property( 'enable' );
            expect( methods ).to.have.property( 'disable' );
        } );

        it( 'getCapabilities() returns description and features', function () {
            const caps = getCapabilities();
            expect( caps ).to.have.property( 'description' );
            expect( caps ).to.have.property( 'features' );
            expect( caps.features ).to.be.an( 'array' );
        } );

        it( 'DEFAULT_OPTIONS has correct values', function () {
            expect( DEFAULT_OPTIONS.minVotes ).to.equal( 3 );
            expect( DEFAULT_OPTIONS.outOfTotal ).to.equal( 5 );
        } );

        it( 'getSupportedStats() returns defensive copy', function () {
            const stats1 = getSupportedStats();
            const stats2 = getSupportedStats();
            expect( stats1 ).to.not.equal( stats2 );
        } );
    } );

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'pauseTest',
                predicate: ( msg ) => msg.vote,
                stats: { persistenceConfirmed: { storeAs: 'confirmed' } }
            } );

            update( state, { vote: true } );
            const voteCountAfterFirst = state.voteCount;

            state.pause = true;

            update( state, { vote: true } );

            expect( state.voteCount ).to.equal( voteCountAfterFirst );
        } );

        it( 'publishes when paused', function () {
            const state = init( {
                nodeType: 'Persistence Check',
                name: 'pausePub',
                predicate: ( _msg ) => true,
                stats: { persistenceConfirmed: { storeAs: 'isConfirmed' } }
            } );

            update( state, {} );

            state.pause = true;

            const output = {};
            publishTo( state, output );

            expect( output.isConfirmed ).to.not.equal( undefined );
        } );

        it( 'pause/unpause control methods exist', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );
    } );

    describe( 'getDSLMetadata() and buildSpec', function () {
        it( 'returns DSL metadata with specSchema', function () {
            const meta = getDSLMetadata();
            expect( meta ).to.have.property( 'specSchema' );
            expect( meta ).to.have.property( 'buildSpec' );
            expect( meta ).to.have.property( 'crossFieldValidators' );
        } );

        it( 'specSchema includes required fields', function () {
            const { specSchema } = getDSLMetadata();
            expect( specSchema ).to.have.property( 'nodeType' );
            expect( specSchema ).to.have.property( 'name' );
            expect( specSchema ).to.have.property( 'predicate' );
            expect( specSchema ).to.have.property( 'minVotes' );
            expect( specSchema ).to.have.property( 'outOfTotal' );
            expect( specSchema ).to.have.property( 'stats' );
        } );

        it( 'buildSpec creates valid spec', function () {
            const { buildSpec } = getDSLMetadata();
            const pred = ( msg ) => msg.stable;
            const stats = { persistenceConfirmed: { storeAs: 'confirmed' } };
            const spec = buildSpec( 'myChecker', pred, stats, { minVotes: 4 } );

            expect( spec.nodeType ).to.equal( 'Persistence Check' );
            expect( spec.name ).to.equal( 'myChecker' );
            expect( spec.predicate ).to.equal( pred );
            expect( spec.stats ).to.equal( stats );
            expect( spec.minVotes ).to.equal( 4 );
        } );

        it( 'built spec initializes successfully', function () {
            const { buildSpec } = getDSLMetadata();
            const spec = buildSpec(
                'valid',
                ( _msg ) => true,
                { persistenceConfirmed: { storeAs: 'confirmed' } },
                {}
            );
            const state = init( spec );

            expect( state.nodeType ).to.equal( 'Persistence Check' );
        } );

        it( 'cross-field validator enforces minVotes <= outOfTotal', function () {
            const { crossFieldValidators } = getDSLMetadata();
            const validator = crossFieldValidators[ 0 ];

            expect( validator.validator( { minVotes: 3, outOfTotal: 5 } ) ).to.equal( true );
            expect( validator.validator( { minVotes: 5, outOfTotal: 5 } ) ).to.equal( true );
            expect( validator.validator( { minVotes: 6, outOfTotal: 5 } ) ).to.equal( false );
        } );
    } );

} );

// nodes/controller/test/controller.specs.js

import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import init from '../init.js';
import update from '../update.js';
import publishTo from '../publish-to.js';
import reset from '../reset.js';
import recompute from '../recompute.js';
import {
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities,
    getDSLMetadata
} from '../introspect.js';

describe( 'Controller Node', function () {
    describe( 'init()', function () {
        it( 'initializes with valid spec', function () {
            const state = init( {
                nodeType: 'Controller',
                name: 'testController',
                logic: [ {
                    when: ( msg ) => msg.value > 10,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            expect( state.nodeType ).to.equal( 'Controller' );
            expect( state.name ).to.equal( 'testController' );
            expect( state.logic ).to.have.length( 1 );
        } );

        it( 'copies logic array structure', function () {
            const whenFn = ( msg ) => msg.value > 10;
            const triggers = [ { control: 'reset', targets: [ 'node1' ] } ];

            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ { when: whenFn, triggers } ]
            } );

            expect( state.logic[ 0 ].when ).to.equal( whenFn );
            expect( state.logic[ 0 ].triggers ).to.equal( triggers );
            expect( state.logic[ 0 ].resolvedTriggers ).to.equal( null );
        } );

        it( 'initializes observability fields', function () {
            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: ( _msg ) => true,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            expect( state.lastMatchedCondition ).to.equal( -1 );
            expect( state.matchCount ).to.equal( 0 );
            expect( state.errorCount ).to.equal( 0 );
            expect( state.lastError ).to.equal( null );
            expect( state.predicateErrorLogged ).to.equal( false );
            expect( state.inControlPhase ).to.equal( false );
            expect( state.resolvedTriggers ).to.equal( null );
        } );

        it( 'supports multiple conditions', function () {
            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [
                    { when: ( msg ) => msg.temp > 100, triggers: [ { control: 'reset', targets: [ 'a' ] } ] },
                    { when: ( msg ) => msg.temp < 0, triggers: [ { control: 'reset', targets: [ 'b' ] } ] },
                    { when: ( _msg ) => true, triggers: [ { control: 'enable', targets: [ 'c' ] } ] }
                ]
            } );

            expect( state.logic ).to.have.length( 3 );
        } );
    } );

    describe( 'spec validation', function () {
        it( 'rejects missing nodeType', function () {
            expect( () => init( {
                name: 'test',
                logic: [ {
                    when: ( _msg ) => true,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } ) ).to.throw( /nodeType/ );
        } );

        it( 'rejects missing name', function () {
            expect( () => init( {
                nodeType: 'Controller',
                logic: [ {
                    when: ( _msg ) => true,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } ) ).to.throw( /name/ );
        } );

        it( 'rejects missing logic', function () {
            expect( () => init( {
                nodeType: 'Controller',
                name: 'test'
            } ) ).to.throw( /logic/ );
        } );

        it( 'rejects empty logic array', function () {
            expect( () => init( {
                nodeType: 'Controller',
                name: 'test',
                logic: []
            } ) ).to.throw();
        } );

        it( 'rejects non-function when predicate', function () {
            expect( () => init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: 'notAFunction',
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } ) ).to.throw( /function/ );
        } );

        it( 'rejects missing triggers array', function () {
            expect( () => init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: () => true
                } ]
            } ) ).to.throw();
        } );

        it( 'rejects empty triggers array', function () {
            expect( () => init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: ( _msg ) => true,
                    triggers: []
                } ]
            } ) ).to.throw();
        } );
    } );

    describe( 'update() - condition evaluation', function () {
        let state;

        beforeEach( function () {
            state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [
                    { when: ( msg ) => msg.value > 100, triggers: [ { control: 'reset', targets: [ 'high' ] } ] },
                    { when: ( msg ) => msg.value < 0, triggers: [ { control: 'reset', targets: [ 'low' ] } ] },
                    { when: ( _msg ) => true, triggers: [ { control: 'enable', targets: [ 'default' ] } ] }
                ]
            } );
        } );

        it( 'first-match-wins for first condition', function () {
            update( state, { value: 150 } );

            expect( state.lastMatchedCondition ).to.equal( 0 );
            expect( state.matchCount ).to.equal( 1 );
        } );

        it( 'first-match-wins for second condition', function () {
            update( state, { value: -10 } );

            expect( state.lastMatchedCondition ).to.equal( 1 );
            expect( state.matchCount ).to.equal( 1 );
        } );

        it( 'falls through to default condition', function () {
            update( state, { value: 50 } );

            expect( state.lastMatchedCondition ).to.equal( 2 );
            expect( state.matchCount ).to.equal( 1 );
        } );

        it( 'increments matchCount on each match', function () {
            update( state, { value: 150 } );
            update( state, { value: -10 } );
            update( state, { value: 50 } );

            expect( state.matchCount ).to.equal( 3 );
        } );

        it( 'handles no match (all predicates false)', function () {
            const noDefaultState = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [
                    { when: ( msg ) => msg.value > 100, triggers: [ { control: 'reset', targets: [ 'a' ] } ] },
                    { when: ( msg ) => msg.value < 0, triggers: [ { control: 'reset', targets: [ 'b' ] } ] }
                ]
            } );

            update( noDefaultState, { value: 50 } );

            expect( noDefaultState.lastMatchedCondition ).to.equal( -1 );
            expect( noDefaultState.matchCount ).to.equal( 0 );
        } );
    } );

    describe( 'update() - error handling', function () {
        it( 'catches predicate exceptions', function () {
            const throwingPredicate = function ( _msg ) {
                throw new Error( 'Predicate error' );
            };

            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: throwingPredicate,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            // Should not throw
            expect( () => update( state, { value: 10 } ) ).to.not.throw();

            expect( state.errorCount ).to.equal( 1 );
            expect( state.lastError ).to.equal( 'Predicate error' );
        } );

        it( 'continues to next condition after error', function () {
            const throwingPredicate = function ( _msg ) {
                throw new Error( 'First fails' );
            };

            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [
                    { when: throwingPredicate, triggers: [ { control: 'reset', targets: [ 'a' ] } ] },
                    { when: ( _msg ) => true, triggers: [ { control: 'reset', targets: [ 'b' ] } ] }
                ]
            } );

            update( state, { value: 10 } );

            expect( state.errorCount ).to.equal( 1 );
            expect( state.lastMatchedCondition ).to.equal( 1 );
            expect( state.matchCount ).to.equal( 1 );
        } );

        it( 'tracks multiple errors', function () {
            const throwingPredicate = function ( _msg ) {
                throw new Error( 'Error' );
            };

            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [
                    { when: throwingPredicate, triggers: [ { control: 'reset', targets: [ 'a' ] } ] },
                    { when: ( _msg ) => true, triggers: [ { control: 'reset', targets: [ 'b' ] } ] }
                ]
            } );

            update( state, { value: 1 } );
            update( state, { value: 2 } );
            update( state, { value: 3 } );

            expect( state.errorCount ).to.equal( 3 );
        } );

        it( 'suppresses log on repeated predicate exceptions', function () {
            const stub = sinon.stub( console, 'error' );

            const throwingPredicate = function ( _msg ) {
                throw new Error( 'repeated error' );
            };

            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: throwingPredicate,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            update( state, { value: 1 } );
            update( state, { value: 2 } );
            update( state, { value: 3 } );

            expect( stub.calledOnce ).to.equal( true );

            stub.restore();
        } );

        it( 'logs again after recovery (all predicates succeed)', function () {
            const stub = sinon.stub( console, 'error' );

            let shouldThrow = true;
            const conditionalPredicate = function ( _msg ) {
                if ( shouldThrow ) {
                    throw new Error( 'intermittent error' );
                }
                return true;
            };

            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: conditionalPredicate,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );
            // Resolve triggers for the match path
            state.logic[ 0 ].resolvedTriggers = [];

            // First error — logs
            update( state, {} );
            expect( stub.calledOnce ).to.equal( true );

            // Recovery — predicate succeeds, match found, flag cleared
            shouldThrow = false;
            update( state, {} );

            // Second error — logs again (new episode)
            shouldThrow = true;
            update( state, {} );
            expect( stub.calledTwice ).to.equal( true );

            stub.restore();
        } );

        it( 'does not clear suppression flag when one predicate still throws', function () {
            const stub = sinon.stub( console, 'error' );

            const alwaysThrows = function ( _msg ) {
                throw new Error( 'always broken' );
            };

            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [
                    { when: alwaysThrows, triggers: [ { control: 'reset', targets: [ 'a' ] } ] },
                    { when: ( _msg ) => true, triggers: [ { control: 'reset', targets: [ 'b' ] } ] }
                ]
            } );
            state.logic[ 1 ].resolvedTriggers = [];

            // First pass: condition 0 throws (logs), condition 1 matches
            // But anyError is true, so flag is NOT cleared
            update( state, {} );
            expect( stub.calledOnce ).to.equal( true );

            // Second pass: same situation — no new log
            update( state, {} );
            expect( stub.calledOnce ).to.equal( true );

            stub.restore();
        } );

        it( 'clears suppression flag via post-loop recovery when no condition matches', function () {
            const stub = sinon.stub( console, 'error' );

            let shouldThrow = true;
            const conditionalPredicate = function ( _msg ) {
                if ( shouldThrow ) {
                    throw new Error( 'intermittent error' );
                }
                return false;  // Succeeds but does not match
            };

            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: conditionalPredicate,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            // Pass 1: throws → predicateErrorLogged = true, logs
            update( state, {} );
            expect( stub.calledOnce ).to.equal( true );

            // Pass 2: succeeds but returns false → no match, falls through
            // Post-loop: !anyError (true) && predicateErrorLogged (true) → cleared
            shouldThrow = false;
            update( state, {} );

            // Pass 3: throws again → flag was cleared → logs again (new episode)
            shouldThrow = true;
            update( state, {} );
            expect( stub.calledTwice ).to.equal( true );

            stub.restore();
        } );
    } );

    describe( 'update() - trigger execution', function () {
        it( 'returns early when no resolved triggers', function () {
            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: ( _msg ) => true,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            // resolvedTriggers is null by default (unresolved)
            const result = update( state, { value: 10 } );

            expect( result ).to.equal( state );
            expect( state.matchCount ).to.equal( 1 );
        } );

        it( 'returns early when resolved triggers is empty array', function () {
            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: ( _msg ) => true,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            // Empty array (distinct from null — partition resolved but no targets)
            state.logic[ 0 ].resolvedTriggers = [];

            const result = update( state, { value: 10 } );

            expect( result ).to.equal( state );
            expect( state.matchCount ).to.equal( 1 );
        } );

        it( 'executes resolved triggers when present', function () {
            const mockReset = sinon.stub();
            const mockTarget = {};

            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: ( _msg ) => true,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            // Simulate partition manager resolving triggers
            // Format: { control: Function, targets: [resolved target objects] }
            state.logic[ 0 ].resolvedTriggers = [ { control: mockReset, targets: [ mockTarget ] } ];

            update( state, { value: 10 } );

            expect( mockReset.calledOnce ).to.equal( true );
            expect( mockReset.calledWith( mockTarget ) ).to.equal( true );
        } );

        it( 'executes triggers for matched condition only', function () {
            const mockResetA = sinon.stub();
            const mockResetB = sinon.stub();
            const mockTargetA = {};
            const mockTargetB = {};

            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [
                    { when: ( msg ) => msg.value > 100, triggers: [ { control: 'reset', targets: [ 'a' ] } ] },
                    { when: ( _msg ) => true, triggers: [ { control: 'reset', targets: [ 'b' ] } ] }
                ]
            } );

            state.logic[ 0 ].resolvedTriggers = [ { control: mockResetA, targets: [ mockTargetA ] } ];
            state.logic[ 1 ].resolvedTriggers = [ { control: mockResetB, targets: [ mockTargetB ] } ];

            update( state, { value: 50 } );  // Falls through to second condition

            expect( mockResetA.called ).to.equal( false );
            expect( mockResetB.calledOnce ).to.equal( true );
        } );
    } );

    describe( 'publishTo()', function () {
        it( 'does not modify message', function () {
            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: ( _msg ) => true,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            const msg = { value: 10, existing: 'data' };
            const msgCopy = { ...msg };

            publishTo( state, msg );

            expect( msg ).to.deep.equal( msgCopy );
        } );

        it( 'returns undefined (no-op)', function () {
            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: ( _msg ) => true,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            const result = publishTo( state, {} );

            expect( result ).to.equal( undefined );
        } );
    } );

    describe( 'reset()', function () {
        let state;

        beforeEach( function () {
            state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: ( _msg ) => true,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );
        } );

        it( 'clears lastMatchedCondition', function () {
            state.lastMatchedCondition = 5;

            reset( state );

            expect( state.lastMatchedCondition ).to.equal( -1 );
        } );

        it( 'clears matchCount', function () {
            state.matchCount = 100;

            reset( state );

            expect( state.matchCount ).to.equal( 0 );
        } );

        it( 'clears errorCount', function () {
            state.errorCount = 10;

            reset( state );

            expect( state.errorCount ).to.equal( 0 );
        } );

        it( 'clears lastError', function () {
            state.lastError = 'Some error';

            reset( state );

            expect( state.lastError ).to.equal( null );
        } );

        it( 'preserves logic structure', function () {
            const logicLength = state.logic.length;

            reset( state );

            expect( state.logic ).to.have.length( logicLength );
        } );

        it( 'returns true', function () {
            const result = reset( state );

            expect( result ).to.equal( true );
        } );

        it( 'clears error suppression flag', function () {
            state.predicateErrorLogged = true;
            reset( state );
            expect( state.predicateErrorLogged ).to.equal( false );
        } );

        it( 'is idempotent (double reset produces same state)', function () {
            state.matchCount = 10;
            state.errorCount = 3;
            state.lastError = 'some error';
            state.predicateErrorLogged = true;
            state.lastMatchedCondition = 2;

            reset( state );
            reset( state );

            expect( state.lastMatchedCondition ).to.equal( -1 );
            expect( state.matchCount ).to.equal( 0 );
            expect( state.errorCount ).to.equal( 0 );
            expect( state.lastError ).to.equal( null );
            expect( state.predicateErrorLogged ).to.equal( false );
        } );

        it( 'cold-start to warm to reset to warm-again lifecycle', function () {
            // Warm: accumulate state via updates
            state.logic[ 0 ].resolvedTriggers = [];
            update( state, {} );
            update( state, {} );
            expect( state.matchCount ).to.equal( 2 );
            expect( state.lastMatchedCondition ).to.equal( 0 );

            // Reset: clears accumulated state
            reset( state );
            expect( state.matchCount ).to.equal( 0 );
            expect( state.lastMatchedCondition ).to.equal( -1 );

            // Warm again: fresh accumulation from zero
            update( state, {} );
            expect( state.matchCount ).to.equal( 1 );
            expect( state.lastMatchedCondition ).to.equal( 0 );
        } );
    } );

    describe( 'recompute()', function () {
        it( 'returns true', function () {
            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: ( _msg ) => true,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            const result = recompute( state );

            expect( result ).to.equal( true );
        } );

        it( 'preserves state', function () {
            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: ( _msg ) => true,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            state.matchCount = 5;
            state.errorCount = 2;

            recompute( state );

            expect( state.matchCount ).to.equal( 5 );
            expect( state.errorCount ).to.equal( 2 );
        } );
    } );

    describe( 'introspection', function () {
        it( 'getSupportedStats returns empty array (no stats)', function () {
            const stats = getSupportedStats();

            expect( stats ).to.be.an( 'array' );
            expect( stats ).to.have.length( 0 );
        } );

        it( 'getStatDescriptions returns empty object', function () {
            const descriptions = getStatDescriptions();

            expect( descriptions ).to.deep.equal( {} );
        } );

        it( 'getSupportedControlMethods returns empty object', function () {
            const methods = getSupportedControlMethods();

            expect( methods ).to.deep.equal( {} );
        } );

        it( 'getNodeType returns Controller', function () {
            expect( getNodeType() ).to.equal( 'Controller' );
        } );

        it( 'getCapabilities returns description and features', function () {
            const caps = getCapabilities();

            expect( caps.description ).to.be.a( 'string' );
            expect( caps.description ).to.include( 'orchestration' );
            expect( caps.features ).to.be.an( 'array' );
        } );

        it( 'getDSLMetadata returns specSchema', function () {
            const metadata = getDSLMetadata();

            expect( metadata.specSchema ).to.have.property( 'nodeType' );
            expect( metadata.specSchema ).to.have.property( 'name' );
            expect( metadata.specSchema ).to.have.property( 'logic' );
        } );

        it( 'getDSLMetadata returns buildSpec function', function () {
            const metadata = getDSLMetadata();

            expect( metadata.buildSpec ).to.be.a( 'function' );
        } );
    } );

    describe( 'DSL buildSpec()', function () {
        it( 'builds valid spec', function () {
            const metadata = getDSLMetadata();
            const logic = [
                { when: ( msg ) => msg.value > 10, triggers: [ { control: 'reset', targets: [ 'node1' ] } ] }
            ];

            const spec = metadata.buildSpec( 'testController', logic );

            expect( spec.nodeType ).to.equal( 'Controller' );
            expect( spec.name ).to.equal( 'testController' );
            expect( spec.logic ).to.equal( logic );
        } );

        it( 'produces spec that passes validation', function () {
            const metadata = getDSLMetadata();
            const spec = metadata.buildSpec(
                'validController',
                [ {
                    when: ( _msg ) => true,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            );

            expect( () => init( spec ) ).to.not.throw();
        } );
    } );

    describe( 'edge cases', function () {
        it( 'handles complex predicates', function () {
            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: ( msg ) => ( msg.temp > 50 ) && ( msg.pressure < 100 ) && ( msg.status === 'active' ),
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            update( state, { temp: 60, pressure: 80, status: 'active' } );
            expect( state.lastMatchedCondition ).to.equal( 0 );

            state.lastMatchedCondition = -1;
            state.matchCount = 0;

            update( state, { temp: 60, pressure: 80, status: 'inactive' } );
            expect( state.lastMatchedCondition ).to.equal( -1 );
        } );

        it( 'handles predicate returning non-boolean truthy', function () {
            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: ( msg ) => msg.value,  // Returns value itself
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            // Only strict true should match
            update( state, { value: 1 } );
            expect( state.lastMatchedCondition ).to.equal( -1 );

            update( state, { value: true } );
            expect( state.lastMatchedCondition ).to.equal( 0 );
        } );

        it( 'handles predicate accessing nested properties', function () {
            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: ( msg ) => msg.sensor?.reading > 50,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            update( state, { sensor: { reading: 60 } } );
            expect( state.lastMatchedCondition ).to.equal( 0 );
        } );

        it( 'handles empty message', function () {
            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic: [ {
                    when: ( msg ) => msg.value === undefined,
                    triggers: [ { control: 'reset', targets: [ 'node1' ] } ]
                } ]
            } );

            update( state, {} );
            expect( state.lastMatchedCondition ).to.equal( 0 );
        } );

        it( 'handles many conditions efficiently', function () {
            const logic = [];
            for ( let i = 0; i < 100; i += 1 ) {
                logic.push( {
                    when: ( msg ) => msg.value === i,
                    triggers: [ { control: 'reset', targets: [ `node${i}` ] } ]
                } );
            }

            const state = init( {
                nodeType: 'Controller',
                name: 'test',
                logic
            } );

            // Match the 50th condition
            update( state, { value: 50 } );
            expect( state.lastMatchedCondition ).to.equal( 50 );
        } );
    } );
} );

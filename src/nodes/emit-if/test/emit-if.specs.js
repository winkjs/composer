// nodes/emit-if/test/emit-if.specs.js

import { expect } from 'chai';
import sinon from 'sinon';
import { describe, it, afterEach } from 'mocha';
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

import { createMockEmitter } from './test-helpers.js';

describe( 'Emit-If Node', function () {

    // A failed assertion between spy creation and its manual restore
    // must not leave console.error wrapped for the rest of the run.
    afterEach( function () {
        sinon.restore();
    } );

    describe( 'init()', function () {
        it( 'initializes with valid spec', function () {
            const state = init( {
                nodeType: 'Emit If',
                name: 'alerter',
                predicate: ( msg ) => msg.alert === true,
                target: 'mqtt',
                insightType: 'alert'
            } );

            expect( state.nodeType ).to.equal( 'Emit If' );
            expect( state.name ).to.equal( 'alerter' );
            expect( state.predicate ).to.be.a( 'function' );
            expect( state.target ).to.equal( 'mqtt' );
            expect( state.insightType ).to.equal( 'alert' );
        } );

        it( 'initializes statistics to zero', function () {
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'test'
            } );

            expect( state.emissionCount ).to.equal( 0 );
            expect( state.passCount ).to.equal( 0 );
            expect( state.emissionErrors ).to.equal( 0 );
            expect( state.lastEmissionTime ).to.equal( null );
            expect( state.lastEmissionError ).to.equal( null );
        } );

        it( 'initializes error state to false', function () {
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'test'
            } );

            expect( state.inErrorState ).to.equal( false );
        } );

        it( 'stores optional annotate function', function () {
            const annotate = ( msg ) => ( { ...msg, annotated: true } );
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'test',
                annotate
            } );

            expect( state.annotate ).to.equal( annotate );
        } );

        it( 'sets annotate to null when not provided', function () {
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'test'
            } );

            expect( state.annotate ).to.equal( null );
        } );
    } );

    describe( 'spec validation', function () {
        it( 'throws on missing nodeType', function () {
            expect( () => init( {
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'test'
            } ) ).to.throw();
        } );

        it( 'throws on wrong nodeType', function () {
            expect( () => init( {
                nodeType: 'WrongType',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'test'
            } ) ).to.throw();
        } );

        it( 'throws on missing name', function () {
            expect( () => init( {
                nodeType: 'Emit If',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'test'
            } ) ).to.throw();
        } );

        it( 'throws on invalid name (not identifier)', function () {
            expect( () => init( {
                nodeType: 'Emit If',
                name: '123-invalid',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'test'
            } ) ).to.throw();
        } );

        it( 'throws on missing predicate', function () {
            expect( () => init( {
                nodeType: 'Emit If',
                name: 'test',
                target: 'mqtt',
                insightType: 'test'
            } ) ).to.throw();
        } );

        it( 'throws on non-function predicate', function () {
            expect( () => init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: 'not-a-function',
                target: 'mqtt',
                insightType: 'test'
            } ) ).to.throw();
        } );

        it( 'throws on wrong predicate arity (needs 1 param)', function () {
            expect( () => init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _a, _b ) => true,
                target: 'mqtt',
                insightType: 'test'
            } ) ).to.throw();
        } );

        it( 'throws on missing target', function () {
            expect( () => init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                insightType: 'test'
            } ) ).to.throw();
        } );

        it( 'throws on invalid target', function () {
            expect( () => init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'invalid',
                insightType: 'test'
            } ) ).to.throw();
        } );

        it( 'accepts mqtt target', function () {
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'test'
            } );
            expect( state.target ).to.equal( 'mqtt' );
        } );

        it( 'accepts gpio target', function () {
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'gpio',
                insightType: 'test'
            } );
            expect( state.target ).to.equal( 'gpio' );
        } );

        it( 'accepts terminal target', function () {
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'terminal',
                insightType: 'test'
            } );
            expect( state.target ).to.equal( 'terminal' );
        } );

        it( 'throws on missing insightType', function () {
            expect( () => init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt'
            } ) ).to.throw();
        } );

        it( 'throws on wrong annotate arity (needs 1 param)', function () {
            expect( () => init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'test',
                annotate: ( a, _b ) => a
            } ) ).to.throw();
        } );
    } );

    describe( 'update() - basic emission', function () {
        it( 'emits when predicate returns true and emitter connected', function () {
            const emitter = createMockEmitter();
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( msg ) => msg.emit === true,
                target: 'mqtt',
                insightType: 'alert'
            } );
            state.emitter = emitter;
            state.topic = 'test/topic';

            update( state, { emit: true, value: 42 } );

            expect( emitter.publishNow.calledOnce ).to.equal( true );
            expect( emitter.publishNow.firstCall.args[ 0 ] ).to.equal( 'test/topic' );
            expect( emitter.publishNow.firstCall.args[ 1 ] ).to.deep.equal( { emit: true, value: 42 } );
        } );

        it( 'does not emit when predicate returns false', function () {
            const emitter = createMockEmitter();
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( msg ) => msg.emit === true,
                target: 'mqtt',
                insightType: 'alert'
            } );
            state.emitter = emitter;
            state.topic = 'test/topic';

            update( state, { emit: false, value: 42 } );

            expect( emitter.publishNow.called ).to.equal( false );
        } );

        it( 'increments emissionCount on successful emission', function () {
            const emitter = createMockEmitter();
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'alert'
            } );
            state.emitter = emitter;
            state.topic = 'test/topic';

            update( state, {} );
            update( state, {} );
            update( state, {} );

            expect( state.emissionCount ).to.equal( 3 );
        } );

        it( 'updates lastEmissionTime on successful emission', function () {
            const emitter = createMockEmitter();
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'alert'
            } );
            state.emitter = emitter;
            state.topic = 'test/topic';

            const before = Date.now();
            update( state, {} );
            const after = Date.now();

            expect( state.lastEmissionTime ).to.be.at.least( before );
            expect( state.lastEmissionTime ).to.be.at.most( after );
        } );

        it( 'increments passCount on every update', function () {
            const emitter = createMockEmitter();
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( msg ) => msg.emit === true,
                target: 'mqtt',
                insightType: 'alert'
            } );
            state.emitter = emitter;
            state.topic = 'test/topic';

            update( state, { emit: true } );
            update( state, { emit: false } );
            update( state, { emit: true } );

            expect( state.passCount ).to.equal( 3 );
        } );

        it( 'always returns state (pass-through)', function () {
            const emitter = createMockEmitter();
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( msg ) => msg.emit,
                target: 'mqtt',
                insightType: 'alert'
            } );
            state.emitter = emitter;
            state.topic = 'test/topic';

            const result1 = update( state, { emit: true } );
            const result2 = update( state, { emit: false } );

            expect( result1 ).to.equal( state );
            expect( result2 ).to.equal( state );
        } );
    } );

    describe( 'update() - annotate function', function () {
        it( 'uses annotate to transform message before emission', function () {
            const emitter = createMockEmitter();
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'alert',
                annotate: ( msg ) => ( { transformed: true, original: msg.value } )
            } );
            state.emitter = emitter;
            state.topic = 'test/topic';

            update( state, { value: 42 } );

            expect( emitter.publishNow.firstCall.args[ 1 ] ).to.deep.equal( {
                transformed: true,
                original: 42
            } );
        } );

        it( 'emits original message when annotate is null', function () {
            const emitter = createMockEmitter();
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'alert'
            } );
            state.emitter = emitter;
            state.topic = 'test/topic';

            update( state, { original: true, value: 100 } );

            expect( emitter.publishNow.firstCall.args[ 1 ] ).to.deep.equal( {
                original: true,
                value: 100
            } );
        } );

        // Return-shape rejection mirrors persistIf:
        // a shaped payload must be a plain object; anything else is a
        // flow-authoring bug surfaced in this node's error episode, not
        // published as-is. In emitIf the error episode also emits a
        // status signal, so publishNow IS called once — with the signal,
        // never with the bad payload.
        const makeAnnotateState = function ( emitter, annotate ) {
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'alert',
                annotate
            } );
            state.emitter = emitter;
            state.topic = 'test/topic';
            return state;
        }; // makeAnnotateState()

        it( 'rejects a non-object annotate return inside the node error episode', function () {
            const emitter = createMockEmitter();
            const state = makeAnnotateState( emitter, ( _msg ) => null );

            const errorSpy = sinon.spy( console, 'error' );
            update( state, { value: 1 } );
            errorSpy.restore();

            expect( state.inErrorState ).to.equal( true );
            expect( state.emissionErrors ).to.equal( 1 );
            expect( state.lastEmissionError ).to.equal( 'annotate must return an object, got null' );
            expect( state.lastEmissionErrorCode ).to.equal( null );   // a flow bug, not an adapter failure
            // Only the status signal was published — never the bad payload.
            expect( emitter.publishNow.calledOnce ).to.equal( true );
            expect( emitter.publishNow.firstCall.args[ 1 ].$disable ).to.equal( true );
        } );

        it( 'rejects an array annotate return (typeof object, still not a record)', function () {
            const emitter = createMockEmitter();
            const state = makeAnnotateState( emitter, ( _msg ) => [ 1, 2, 3 ] );

            const errorSpy = sinon.spy( console, 'error' );
            update( state, { value: 1 } );
            errorSpy.restore();

            expect( state.inErrorState ).to.equal( true );
            expect( state.lastEmissionError ).to.equal( 'annotate must return an object, got array' );
            expect( emitter.publishNow.calledOnce ).to.equal( true );
            expect( emitter.publishNow.firstCall.args[ 1 ].$disable ).to.equal( true );
        } );

        it( 'rejects a primitive annotate return with the offending type named', function () {
            const emitter = createMockEmitter();
            const state = makeAnnotateState( emitter, ( _msg ) => 42 );

            const errorSpy = sinon.spy( console, 'error' );
            update( state, { value: 1 } );
            errorSpy.restore();

            expect( state.lastEmissionError ).to.equal( 'annotate must return an object, got number' );
            expect( emitter.publishNow.calledOnce ).to.equal( true );
            expect( emitter.publishNow.firstCall.args[ 1 ].$disable ).to.equal( true );
        } );

        it( 'recovers from an annotate error episode on the next clean evaluation', function () {
            const emitter = createMockEmitter();
            let bad = true;
            const state = makeAnnotateState( emitter, ( msg ) => ( bad ? null : { v: msg.value } ) );

            const errorSpy = sinon.spy( console, 'error' );
            update( state, { value: 1 } );
            bad = false;
            update( state, { value: 2 } );
            errorSpy.restore();

            expect( state.inErrorState ).to.equal( false );
            expect( state.emissionCount ).to.equal( 1 );
            // Three publishes: the $disable signal (annotate error), the
            // recovered data payload, then the $disable:false recovery
            // signal that closes the error state.
            expect( emitter.publishNow.callCount ).to.equal( 3 );
            expect( emitter.publishNow.getCall( 1 ).args[ 1 ] ).to.deep.equal( { v: 2 } );
            expect( emitter.publishNow.getCall( 2 ).args[ 1 ].$disable ).to.equal( false );
        } );
    } );

    // The 'disconnected emitter' block that lived here is retired with
    // isConnected itself (ADR-018: no connectivity pre-checks — publish
    // unconditionally and read the classified result). Publish-failure
    // handling now lives in emit-failures.specs.js.

    describe( 'update() - predicate error handling', function () {
        it( 'increments emissionErrors on predicate exception', function () {
            const emitter = createMockEmitter();
            const throwingPredicate = function ( _msg ) {
                throw new Error( 'Test error' );
            };
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: throwingPredicate,
                target: 'mqtt',
                insightType: 'alert'
            } );
            state.emitter = emitter;
            state.topic = 'test/topic';

            update( state, {} );

            expect( state.emissionErrors ).to.equal( 1 );
            expect( state.lastEmissionError ).to.equal( 'Test error' );
        } );

        it( 'enters error state on first exception', function () {
            const emitter = createMockEmitter();
            const throwingPredicate = function ( _msg ) {
                throw new Error( 'Test error' );
            };
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: throwingPredicate,
                target: 'mqtt',
                insightType: 'alert'
            } );
            state.emitter = emitter;
            state.topic = 'test/topic';

            expect( state.inErrorState ).to.equal( false );
            update( state, {} );
            expect( state.inErrorState ).to.equal( true );
        } );

        it( 'clears error state on successful evaluation', function () {
            let shouldThrow = true;
            const emitter = createMockEmitter();
            const conditionalPredicate = function ( _msg ) {
                if ( shouldThrow ) {
                    throw new Error( 'Error' );
                }
                return true;
            };
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: conditionalPredicate,
                target: 'mqtt',
                insightType: 'alert'
            } );
            state.emitter = emitter;
            state.topic = 'test/topic';

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
                nodeType: 'Emit If',
                name: 'test',
                predicate: throwingPredicate,
                target: 'mqtt',
                insightType: 'alert'
            } );
            state.emitter = createMockEmitter();
            state.topic = 'test/topic';

            const result = update( state, {} );
            expect( result ).to.equal( state );
        } );

        it( 'logs predicate error to console on first exception', function () {
            const stub = sinon.stub( console, 'error' );
            const emitter = createMockEmitter();
            const throwingPredicate = function ( _msg ) {
                throw new Error( 'Test error' );
            };
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: throwingPredicate,
                target: 'mqtt',
                insightType: 'alert'
            } );
            state.emitter = emitter;
            state.topic = 'test/topic';

            update( state, {} );

            expect( stub.calledOnce ).to.equal( true );
            expect( stub.firstCall.args[ 0 ] ).to.include( 'predicate threw exception' );

            stub.restore();
        } );

        it( 'suppresses log on repeated exceptions', function () {
            const stub = sinon.stub( console, 'error' );
            const emitter = createMockEmitter();
            const throwingPredicate = function ( _msg ) {
                throw new Error( 'repeated error' );
            };
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: throwingPredicate,
                target: 'mqtt',
                insightType: 'alert'
            } );
            state.emitter = emitter;
            state.topic = 'test/topic';

            update( state, {} );
            update( state, {} );
            update( state, {} );

            expect( stub.calledOnce ).to.equal( true );

            stub.restore();
        } );

        it( 'logs again after recovery', function () {
            const stub = sinon.stub( console, 'error' );
            let shouldThrow = true;
            const emitter = createMockEmitter();
            const conditionalPredicate = function ( _msg ) {
                if ( shouldThrow ) {
                    throw new Error( 'intermittent error' );
                }
                return false;
            };
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: conditionalPredicate,
                target: 'mqtt',
                insightType: 'alert'
            } );
            state.emitter = emitter;
            state.topic = 'test/topic';

            // First error — logs
            update( state, {} );
            expect( stub.calledOnce ).to.equal( true );

            // Recovery
            shouldThrow = false;
            update( state, {} );

            // Second error — logs again (new episode)
            shouldThrow = true;
            update( state, {} );
            expect( stub.calledTwice ).to.equal( true );

            stub.restore();
        } );
    } );

    describe( 'update() - no emitter', function () {
        it( 'handles missing emitter gracefully', function () {
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'alert'
            } );
            // No emitter set

            const result = update( state, {} );
            expect( result ).to.equal( state );
            expect( state.emissionCount ).to.equal( 0 );
        } );
    } );

    describe( 'publishTo()', function () {
        it( 'does not modify message (pass-through)', function () {
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'alert'
            } );

            const msg = { original: 'data' };
            publishTo( state, msg );

            expect( Object.keys( msg ) ).to.deep.equal( [ 'original' ] );
        } );
    } );

    describe( 'reset()', function () {
        it( 'resets statistics to zero', function () {
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'alert'
            } );

            state.emissionCount = 10;
            state.passCount = 20;
            state.emissionErrors = 5;
            state.lastEmissionTime = Date.now();
            state.lastEmissionError = 'Some error';
            state.inErrorState = true;

            reset( state );

            expect( state.emissionCount ).to.equal( 0 );
            expect( state.passCount ).to.equal( 0 );
            expect( state.emissionErrors ).to.equal( 0 );
            expect( state.lastEmissionTime ).to.equal( null );
            expect( state.lastEmissionError ).to.equal( null );
            expect( state.inErrorState ).to.equal( false );
        } );

        it( 'clears error suppression flag', function () {
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'alert'
            } );

            state.predicateErrorLogged = true;
            reset( state );
            expect( state.predicateErrorLogged ).to.equal( false );
        } );

        it( 'returns true', function () {
            const state = init( {
                nodeType: 'Emit If',
                name: 'test',
                predicate: ( _msg ) => true,
                target: 'mqtt',
                insightType: 'alert'
            } );

            const result = reset( state );
            expect( result ).to.equal( true );
        } );
    } );

    describe( 'recompute()', function () {
        it( 'returns true (no numerical state to stabilize)', function () {
            const result = recompute();
            expect( result ).to.equal( true );
        } );
    } );

    describe( 'introspect accessors', function () {
        it( 'getNodeType() returns "Emit If"', function () {
            expect( getNodeType() ).to.equal( 'Emit If' );
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
            expect( specSchema ).to.have.property( 'target' );
            expect( specSchema ).to.have.property( 'insightType' );
        } );

        it( 'buildSpec creates valid spec', function () {
            const { buildSpec } = getDSLMetadata();
            const pred = ( msg ) => msg.alert;
            const spec = buildSpec( 'myEmitter', pred, {
                target: 'mqtt',
                insightType: 'alert'
            } );

            expect( spec.nodeType ).to.equal( 'Emit If' );
            expect( spec.name ).to.equal( 'myEmitter' );
            expect( spec.predicate ).to.equal( pred );
            expect( spec.target ).to.equal( 'mqtt' );
        } );

        it( 'built spec initializes successfully', function () {
            const { buildSpec } = getDSLMetadata();
            const spec = buildSpec( 'validEmitter', ( _msg ) => true, {
                target: 'mqtt',
                insightType: 'notification'
            } );
            const state = init( spec );

            expect( state.nodeType ).to.equal( 'Emit If' );
        } );
    } );

} );

/**
 * Tests for passIf node — initialization, spec validation,
 * introspection accessors, and DSL buildSpec / metadata.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    init,
    getNodeType,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getCapabilities,
    getDSLMetadata,
    DEFAULT_OPTIONS
} from '../index.js';
import { PASS_IF_NODE_TYPE, validSpec } from './test-helpers.js';

describe( 'Pass-If Node — Init', function () {

    describe( 'init()', function () {
        it( 'initializes with valid spec', function () {
            const state = init( validSpec( 'sampler', ( _msg, counter ) => counter % 10 === 0 ) );

            expect( state.nodeType ).to.equal( PASS_IF_NODE_TYPE );
            expect( state.predicate ).to.be.a( 'function' );
            expect( state.counter ).to.equal( 0 );
            expect( state.disable ).to.equal( false );
        } );

        it( 'stores predicate function in state', function () {
            const pred = ( msg, _counter ) => msg.value > 0;
            const state = init( validSpec( 'positive', pred ) );

            expect( state.predicate ).to.equal( pred );
        } );
    } );

    describe( 'spec validation', function () {
        it( 'throws on missing nodeType', function () {
            expect( () => init( {
                name: 'test',
                predicate: ( _msg, _counter ) => true
            } ) ).to.throw();
        } );

        it( 'throws on wrong nodeType', function () {
            expect( () => init( {
                nodeType: 'WrongType',
                name: 'test',
                predicate: ( _msg, _counter ) => true
            } ) ).to.throw();
        } );

        it( 'throws on missing name', function () {
            expect( () => init( {
                nodeType: PASS_IF_NODE_TYPE,
                predicate: ( _msg, _counter ) => true
            } ) ).to.throw();
        } );

        it( 'throws on invalid name (not identifier)', function () {
            expect( () => init( validSpec( '123invalid', ( _msg, _counter ) => true ) ) ).to.throw();
        } );

        it( 'throws on missing predicate', function () {
            expect( () => init( {
                nodeType: PASS_IF_NODE_TYPE,
                name: 'test'
            } ) ).to.throw();
        } );

        it( 'throws on non-function predicate', function () {
            expect( () => init( validSpec( 'test', 'not-a-function' ) ) ).to.throw();
        } );

        it( 'throws on wrong predicate arity (needs 2 params)', function () {
            expect( () => init( validSpec( 'test', ( msg ) => msg.value > 0 ) ) ).to.throw();
        } );
    } );

    describe( 'introspect accessors', function () {
        it( 'getNodeType() returns "Pass If"', function () {
            expect( getNodeType() ).to.equal( PASS_IF_NODE_TYPE );
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

        it( 'DEFAULT_OPTIONS is an empty object', function () {
            expect( DEFAULT_OPTIONS ).to.be.an( 'object' );
            expect( Object.keys( DEFAULT_OPTIONS ) ).to.have.length( 0 );
        } );
    } );

    describe( 'getDSLMetadata() and buildSpec', function () {
        it( 'returns DSL metadata with specSchema', function () {
            const meta = getDSLMetadata();
            expect( meta ).to.have.property( 'specSchema' );
            expect( meta ).to.have.property( 'buildSpec' );
        } );

        it( 'specSchema includes nodeType, name, predicate', function () {
            const { specSchema } = getDSLMetadata();
            expect( specSchema ).to.have.property( 'nodeType' );
            expect( specSchema ).to.have.property( 'name' );
            expect( specSchema ).to.have.property( 'predicate' );
        } );

        it( 'buildSpec creates valid spec', function () {
            const { buildSpec } = getDSLMetadata();
            const pred = ( _msg, counter ) => counter > 0;
            const spec = buildSpec( 'myGate', pred, {} );

            expect( spec.nodeType ).to.equal( PASS_IF_NODE_TYPE );
            expect( spec.name ).to.equal( 'myGate' );
            expect( spec.predicate ).to.equal( pred );
        } );

        it( 'buildSpec merges options', function () {
            const { buildSpec } = getDSLMetadata();
            const spec = buildSpec( 'test', ( _msg, _counter ) => true, { customOpt: 42 } );

            expect( spec.customOpt ).to.equal( 42 );
        } );

        it( 'built spec initializes successfully', function () {
            const { buildSpec } = getDSLMetadata();
            const spec = buildSpec( 'validGate', ( _msg, counter ) => counter > 0, {} );
            const state = init( spec );

            expect( state.nodeType ).to.equal( PASS_IF_NODE_TYPE );
        } );
    } );
} );

// core/wiring/test/wire-linear-graph.specs.js

/**
 * @fileoverview Comprehensive functional tests for wire-linear-graph.js
 *
 * Tests cover:
 * - Wiring in reverse order (terminal to root)
 * - Node module lookup via nodeTypeToModule
 * - Missing module error handling
 * - Full graph execution through all nodes
 * - Options passthrough to wireNode
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import wireLinearGraph from '../wire-linear-graph.js';

describe( 'wireLinearGraph', function () {

    // ========================================================================
    // MOCK NODE MODULES
    // ========================================================================

    const createMockNode = function ( name ) {
        return {
            getNodeType: () => name,
            update: ( state, _msg ) => {
                state.executionOrder = state.executionOrder || [];
                state.executionOrder.push( name );
                return state;
            },
            publishTo: ( _state, msg ) => {
                msg[ `${name}Processed` ] = true;
            }
        };
    };

    // ========================================================================
    // BASIC WIRING
    // ========================================================================

    describe( 'basic wiring', function () {

        it( 'returns a function for single node', function () {
            const specs = [ { name: 'node1', nodeType: 'ES Mean' } ];
            const nodeModules = { esMean: createMockNode( 'esMean' ) };

            const graph = wireLinearGraph( specs, nodeModules );

            expect( typeof graph ).to.equal( 'function' );
        } );

        it( 'returns a function for multiple nodes', function () {
            const specs = [
                { name: 'node1', nodeType: 'ES Mean' },
                { name: 'node2', nodeType: 'Threshold' }
            ];
            const nodeModules = {
                esMean: createMockNode( 'esMean' ),
                threshold: createMockNode( 'threshold' )
            };

            const graph = wireLinearGraph( specs, nodeModules );

            expect( typeof graph ).to.equal( 'function' );
        } );

        it( 'throws if node module not found', function () {
            const specs = [ { name: 'node1', nodeType: 'NonExistent' } ];
            const nodeModules = {};

            expect( () => wireLinearGraph( specs, nodeModules ) )
                .to.throw( /Node module .* not found/ );
        } );

        it( 'handles empty specs array', function () {
            const specs = [];
            const nodeModules = {};

            const graph = wireLinearGraph( specs, nodeModules );

            // Empty graph returns null (last nextHop is null)
            expect( graph ).to.equal( null );
        } );

    } );

    // ========================================================================
    // EXECUTION ORDER
    // ========================================================================

    describe( 'execution order', function () {

        it( 'executes nodes in spec order (first to last)', function () {
            const executionLog = [];

            const createTrackingNode = function ( name ) {
                return {
                    getNodeType: () => name,
                    update: ( state, _msg ) => {
                        executionLog.push( `${name}:update` );
                        return state;
                    },
                    publishTo: ( _state, _msg ) => {
                        executionLog.push( `${name}:publishTo` );
                    }
                };
            };

            const specs = [
                { name: 'first', nodeType: 'ES Mean' },
                { name: 'second', nodeType: 'Threshold' },
                { name: 'third', nodeType: 'Emit If' }
            ];
            const nodeModules = {
                esMean: createTrackingNode( 'esMean' ),
                threshold: createTrackingNode( 'threshold' ),
                emitIf: createTrackingNode( 'emitIf' )
            };

            const graph = wireLinearGraph( specs, nodeModules );
            const stateStore = [ {}, {}, {} ];

            graph( stateStore, {} );

            expect( executionLog ).to.deep.equal( [
                'esMean:update',
                'esMean:publishTo',
                'threshold:update',
                'threshold:publishTo',
                'emitIf:update',
                'emitIf:publishTo'
            ] );
        } );

        it( 'passes message through all nodes', function () {
            const createEnrichingNode = function ( name, field ) {
                return {
                    getNodeType: () => name,
                    update: ( state ) => state,
                    publishTo: ( state, msg ) => {
                        msg[ field ] = true;
                    }
                };
            };

            const specs = [
                { name: 'first', nodeType: 'ES Mean' },
                { name: 'second', nodeType: 'Threshold' }
            ];
            const nodeModules = {
                esMean: createEnrichingNode( 'esMean', 'fromFirst' ),
                threshold: createEnrichingNode( 'threshold', 'fromSecond' )
            };

            const graph = wireLinearGraph( specs, nodeModules );
            const stateStore = [ {}, {} ];
            const msg = { original: true };

            graph( stateStore, msg );

            expect( msg.original ).to.equal( true );
            expect( msg.fromFirst ).to.equal( true );
            expect( msg.fromSecond ).to.equal( true );
        } );

    } );

    // ========================================================================
    // NODE TYPE TO MODULE MAPPING
    // ========================================================================

    describe( 'nodeType to module mapping', function () {

        it( 'converts multi-word nodeType to camelCase', function () {
            const specs = [ { name: 'node1', nodeType: 'Page Hinkley' } ];
            const nodeModules = {
                pageHinkley: createMockNode( 'pageHinkley' )
            };

            const graph = wireLinearGraph( specs, nodeModules );

            expect( typeof graph ).to.equal( 'function' );
        } );

        it( 'converts uppercase acronym to lowercase', function () {
            const specs = [ { name: 'node1', nodeType: 'EWMA' } ];
            const nodeModules = {
                ewma: createMockNode( 'ewma' )
            };

            const graph = wireLinearGraph( specs, nodeModules );

            expect( typeof graph ).to.equal( 'function' );
        } );

        it( 'handles ES Mean nodeType', function () {
            const specs = [ { name: 'node1', nodeType: 'ES Mean' } ];
            const nodeModules = {
                esMean: createMockNode( 'esMean' )
            };

            const graph = wireLinearGraph( specs, nodeModules );

            expect( typeof graph ).to.equal( 'function' );
        } );

        it( 'handles Emit If nodeType', function () {
            const specs = [ { name: 'node1', nodeType: 'Emit If' } ];
            const nodeModules = {
                emitIf: createMockNode( 'emitIf' )
            };

            const graph = wireLinearGraph( specs, nodeModules );

            expect( typeof graph ).to.equal( 'function' );
        } );

    } );

    // ========================================================================
    // STATE STORE ACCESS
    // ========================================================================

    describe( 'state store access', function () {

        it( 'each node accesses correct index in stateStore', function () {
            const accessLog = [];

            const createIndexTrackingNode = function ( name ) {
                return {
                    getNodeType: () => name,
                    update: ( state, _msg ) => {
                        accessLog.push( state.nodeIndex );
                        return state;
                    },
                    publishTo: function () { /* no-op */ }
                };
            };

            const specs = [
                { name: 'first', nodeType: 'ES Mean' },
                { name: 'second', nodeType: 'Threshold' },
                { name: 'third', nodeType: 'Emit If' }
            ];
            const nodeModules = {
                esMean: createIndexTrackingNode( 'esMean' ),
                threshold: createIndexTrackingNode( 'threshold' ),
                emitIf: createIndexTrackingNode( 'emitIf' )
            };

            const graph = wireLinearGraph( specs, nodeModules );
            const stateStore = [
                { nodeIndex: 0 },
                { nodeIndex: 1 },
                { nodeIndex: 2 }
            ];

            graph( stateStore, {} );

            expect( accessLog ).to.deep.equal( [ 0, 1, 2 ] );
        } );

    } );

    // ========================================================================
    // FILTER NODE BEHAVIOR
    // ========================================================================

    describe( 'filter node in graph', function () {

        it( 'stops flow when filter node returns null', function () {
            const executionLog = [];

            const filterNode = {
                getNodeType: () => 'Filter',
                update: ( state, msg ) => {
                    executionLog.push( 'filter:update' );
                    return msg.pass ? state : null;
                },
                publishTo: () => {
                    executionLog.push( 'filter:publishTo' );
                }
            };

            const downstreamNode = {
                getNodeType: () => 'Downstream',
                update: ( state ) => {
                    executionLog.push( 'downstream:update' );
                    return state;
                },
                publishTo: () => {
                    executionLog.push( 'downstream:publishTo' );
                }
            };

            const specs = [
                { name: 'filter', nodeType: 'Pass If' },
                { name: 'downstream', nodeType: 'ES Mean' }
            ];
            const nodeModules = {
                passIf: filterNode,
                esMean: downstreamNode
            };

            const graph = wireLinearGraph( specs, nodeModules );

            // Message blocked by filter
            graph( [ {}, {} ], { pass: false } );
            expect( executionLog ).to.deep.equal( [ 'filter:update' ] );

            // Clear log and send passing message
            executionLog.length = 0;
            graph( [ {}, {} ], { pass: true } );
            expect( executionLog ).to.deep.equal( [
                'filter:update',
                'filter:publishTo',
                'downstream:update',
                'downstream:publishTo'
            ] );
        } );

    } );

    // ========================================================================
    // OPTIONS PASSTHROUGH
    // ========================================================================

    describe( 'options passthrough', function () {

        it( 'passes options to wireNode for error tracking', function () {
            const throwingNode = {
                getNodeType: () => 'Throwing',
                update: function () {
                    throw new Error( 'Test error' );
                },
                publishTo: function () { /* no-op */ }
            };

            const specs = [ { name: 'node1', nodeType: 'ES Mean' } ];
            const nodeModules = { esMean: throwingNode };

            // With trackErrors: false
            const graph = wireLinearGraph( specs, nodeModules, { trackErrors: false } );
            const stateStore = [ {} ];

            try {
                graph( stateStore, {} );
            } catch {
                // Expected
            }

            // errorStats should not exist when tracking disabled
            expect( stateStore[ 0 ].errorStats ).to.equal( undefined );
        } );

    } );

} );

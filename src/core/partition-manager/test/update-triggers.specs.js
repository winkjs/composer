/* eslint-disable no-empty-function */
// core/partition-manager/test/update-triggers.specs.js

/**
 * @fileoverview Trigger resolution specs for partition-manager/update.js.
 *
 * Covers:
 * - Single-target and multi-target trigger resolution
 * - Empty / undefined trigger handling
 * - Target-name, control-method, and homogeneity error paths
 * - `spec.nodeType` fallback when the mock lacks `getNodeType`
 * - Controller-node nested triggers (logic array resolution)
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { init, update } from '../index.js';
import { mockEsMean, mockThreshold, mockController } from './test-helpers.js';

describe( 'Partition Manager — update — triggers', function () {

    describe( 'trigger resolution', function () {

        it( 'resolves empty triggers to empty array', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [ { name: 'ewma', nodeType: 'ES Mean', triggers: [] } ]
                },
                nodeModules: { esMean: mockEsMean },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph = update( composerState, { id: 'S1', value: 100 } );

            expect( graph[ 0 ].resolvedTriggers ).to.deep.equal( [] );
        } );

        it( 'resolves undefined triggers to empty array', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [ { name: 'ewma', nodeType: 'ES Mean' } ] // No triggers property
                },
                nodeModules: { esMean: mockEsMean },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph = update( composerState, { id: 'S1', value: 100 } );

            expect( graph[ 0 ].resolvedTriggers ).to.deep.equal( [] );
        } );

        it( 'resolves single-target trigger', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [
                        { name: 'ewma', nodeType: 'ES Mean' },
                        {
                            name: 'thresh',
                            nodeType: 'Threshold',
                            triggers: [ { control: 'reset', targets: [ 'ewma' ] } ]
                        }
                    ]
                },
                nodeModules: { esMean: mockEsMean, threshold: mockThreshold },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph = update( composerState, { id: 'S1', value: 100 } );

            expect( graph[ 1 ].resolvedTriggers ).to.have.length( 1 );
            expect( typeof graph[ 1 ].resolvedTriggers[ 0 ].control ).to.equal( 'function' );
            expect( graph[ 1 ].resolvedTriggers[ 0 ].targets ).to.have.length( 1 );
            expect( graph[ 1 ].resolvedTriggers[ 0 ].targets[ 0 ] ).to.equal( graph[ 0 ] );
        } );

        it( 'resolves multi-target homogeneous trigger', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [
                        { name: 'fast', nodeType: 'ES Mean' },
                        { name: 'slow', nodeType: 'ES Mean' },
                        {
                            name: 'thresh',
                            nodeType: 'Threshold',
                            triggers: [ { control: 'reset', targets: [ 'fast', 'slow' ] } ]
                        }
                    ]
                },
                nodeModules: { esMean: mockEsMean, threshold: mockThreshold },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph = update( composerState, { id: 'S1', value: 100 } );

            expect( graph[ 2 ].resolvedTriggers[ 0 ].targets ).to.have.length( 2 );
            expect( graph[ 2 ].resolvedTriggers[ 0 ].targets[ 0 ] ).to.equal( graph[ 0 ] );
            expect( graph[ 2 ].resolvedTriggers[ 0 ].targets[ 1 ] ).to.equal( graph[ 1 ] );
        } );

        it( 'throws for non-existent target', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [
                        { name: 'ewma', nodeType: 'ES Mean' },
                        {
                            name: 'thresh',
                            nodeType: 'Threshold',
                            triggers: [ { control: 'reset', targets: [ 'nonexistent' ] } ]
                        }
                    ]
                },
                nodeModules: { esMean: mockEsMean, threshold: mockThreshold },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            expect( () => update( composerState, { id: 'S1', value: 100 } ) )
                .to.throw( 'Target node \'nonexistent\' not found' );
        } );

        it( 'throws for invalid control method', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [
                        { name: 'ewma', nodeType: 'ES Mean' },
                        {
                            name: 'thresh',
                            nodeType: 'Threshold',
                            triggers: [ { control: 'invalidMethod', targets: [ 'ewma' ] } ]
                        }
                    ]
                },
                nodeModules: { esMean: mockEsMean, threshold: mockThreshold },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            expect( () => update( composerState, { id: 'S1', value: 100 } ) )
                .to.throw( 'Control method \'invalidMethod\' not found' );
        } );

        it( 'throws for heterogeneous targets', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [
                        { name: 'ewma', nodeType: 'ES Mean' },
                        { name: 'thresh', nodeType: 'Threshold' },
                        {
                            name: 'ctrl',
                            nodeType: 'Controller',
                            logic: [ {
                                when: () => true,
                                triggers: [ { control: 'reset', targets: [ 'ewma', 'thresh' ] } ]
                            } ]
                        }
                    ]
                },
                nodeModules: {
                    esMean: mockEsMean,
                    threshold: mockThreshold,
                    controller: mockController
                },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            expect( () => update( composerState, { id: 'S1', value: 100 } ) )
                .to.throw( 'incompatible' );
        } );

        it( 'uses spec.nodeType fallback when getNodeType is undefined', function () {
            // Node modules WITHOUT getNodeType method — exercises the fallback
            // branch in the error message construction.
            const noGetNodeTypeEsMean = {
                init: ( spec ) => ( {
                    name: spec.name,
                    nodeType: spec.nodeType,
                    value: 0
                } ),
                update: ( state ) => state,
                publishTo: () => {},
                reset: () => true,
                recompute: () => true
            };
            const noGetNodeTypeThreshold = {
                init: ( spec ) => ( {
                    name: spec.name,
                    nodeType: spec.nodeType,
                    value: 0
                } ),
                update: ( state ) => state,
                publishTo: () => {},
                reset: () => true,
                recompute: () => true
            };
            const noGetNodeTypeController = {
                init: ( spec ) => ( {
                    name: spec.name,
                    nodeType: spec.nodeType,
                    logic: spec.logic ? spec.logic.map( ( l ) => ( { ...l } ) ) : []
                } ),
                update: ( state ) => state,
                publishTo: () => {},
                reset: () => true,
                recompute: () => true
            };

            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [
                        { name: 'ewma', nodeType: 'ES Mean' },
                        { name: 'thresh', nodeType: 'Threshold' },
                        {
                            name: 'ctrl',
                            nodeType: 'Controller',
                            logic: [ {
                                when: () => true,
                                triggers: [ { control: 'reset', targets: [ 'ewma', 'thresh' ] } ]
                            } ]
                        }
                    ]
                },
                nodeModules: {
                    esMean: noGetNodeTypeEsMean,
                    threshold: noGetNodeTypeThreshold,
                    controller: noGetNodeTypeController
                },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            expect( () => update( composerState, { id: 'S1', value: 100 } ) )
                .to.throw( /ES Mean.*incompatible.*Threshold|Threshold.*incompatible.*ES Mean/ );
        } );

        it( 'uses spec.nodeType fallback for reference node error message', function () {
            // Node module without getNodeType and without a reset method — the
            // missing reset forces the control-method-not-found error, and the
            // missing getNodeType forces spec.nodeType fallback.
            const noGetNodeTypeModule = {
                init: ( spec ) => ( {
                    name: spec.name,
                    nodeType: spec.nodeType,
                    value: 0
                } ),
                update: ( state ) => state,
                publishTo: () => {},
                recompute: () => true
            };

            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [
                        { name: 'ewma', nodeType: 'ES Mean' },
                        {
                            name: 'other',
                            nodeType: 'ES Mean',
                            triggers: [ { control: 'reset', targets: [ 'ewma' ] } ]
                        }
                    ]
                },
                nodeModules: { esMean: noGetNodeTypeModule },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            expect( () => update( composerState, { id: 'S1', value: 100 } ) )
                .to.throw( /Control method 'reset' not found on node type 'ES Mean'/ );
        } );

        it( 'throws when referenced node module not found in trigger', function () {
            // Module for the referenced target node is absent from nodeModules.
            const partialModules = {
                esMean: mockEsMean
                // threshold module deliberately missing
            };

            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [
                        { name: 'ewma', nodeType: 'ES Mean' },
                        {
                            name: 'other',
                            nodeType: 'ES Mean',
                            triggers: [ { control: 'reset', targets: [ 'missing' ] } ]
                        },
                        { name: 'missing', nodeType: 'Threshold' } // Module not in nodeModules
                    ]
                },
                nodeModules: partialModules,
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            expect( () => update( composerState, { id: 'S1', value: 100 } ) )
                .to.throw( 'Node module \'threshold\' not found' );
        } );

        it( 'throws for empty target name in subsequent target (j >= 1)', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [
                        { name: 'ewma', nodeType: 'ES Mean' },
                        { name: 'other', nodeType: 'ES Mean' },
                        {
                            name: 'ctrl',
                            nodeType: 'Controller',
                            logic: [ {
                                when: () => true,
                                triggers: [ { control: 'reset', targets: [ 'ewma', '' ] } ]
                            } ]
                        }
                    ]
                },
                nodeModules: { esMean: mockEsMean, controller: mockController },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            expect( () => update( composerState, { id: 'S1', value: 100 } ) )
                .to.throw( /target 1 must be a non-empty string/ );
        } );

        it( 'throws for non-existent subsequent target (j >= 1)', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [
                        { name: 'ewma', nodeType: 'ES Mean' },
                        { name: 'other', nodeType: 'ES Mean' },
                        {
                            name: 'ctrl',
                            nodeType: 'Controller',
                            logic: [ {
                                when: () => true,
                                triggers: [ { control: 'reset', targets: [ 'ewma', 'nonexistent' ] } ]
                            } ]
                        }
                    ]
                },
                nodeModules: { esMean: mockEsMean, controller: mockController },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            expect( () => update( composerState, { id: 'S1', value: 100 } ) )
                .to.throw( /Target node 'nonexistent' not found.*target 1/ );
        } );

        it( 'throws for empty target name', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [
                        { name: 'ewma', nodeType: 'ES Mean' },
                        {
                            name: 'thresh',
                            nodeType: 'Threshold',
                            triggers: [ { control: 'reset', targets: [ '' ] } ]
                        }
                    ]
                },
                nodeModules: { esMean: mockEsMean, threshold: mockThreshold },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            expect( () => update( composerState, { id: 'S1', value: 100 } ) )
                .to.throw( 'must be a non-empty string' );
        } );

    } );

    describe( 'Controller node nested triggers', function () {

        it( 'resolves triggers in Controller logic array', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [
                        { name: 'ewma', nodeType: 'ES Mean' },
                        {
                            name: 'ctrl',
                            nodeType: 'Controller',
                            logic: [ {
                                when: () => true,
                                triggers: [ { control: 'reset', targets: [ 'ewma' ] } ]
                            } ]
                        }
                    ]
                },
                nodeModules: { esMean: mockEsMean, controller: mockController },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph = update( composerState, { id: 'S1', value: 100 } );

            // Controller's top-level resolvedTriggers should be null
            expect( graph[ 1 ].resolvedTriggers ).to.equal( null );

            // Logic array should have resolvedTriggers
            expect( graph[ 1 ].logic[ 0 ].resolvedTriggers ).to.have.length( 1 );
            expect( typeof graph[ 1 ].logic[ 0 ].resolvedTriggers[ 0 ].control ).to.equal( 'function' );
            expect( graph[ 1 ].logic[ 0 ].resolvedTriggers[ 0 ].targets[ 0 ] ).to.equal( graph[ 0 ] );
        } );

        it( 'resolves multiple logic conditions', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [
                        { name: 'fast', nodeType: 'ES Mean' },
                        { name: 'slow', nodeType: 'ES Mean' },
                        {
                            name: 'ctrl',
                            nodeType: 'Controller',
                            logic: [
                                {
                                    when: ( msg ) => msg.resetFast,
                                    triggers: [ { control: 'reset', targets: [ 'fast' ] } ]
                                },
                                {
                                    when: ( msg ) => msg.resetSlow,
                                    triggers: [ { control: 'reset', targets: [ 'slow' ] } ]
                                }
                            ]
                        }
                    ]
                },
                nodeModules: { esMean: mockEsMean, controller: mockController },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph = update( composerState, { id: 'S1', value: 100 } );

            expect( graph[ 2 ].logic ).to.have.length( 2 );
            expect( graph[ 2 ].logic[ 0 ].resolvedTriggers[ 0 ].targets[ 0 ] ).to.equal( graph[ 0 ] );
            expect( graph[ 2 ].logic[ 1 ].resolvedTriggers[ 0 ].targets[ 0 ] ).to.equal( graph[ 1 ] );
        } );

    } );

} );

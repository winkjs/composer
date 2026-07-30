// core/partition-manager/test/update-graph-build.specs.js

/**
 * @fileoverview First-message graph build specs for partition-manager/update.js.
 *
 * Covers the one-shot construction path that runs the first time a
 * (partitionId, specializationType) pair is seen:
 * - Node module lookup (including the missing-module error path)
 * - Multi-node init order
 * - Emit If topic injection (mqtt + terminal targets, no-op for others)
 * - Persist If storage + partitionId injection
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { init, update } from '../index.js';
import { mockEsMean, mockThreshold, mockEmitIf, mockPersistIf } from './test-helpers.js';

describe( 'Partition Manager — update — graph build', function () {

    describe( 'node module lookup', function () {

        it( 'throws if node module not found', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [ { name: 'ewma', nodeType: 'ES Mean' } ]
                },
                nodeModules: {}, // Missing esMean
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            expect( () => update( composerState, { id: 'S1', value: 100 } ) )
                .to.throw( 'Node module \'esMean\' not found' );
        } );

        it( 'initializes multiple nodes in order', function () {
            const initOrder = [];
            const trackingEsMean = {
                ...mockEsMean,
                init: ( spec ) => {
                    initOrder.push( spec.name );
                    return mockEsMean.init( spec );
                }
            };
            const trackingThreshold = {
                ...mockThreshold,
                init: ( spec ) => {
                    initOrder.push( spec.name );
                    return mockThreshold.init( spec );
                }
            };

            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [
                        { name: 'ewma', nodeType: 'ES Mean' },
                        { name: 'thresh', nodeType: 'Threshold' }
                    ]
                },
                nodeModules: { esMean: trackingEsMean, threshold: trackingThreshold },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            update( composerState, { id: 'S1', value: 100 } );

            expect( initOrder ).to.deep.equal( [ 'ewma', 'thresh' ] );
        } );

    } );

    describe( 'Emit If topic injection', function () {

        it( 'injects topic for mqtt target emitIf nodes', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [ {
                        name: 'alert',
                        nodeType: 'Emit If',
                        target: 'mqtt',
                        insightType: 'highValue'
                    } ]
                },
                nodeModules: { emitIf: mockEmitIf },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph = update( composerState, { id: 'S1', value: 100 } );

            expect( graph[ 0 ].topic ).to.include( 'S1' );
            expect( graph[ 0 ].topic ).to.include( 'highValue' );
        } );

        it( 'injects topic for terminal target emitIf nodes', function () {
            const mockTerminalEmitIf = {
                ...mockEmitIf,
                init: ( spec ) => ( {
                    name: spec.name,
                    nodeType: spec.nodeType,
                    target: 'terminal',
                    insightType: spec.insightType || 'debug'
                } )
            };

            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [ {
                        name: 'log',
                        nodeType: 'Emit If',
                        target: 'terminal',
                        insightType: 'debug'
                    } ]
                },
                nodeModules: { emitIf: mockTerminalEmitIf },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph = update( composerState, { id: 'S1', value: 100 } );

            expect( graph[ 0 ].topic ).to.include( 'S1' );
            expect( graph[ 0 ].topic ).to.include( 'debug' );
        } );

        it( 'does not inject topic for non-mqtt/terminal targets', function () {
            const mockGpioEmitIf = {
                ...mockEmitIf,
                init: ( spec ) => ( {
                    name: spec.name,
                    nodeType: spec.nodeType,
                    target: 'gpio',
                    insightType: spec.insightType || 'signal'
                } )
            };

            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [ {
                        name: 'gpio',
                        nodeType: 'Emit If',
                        target: 'gpio',
                        insightType: 'signal'
                    } ]
                },
                nodeModules: { emitIf: mockGpioEmitIf },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph = update( composerState, { id: 'S1', value: 100 } );

            expect( graph[ 0 ].topic ).to.equal( undefined );
        } );

    } );

    describe( 'Persist If storage and partitionId injection', function () {

        it( 'injects spec.storage and partitionId when storage is set', function () {
            const mockStorage = { write: () => { /* no-op */ } };
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [ {
                        name: 'sink',
                        nodeType: 'Persist If',
                        storage: mockStorage
                    } ]
                },
                nodeModules: { persistIf: mockPersistIf },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph = update( composerState, { id: 'S1', value: 100 } );

            expect( graph[ 0 ].storage ).to.equal( mockStorage );
            expect( graph[ 0 ].partitionId ).to.equal( 'S1' );
        } );

        it( 'does not inject storage or partitionId when spec.storage is absent', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [ {
                        name: 'sink',
                        nodeType: 'Persist If'
                        // Note: no `storage` on the spec — injection branch skipped
                    } ]
                },
                nodeModules: { persistIf: mockPersistIf },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph = update( composerState, { id: 'S1', value: 100 } );

            expect( graph[ 0 ].storage ).to.equal( undefined );
            expect( graph[ 0 ].partitionId ).to.equal( undefined );
        } );

        it( 'gives each partition its own partitionId on the shared Persist If spec', function () {
            const mockStorage = { write: () => { /* no-op */ } };
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [ {
                        name: 'sink',
                        nodeType: 'Persist If',
                        storage: mockStorage
                    } ]
                },
                nodeModules: { persistIf: mockPersistIf },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph1 = update( composerState, { id: 'S1', value: 100 } );
            const graph2 = update( composerState, { id: 'S2', value: 200 } );

            // Both partitions share the same storage singleton (injected from spec)
            expect( graph1[ 0 ].storage ).to.equal( mockStorage );
            expect( graph2[ 0 ].storage ).to.equal( mockStorage );

            // But each carries its own partitionId
            expect( graph1[ 0 ].partitionId ).to.equal( 'S1' );
            expect( graph2[ 0 ].partitionId ).to.equal( 'S2' );
        } );

    } );

} );

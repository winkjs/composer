// core/partition-manager/test/update-routing.specs.js

/**
 * @fileoverview Routing and caching specs for partition-manager/update.js.
 *
 * Covers:
 * - partitionId extraction (null field → 0, string field → msg value)
 * - Two-level lookup: partitionId → specializationType → graph
 * - Partition caching (reuse vs. fresh graph)
 * - Unknown specialization handling (drop + error log)
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { init, update } from '../index.js';
import { mockEsMean } from './test-helpers.js';

describe( 'Partition Manager — update — routing', function () {

    describe( 'partitionId extraction', function () {

        it( 'uses 0 when partitionField is null', function () {
            const flow = {
                partitionField: null,
                specializationField: null,
                specsBySpecialization: {
                    0: [ { name: 'ewma', nodeType: 'ES Mean' } ]
                },
                nodeModules: { esMean: mockEsMean },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            update( composerState, { value: 100 } );

            expect( composerState.partitionSpecializations.has( 0 ) ).to.equal( true );
        } );

        it( 'uses message field value when partitionField is set', function () {
            const flow = {
                partitionField: 'sensorId',
                specializationField: null,
                specsBySpecialization: {
                    0: [ { name: 'ewma', nodeType: 'ES Mean' } ]
                },
                nodeModules: { esMean: mockEsMean },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            update( composerState, { sensorId: 'S1', value: 100 } );

            expect( composerState.partitionSpecializations.has( 'S1' ) ).to.equal( true );
        } );

    } );

    describe( 'two-level lookup', function () {

        it( 'creates separate graphs for different specializations in same partition', function () {
            const flow = {
                partitionField: 'pumpId',
                specializationField: 'sensorType',
                specsBySpecialization: {
                    temperature: [ { name: 'tempEwma', nodeType: 'ES Mean' } ],
                    pressure: [ { name: 'pressEwma', nodeType: 'ES Mean' } ]
                },
                nodeModules: { esMean: mockEsMean },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph1 = update( composerState, { pumpId: 'P-1', sensorType: 'temperature', value: 50 } );
            const graph2 = update( composerState, { pumpId: 'P-1', sensorType: 'pressure', value: 100 } );

            expect( graph1 ).to.not.equal( graph2 );

            const specializedGraphs = composerState.partitionSpecializations.get( 'P-1' );
            expect( specializedGraphs.temperature ).to.equal( graph1 );
            expect( specializedGraphs.pressure ).to.equal( graph2 );
        } );

        it( 'reuses same graph for same partition and specialization', function () {
            const flow = {
                partitionField: 'pumpId',
                specializationField: 'sensorType',
                specsBySpecialization: {
                    temperature: [ { name: 'tempEwma', nodeType: 'ES Mean' } ]
                },
                nodeModules: { esMean: mockEsMean },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph1 = update( composerState, { pumpId: 'P-1', sensorType: 'temperature', value: 50 } );
            const graph2 = update( composerState, { pumpId: 'P-1', sensorType: 'temperature', value: 60 } );

            expect( graph1 ).to.equal( graph2 );
        } );

    } );

    describe( 'partition caching', function () {

        it( 'creates new graph on first message', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [ { name: 'ewma', nodeType: 'ES Mean' } ]
                },
                nodeModules: { esMean: mockEsMean },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            expect( composerState.partitionSpecializations.size ).to.equal( 0 );

            update( composerState, { id: 'S1', value: 100 } );

            expect( composerState.partitionSpecializations.size ).to.equal( 1 );
        } );

        it( 'reuses existing graph on subsequent messages', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [ { name: 'ewma', nodeType: 'ES Mean' } ]
                },
                nodeModules: { esMean: mockEsMean },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph1 = update( composerState, { id: 'S1', value: 100 } );
            const graph2 = update( composerState, { id: 'S1', value: 200 } );

            expect( graph1 ).to.equal( graph2 );
            expect( composerState.partitionSpecializations.size ).to.equal( 1 );
        } );

        it( 'creates separate graphs for different partitions', function () {
            const flow = {
                partitionField: 'id',
                specializationField: null,
                specsBySpecialization: {
                    0: [ { name: 'ewma', nodeType: 'ES Mean' } ]
                },
                nodeModules: { esMean: mockEsMean },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const graph1 = update( composerState, { id: 'S1', value: 100 } );
            const graph2 = update( composerState, { id: 'S2', value: 200 } );

            expect( graph1 ).to.not.equal( graph2 );
            expect( composerState.partitionSpecializations.size ).to.equal( 2 );
        } );

    } );

    describe( 'unknown specialization handling', function () {

        let originalConsoleError;
        let capturedErrors;

        beforeEach( function () {
            originalConsoleError = console.error;
            capturedErrors = [];
            console.error = ( msg ) => capturedErrors.push( msg );
        } );

        afterEach( function () {
            console.error = originalConsoleError;
        } );

        it( 'returns null for unknown specialization', function () {
            const flow = {
                partitionField: 'id',
                specializationField: 'type',
                specsBySpecialization: {
                    known: [ { name: 'ewma', nodeType: 'ES Mean' } ]
                },
                nodeModules: { esMean: mockEsMean },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            const result = update( composerState, { id: 'S1', type: 'unknown', value: 100 } );

            expect( result ).to.equal( null );
        } );

        it( 'logs error for unknown specialization', function () {
            const flow = {
                partitionField: 'id',
                specializationField: 'type',
                specsBySpecialization: {
                    known: [ { name: 'ewma', nodeType: 'ES Mean' } ]
                },
                nodeModules: { esMean: mockEsMean },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            update( composerState, { id: 'S1', type: 'unknown', value: 100 } );

            expect( capturedErrors.length ).to.equal( 1 );
            expect( capturedErrors[ 0 ] ).to.include( 'Unknown specialization' );
            expect( capturedErrors[ 0 ] ).to.include( 'unknown' );
        } );

        it( 'does not create partition entry for unknown specialization', function () {
            const flow = {
                partitionField: 'id',
                specializationField: 'type',
                specsBySpecialization: {
                    known: [ { name: 'ewma', nodeType: 'ES Mean' } ]
                },
                nodeModules: { esMean: mockEsMean },
                yieldThreshold: 10000
            };
            const composerState = init( flow );

            update( composerState, { id: 'S1', type: 'unknown', value: 100 } );

            expect( composerState.partitionSpecializations.size ).to.equal( 0 );
            expect( composerState.partitionSpecializations.has( 'S1' ) ).to.equal( false );
        } );

    } );

} );

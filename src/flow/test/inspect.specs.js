// flow/test/inspect.specs.js

/**
 * @fileoverview Tests for flow inspection module.
 *
 * Tests inspectFlow output including:
 * - assetClass information
 * - storageCount
 * - Single-pipeline and multi-specialization modes
 */

/* eslint-disable no-unused-expressions */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { inspectFlow } from '../inspect.js';

describe( 'inspect.js', function () {

    // ========================================================================
    // Basic runtime inspection
    // ========================================================================

    describe( 'basic runtime inspection', function () {

        it( 'returns correct flowName', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const result = inspectFlow( 'myFlow', [], new Set(), runtime, null );

            expect( result.flowName ).to.equal( 'myFlow' );
        } );

        it( 'returns hasSource as false when source is null', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, null );

            expect( result.runtime.hasSource ).to.be.false;
        } );

        it( 'returns hasSource as true when source is set', function () {
            const runtime = {
                source: { adapter: {}, config: {} },
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, null );

            expect( result.runtime.hasSource ).to.be.true;
        } );

        it( 'returns correct emitterCount', function () {
            const runtime = {
                source: null,
                emitters: {
                    mqtt: { adapter: {}, config: {} },
                    terminal: { adapter: {}, config: {} }
                },
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, null );

            expect( result.runtime.emitterCount ).to.equal( 2 );
        } );

    } );

    // ========================================================================
    // Storage count inspection
    // ========================================================================

    describe( 'storageCount', function () {

        it( 'returns 0 when no storages defined', function () {
            const runtime = {
                source: null,
                emitters: {},
                storages: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, null );

            expect( result.runtime.storageCount ).to.equal( 0 );
        } );

        it( 'returns 0 when storages property is undefined', function () {
            const runtime = {
                source: null,
                emitters: {},
                // storages not defined
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, null );

            expect( result.runtime.storageCount ).to.equal( 0 );
        } );

        it( 'returns correct count when storages are defined', function () {
            const runtime = {
                source: null,
                emitters: {},
                storages: {
                    questdb: { adapter: {}, config: {} },
                    timescale: { adapter: {}, config: {} }
                },
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, null );

            expect( result.runtime.storageCount ).to.equal( 2 );
        } );

        it( 'returns 1 for single storage', function () {
            const runtime = {
                source: null,
                emitters: {},
                storages: {
                    questdb: { adapter: {}, config: {} }
                },
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, null );

            expect( result.runtime.storageCount ).to.equal( 1 );
        } );

    } );

    // ========================================================================
    // Asset class inspection
    // ========================================================================

    describe( 'assetClass', function () {

        it( 'returns null when assetClass not defined', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100,
                assetClass: null
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, null );

            expect( result.runtime.assetClass ).to.be.null;
        } );

        it( 'returns null when assetClass is undefined', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
                // assetClass not present
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, null );

            expect( result.runtime.assetClass ).to.be.null;
        } );

        it( 'returns assetClass name when defined', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100,
                assetClass: {
                    name: 'pumpSystem',
                    insightTypes: {
                        operational: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                    }
                }
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, null );

            expect( result.runtime.assetClass ).to.not.be.null;
            expect( result.runtime.assetClass.name ).to.equal( 'pumpSystem' );
        } );

        it( 'returns insightTypes as array of keys', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100,
                assetClass: {
                    name: 'rwmPump',
                    insightTypes: {
                        operational: { columns: [ 'ts' ], designatedTimestamp: 'ts' },
                        washing: { columns: [ 'ts' ], designatedTimestamp: 'ts' },
                        diagnostics: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                    }
                }
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, null );

            expect( result.runtime.assetClass.insightTypes ).to.be.an( 'array' );
            expect( result.runtime.assetClass.insightTypes ).to.have.lengthOf( 3 );
            expect( result.runtime.assetClass.insightTypes ).to.include( 'operational' );
            expect( result.runtime.assetClass.insightTypes ).to.include( 'washing' );
            expect( result.runtime.assetClass.insightTypes ).to.include( 'diagnostics' );
        } );

        it( 'returns empty insightTypes array when insightTypes is empty', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100,
                assetClass: {
                    name: 'emptyAsset',
                    insightTypes: {}
                }
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, null );

            expect( result.runtime.assetClass.insightTypes ).to.be.an( 'array' );
            expect( result.runtime.assetClass.insightTypes ).to.have.lengthOf( 0 );
        } );

        it( 'returns empty insightTypes array when insightTypes is undefined', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100,
                assetClass: {
                    name: 'noInsightTypesAsset'
                    // insightTypes not defined
                }
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, null );

            expect( result.runtime.assetClass.insightTypes ).to.be.an( 'array' );
            expect( result.runtime.assetClass.insightTypes ).to.have.lengthOf( 0 );
        } );

    } );

    // ========================================================================
    // Single-pipeline mode
    // ========================================================================

    describe( 'single-pipeline mode', function () {

        it( 'returns mode as single-pipeline when switchState is null', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, null );

            expect( result.mode ).to.equal( 'single-pipeline' );
        } );

        it( 'returns mode as single-pipeline when switchState.active is false', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const switchState = { active: false };

            const result = inspectFlow( 'test', [], new Set(), runtime, switchState );

            expect( result.mode ).to.equal( 'single-pipeline' );
        } );

        it( 'returns correct nodeCount in single-pipeline mode', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const flowDefinition = [
                { name: 'node1', nodeType: 'ES Mean' },
                { name: 'node2', nodeType: 'Threshold' },
                { name: 'node3', nodeType: 'Emit If' }
            ];

            const result = inspectFlow( 'test', flowDefinition, new Set(), runtime, null );

            expect( result.nodeCount ).to.equal( 3 );
        } );

        it( 'returns nodes with name and type in single-pipeline mode', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const flowDefinition = [
                { name: 'ewma', nodeType: 'ES Mean' },
                { name: 'alert', nodeType: 'Threshold' }
            ];

            const result = inspectFlow( 'test', flowDefinition, new Set(), runtime, null );

            expect( result.nodes ).to.have.lengthOf( 2 );
            expect( result.nodes[ 0 ] ).to.deep.equal( { name: 'ewma', type: 'ES Mean' } );
            expect( result.nodes[ 1 ] ).to.deep.equal( { name: 'alert', type: 'Threshold' } );
        } );

    } );

    // ========================================================================
    // Multi-specialization mode
    // ========================================================================

    describe( 'multi-specialization mode', function () {

        it( 'returns mode as multi-specialization when switchState.active is true', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const switchState = {
                active: true,
                caseOrder: [ 'typeA', 'typeB' ],
                caseSpecs: {
                    typeA: [ { name: 'a1', nodeType: 'ES Mean' } ],
                    typeB: [ { name: 'b1', nodeType: 'Threshold' } ]
                }
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, switchState );

            expect( result.mode ).to.equal( 'multi-specialization' );
        } );

        it( 'returns total nodeCount across all specializations', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const switchState = {
                active: true,
                caseOrder: [ 'typeA', 'typeB' ],
                caseSpecs: {
                    typeA: [
                        { name: 'a1', nodeType: 'ES Mean' },
                        { name: 'a2', nodeType: 'Threshold' }
                    ],
                    typeB: [
                        { name: 'b1', nodeType: 'Diff' }
                    ]
                }
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, switchState );

            expect( result.nodeCount ).to.equal( 3 ); // 2 + 1
        } );

        it( 'returns caseOrder in multi-specialization mode', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const switchState = {
                active: true,
                caseOrder: [ 'typeA', 'typeB', 'typeC' ],
                caseSpecs: {
                    typeA: [],
                    typeB: [],
                    typeC: []
                }
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, switchState );

            expect( result.caseOrder ).to.deep.equal( [ 'typeA', 'typeB', 'typeC' ] );
        } );

        it( 'returns specializations with nodeCount and nodes for each case', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const switchState = {
                active: true,
                caseOrder: [ 'pump', 'valve' ],
                caseSpecs: {
                    pump: [
                        { name: 'pumpEwma', nodeType: 'ES Mean' },
                        { name: 'pumpThresh', nodeType: 'Threshold' }
                    ],
                    valve: [
                        { name: 'valveStatus', nodeType: 'Pass If' }
                    ]
                }
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, switchState );

            expect( result.specializations.pump.nodeCount ).to.equal( 2 );
            expect( result.specializations.pump.nodes ).to.deep.equal( [
                { name: 'pumpEwma', type: 'ES Mean' },
                { name: 'pumpThresh', type: 'Threshold' }
            ] );

            expect( result.specializations.valve.nodeCount ).to.equal( 1 );
            expect( result.specializations.valve.nodes ).to.deep.equal( [
                { name: 'valveStatus', type: 'Pass If' }
            ] );
        } );

    } );

    // ========================================================================
    // Imports
    // ========================================================================

    describe( 'imports', function () {

        it( 'returns sorted imports from importSet', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const importSet = new Set( [ 'threshold', 'esMean', 'diff', 'sanitize' ] );

            const result = inspectFlow( 'test', [], importSet, runtime, null );

            expect( result.imports ).to.deep.equal( [ 'diff', 'esMean', 'sanitize', 'threshold' ] );
        } );

        it( 'returns empty array when no imports', function () {
            const runtime = {
                source: null,
                emitters: {},
                partitionField: null,
                specializationField: null,
                yieldThreshold: 100
            };

            const result = inspectFlow( 'test', [], new Set(), runtime, null );

            expect( result.imports ).to.deep.equal( [] );
        } );

    } );

} );

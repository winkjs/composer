/* eslint-disable no-unused-expressions */
/**
 * @fileoverview Tests for validate-triggers.js
 *
 * Tests fail-fast trigger validation:
 * - R1: Target node existence
 * - R2: Circular reference detection
 * - R3: Control method validation
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    validateTriggers,
    extractTriggers,
    buildNodeIndex,
    validateTargetExists,
    detectCycles,
    validateControlMethod
} from '../validate-triggers.js';

describe( 'validate-triggers', function () {

    // Mock node modules with getSupportedControlMethods
    const createMockModule = function ( controlMethods ) {
        return {
            getSupportedControlMethods: () => ( { ...controlMethods } ),
            getNodeType: () => 'MockNode'
        };
    };

    const mockModules = {
        esStats: createMockModule( {
            reset: 'Resets state',
            enable: 'Enables processing',
            disable: 'Disables processing'
        } ),
        threshold: createMockModule( {
            reset: 'Resets state',
            enable: 'Enables processing',
            disable: 'Disables processing'
        } ),
        controller: createMockModule( {} ), // No control methods
        emitIf: createMockModule( {} )       // No control methods
    };

    describe( 'extractTriggers', function () {

        it( 'extracts direct triggers from spec.triggers', function () {
            const spec = {
                name: 'node1',
                nodeType: 'ES Stats',
                triggers: [
                    { control: 'reset', targets: [ 'a' ] },
                    { control: 'enable', targets: [ 'b' ] }
                ]
            };

            const triggers = extractTriggers( spec );

            expect( triggers ).to.have.lengthOf( 2 );
            expect( triggers[ 0 ].control ).to.equal( 'reset' );
            expect( triggers[ 1 ].control ).to.equal( 'enable' );
        } );

        it( 'extracts nested triggers from Controller logic array', function () {
            const spec = {
                name: 'ctrl',
                nodeType: 'Controller',
                logic: [
                    {
                        when: () => true,
                        triggers: [ { control: 'reset', targets: [ 'fast' ] } ]
                    },
                    {
                        when: () => false,
                        triggers: [ { control: 'disable', targets: [ 'slow' ] } ]
                    }
                ]
            };

            const triggers = extractTriggers( spec );

            expect( triggers ).to.have.lengthOf( 2 );
            expect( triggers[ 0 ].control ).to.equal( 'reset' );
            expect( triggers[ 0 ].targets ).to.deep.equal( [ 'fast' ] );
            expect( triggers[ 1 ].control ).to.equal( 'disable' );
            expect( triggers[ 1 ].targets ).to.deep.equal( [ 'slow' ] );
        } );

        it( 'returns empty array for spec without triggers', function () {
            const spec = {
                name: 'node1',
                nodeType: 'ES Stats'
            };

            const triggers = extractTriggers( spec );

            expect( triggers ).to.be.an( 'array' ).that.is.empty;
        } );

        it( 'combines direct triggers and logic triggers', function () {
            const spec = {
                name: 'hybrid',
                nodeType: 'Controller',
                triggers: [ { control: 'reset', targets: [ 'direct' ] } ],
                logic: [
                    {
                        when: () => true,
                        triggers: [ { control: 'enable', targets: [ 'nested' ] } ]
                    }
                ]
            };

            const triggers = extractTriggers( spec );

            expect( triggers ).to.have.lengthOf( 2 );
            expect( triggers[ 0 ].targets ).to.deep.equal( [ 'direct' ] );
            expect( triggers[ 1 ].targets ).to.deep.equal( [ 'nested' ] );
        } );

        it( 'handles logic items without triggers array', function () {
            const spec = {
                name: 'ctrl',
                nodeType: 'Controller',
                logic: [
                    { when: () => true },  // No triggers
                    { when: () => false, triggers: [ { control: 'reset', targets: [ 'a' ] } ] }
                ]
            };

            const triggers = extractTriggers( spec );

            expect( triggers ).to.have.lengthOf( 1 );
            expect( triggers[ 0 ].control ).to.equal( 'reset' );
        } );

    } );

    describe( 'buildNodeIndex', function () {

        it( 'builds index from specs array', function () {
            const specs = [
                { name: 'node1', nodeType: 'ES Stats' },
                { name: 'node2', nodeType: 'Threshold' }
            ];

            const index = buildNodeIndex( specs );

            expect( index.size ).to.equal( 2 );
            expect( index.has( 'node1' ) ).to.be.true;
            expect( index.has( 'node2' ) ).to.be.true;
            expect( index.get( 'node1' ).index ).to.equal( 0 );
            expect( index.get( 'node2' ).index ).to.equal( 1 );
        } );

        it( 'handles empty specs', function () {
            const index = buildNodeIndex( [] );
            expect( index.size ).to.equal( 0 );
        } );

    } );

    describe( 'R1: validateTargetExists', function () {

        it( 'passes when all targets exist', function () {
            const specs = [
                { name: 'stats', nodeType: 'ES Stats' },
                {
                    name: 'thresh',
                    nodeType: 'Threshold',
                    triggers: [ { control: 'reset', targets: [ 'stats' ] } ]
                }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = validateTargetExists( specs, nodeIndex );

            expect( errors ).to.be.an( 'array' ).that.is.empty;
        } );

        it( 'reports error for non-existent target', function () {
            const specs = [
                {
                    name: 'thresh',
                    nodeType: 'Threshold',
                    triggers: [ { control: 'reset', targets: [ 'nonExistent' ] } ]
                }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = validateTargetExists( specs, nodeIndex );

            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'nonExistent' );
            expect( errors[ 0 ] ).to.include( 'unknown target' );
        } );

        it( 'reports multiple errors for multiple missing targets', function () {
            const specs = [
                {
                    name: 'thresh',
                    nodeType: 'Threshold',
                    triggers: [
                        { control: 'reset', targets: [ 'missing1', 'missing2' ] }
                    ]
                }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = validateTargetExists( specs, nodeIndex );

            expect( errors ).to.have.lengthOf( 2 );
        } );

        it( 'handles nodes without triggers', function () {
            const specs = [
                { name: 'stats', nodeType: 'ES Stats' }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = validateTargetExists( specs, nodeIndex );

            expect( errors ).to.be.empty;
        } );

        it( 'handles trigger without targets property (undefined)', function () {
            const specs = [
                {
                    name: 'thresh',
                    nodeType: 'Threshold',
                    triggers: [
                        { control: 'reset' }  // No targets property - should use [] fallback
                    ]
                }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = validateTargetExists( specs, nodeIndex );

            expect( errors ).to.be.empty;
        } );

    } );

    describe( 'R2: detectCycles', function () {

        it( 'passes for acyclic trigger graph', function () {
            const specs = [
                { name: 'a', nodeType: 'ES Stats' },
                {
                    name: 'b',
                    nodeType: 'Threshold',
                    triggers: [ { control: 'reset', targets: [ 'a' ] } ]
                },
                {
                    name: 'c',
                    nodeType: 'Threshold',
                    triggers: [ { control: 'reset', targets: [ 'b' ] } ]
                }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = detectCycles( specs, nodeIndex );

            expect( errors ).to.be.empty;
        } );

        it( 'detects direct cycle (A triggers B, B triggers A)', function () {
            const specs = [
                {
                    name: 'a',
                    nodeType: 'ES Stats',
                    triggers: [ { control: 'reset', targets: [ 'b' ] } ]
                },
                {
                    name: 'b',
                    nodeType: 'Threshold',
                    triggers: [ { control: 'reset', targets: [ 'a' ] } ]
                }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = detectCycles( specs, nodeIndex );

            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Circular' );
        } );

        it( 'detects indirect cycle (A → B → C → A)', function () {
            const specs = [
                {
                    name: 'a',
                    nodeType: 'ES Stats',
                    triggers: [ { control: 'reset', targets: [ 'b' ] } ]
                },
                {
                    name: 'b',
                    nodeType: 'Threshold',
                    triggers: [ { control: 'reset', targets: [ 'c' ] } ]
                },
                {
                    name: 'c',
                    nodeType: 'Threshold',
                    triggers: [ { control: 'reset', targets: [ 'a' ] } ]
                }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = detectCycles( specs, nodeIndex );

            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Circular' );
        } );

        it( 'handles nodes without triggers', function () {
            const specs = [
                { name: 'a', nodeType: 'ES Stats' },
                { name: 'b', nodeType: 'Threshold' }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = detectCycles( specs, nodeIndex );

            expect( errors ).to.be.empty;
        } );

        it( 'handles trigger without targets property (undefined)', function () {
            const specs = [
                {
                    name: 'a',
                    nodeType: 'ES Stats',
                    triggers: [
                        { control: 'reset' }  // No targets property - uses || [] fallback
                    ]
                },
                { name: 'b', nodeType: 'Threshold' }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = detectCycles( specs, nodeIndex );

            expect( errors ).to.be.empty;
        } );

    } );

    describe( 'R3: validateControlMethod', function () {

        it( 'passes for valid control method', function () {
            const specs = [
                { name: 'stats', nodeType: 'ES Stats' },
                {
                    name: 'thresh',
                    nodeType: 'Threshold',
                    triggers: [ { control: 'reset', targets: [ 'stats' ] } ]
                }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = validateControlMethod( specs, nodeIndex, mockModules );

            expect( errors ).to.be.empty;
        } );

        it( 'reports error for unsupported control method', function () {
            const specs = [
                { name: 'stats', nodeType: 'ES Stats' },
                {
                    name: 'thresh',
                    nodeType: 'Threshold',
                    triggers: [ { control: 'invalidMethod', targets: [ 'stats' ] } ]
                }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = validateControlMethod( specs, nodeIndex, mockModules );

            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'invalidMethod' );
            expect( errors[ 0 ] ).to.include( 'only supports' );
        } );

        it( 'reports error for control method on node with no methods', function () {
            const specs = [
                { name: 'ctrl', nodeType: 'Controller' },
                {
                    name: 'thresh',
                    nodeType: 'Threshold',
                    triggers: [ { control: 'reset', targets: [ 'ctrl' ] } ]
                }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = validateControlMethod( specs, nodeIndex, mockModules );

            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'reset' );
            expect( errors[ 0 ] ).to.include( '(none)' );
        } );

        it( 'reports error when node module not found', function () {
            const specs = [
                { name: 'unknown', nodeType: 'Unknown Node' },
                {
                    name: 'thresh',
                    nodeType: 'Threshold',
                    triggers: [ { control: 'reset', targets: [ 'unknown' ] } ]
                }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = validateControlMethod( specs, nodeIndex, mockModules );

            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'not found' );
        } );

        it( 'skips validation for empty targets', function () {
            const specs = [
                {
                    name: 'thresh',
                    nodeType: 'Threshold',
                    triggers: [ { control: 'reset', targets: [] } ]
                }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = validateControlMethod( specs, nodeIndex, mockModules );

            expect( errors ).to.be.empty;
        } );

        it( 'reports error for module missing getSupportedControlMethods', function () {
            const specs = [
                { name: 'target', nodeType: 'Broken Node' },
                {
                    name: 'source',
                    nodeType: 'ES Stats',
                    triggers: [ { control: 'reset', targets: [ 'target' ] } ]
                }
            ];
            const nodeIndex = buildNodeIndex( specs );

            // Module exists but lacks getSupportedControlMethods function
            const brokenModules = {
                ...mockModules,
                brokenNode: {
                    getNodeType: () => 'Broken Node'
                    // No getSupportedControlMethods!
                }
            };

            const errors = validateControlMethod( specs, nodeIndex, brokenModules );

            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'missing getSupportedControlMethods' );
        } );

        it( 'handles trigger without targets property (undefined)', function () {
            const specs = [
                {
                    name: 'thresh',
                    nodeType: 'Threshold',
                    triggers: [
                        { control: 'reset' }  // No targets property - uses || [] fallback
                    ]
                }
            ];
            const nodeIndex = buildNodeIndex( specs );

            const errors = validateControlMethod( specs, nodeIndex, mockModules );

            expect( errors ).to.be.empty;
        } );

        it( 'skips validation when target not in nodeIndex (R1 will catch)', function () {
            // This tests validateSingleTriggerMethod returning null for missing target
            // In integration, R1 catches this first, but unit test verifies defensive code
            const specs = [
                {
                    name: 'thresh',
                    nodeType: 'Threshold',
                    triggers: [ { control: 'reset', targets: [ 'nonExistent' ] } ]
                }
            ];
            // Build index but don't include 'nonExistent' (simulating incomplete index)
            const nodeIndex = buildNodeIndex( specs );

            const errors = validateControlMethod( specs, nodeIndex, mockModules );

            // Should return empty - validateSingleTriggerMethod returns null for missing target
            expect( errors ).to.be.empty;
        } );

    } );

    describe( 'validateTriggers (integration)', function () {

        it( 'returns valid for flow without triggers', function () {
            const specs = [
                { name: 'stats', nodeType: 'ES Stats' },
                { name: 'thresh', nodeType: 'Threshold' }
            ];

            const result = validateTriggers( specs, mockModules );

            expect( result.valid ).to.be.true;
            expect( result.errors ).to.be.empty;
        } );

        it( 'returns valid for correct trigger configuration', function () {
            const specs = [
                { name: 'stats', nodeType: 'ES Stats' },
                {
                    name: 'thresh',
                    nodeType: 'Threshold',
                    triggers: [ { control: 'reset', targets: [ 'stats' ] } ]
                }
            ];

            const result = validateTriggers( specs, mockModules );

            expect( result.valid ).to.be.true;
            expect( result.errors ).to.be.empty;
        } );

        it( 'stops at R1 errors before checking R2/R3', function () {
            const specs = [
                {
                    name: 'thresh',
                    nodeType: 'Threshold',
                    triggers: [ { control: 'invalidMethod', targets: [ 'nonExistent' ] } ]
                }
            ];

            const result = validateTriggers( specs, mockModules );

            expect( result.valid ).to.be.false;
            // Should only have R1 error, not R3 (invalid method)
            expect( result.errors ).to.have.lengthOf( 1 );
            expect( result.errors[ 0 ] ).to.include( 'nonExistent' );
        } );

        it( 'reports all errors within same validation phase', function () {
            const specs = [
                {
                    name: 'thresh',
                    nodeType: 'Threshold',
                    triggers: [
                        { control: 'reset', targets: [ 'missing1' ] },
                        { control: 'reset', targets: [ 'missing2' ] }
                    ]
                }
            ];

            const result = validateTriggers( specs, mockModules );

            expect( result.valid ).to.be.false;
            expect( result.errors ).to.have.lengthOf( 2 );
        } );

        it( 'handles empty specs array', function () {
            const result = validateTriggers( [], mockModules );

            expect( result.valid ).to.be.true;
            expect( result.errors ).to.be.empty;
        } );

        it( 'validates cpd-flow-like structure with controller triggers', function () {
            // Mimics the cpd-flow.js structure with controller node triggering ES Mean resets
            const cpdSpecs = [
                { name: 'sane', nodeType: 'Sanitize' },
                { name: 'm3', nodeType: 'Median3' },
                { name: 'fast', nodeType: 'ES Mean' },
                { name: 'slow', nodeType: 'ES Mean' },
                { name: 'diff', nodeType: 'Diff' },
                { name: 'ph', nodeType: 'Page Hinkley' },
                { name: 'cpd', nodeType: 'Persistence Check' },
                {
                    name: 'ctrl',
                    nodeType: 'Controller',
                    triggers: [
                        { control: 'reset', targets: [ 'fast', 'slow' ] }
                    ]
                },
                { name: 'eif', nodeType: 'Emit If' }
            ];

            const cpdModules = {
                sanitize: createMockModule( { reset: 'Reset state' } ),
                median3: createMockModule( {} ),
                esMean: createMockModule( {
                    reset: 'Resets state',
                    enable: 'Enables processing',
                    disable: 'Disables processing'
                } ),
                diff: createMockModule( {} ),
                pageHinkley: createMockModule( { reset: 'Reset state' } ),
                persistenceCheck: createMockModule( { reset: 'Reset state' } ),
                controller: createMockModule( {} ),
                emitIf: createMockModule( {} )
            };

            const result = validateTriggers( cpdSpecs, cpdModules );

            expect( result.valid ).to.be.true;
            expect( result.errors ).to.be.empty;
        } );

        it( 'catches invalid control method in cpd-flow-like structure', function () {
            // Same structure but with invalid control method
            const cpdSpecs = [
                { name: 'fast', nodeType: 'ES Mean' },
                { name: 'slow', nodeType: 'ES Mean' },
                {
                    name: 'ctrl',
                    nodeType: 'Controller',
                    triggers: [
                        { control: 'restart', targets: [ 'fast', 'slow' ] }  // Invalid method
                    ]
                }
            ];

            const cpdModules = {
                esMean: createMockModule( {
                    reset: 'Resets state',
                    enable: 'Enables processing',
                    disable: 'Disables processing'
                } ),
                controller: createMockModule( {} )
            };

            const result = validateTriggers( cpdSpecs, cpdModules );

            expect( result.valid ).to.be.false;
            expect( result.errors ).to.have.lengthOf( 1 );
            expect( result.errors[ 0 ] ).to.include( 'restart' );
            expect( result.errors[ 0 ] ).to.include( 'only supports' );
        } );

    } );

} );

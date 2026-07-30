// flow/test/flow-coverage.specs.js

/**
 * @fileoverview Comprehensive flow integration tests for full code coverage.
 *
 * These tests exercise code paths in core infrastructure that are only
 * reachable through the flow DSL, including:
 * - Partition manager edge cases (yielding, Apply nodes, error paths)
 * - Wire node error handling and tracking
 * - Trigger resolution validation
 * - Multi-partition key handling
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import { flow } from '../../composer.js';
import { makeMockEmitterHandle } from '../../core/emitter-manager/test/test-helpers.js';

describe( 'flow — comprehensive coverage', function () {

    let pipelineHandle = null;

    afterEach( async function () {
        if ( pipelineHandle && pipelineHandle.shutdown ) {
            await pipelineHandle.shutdown();
            pipelineHandle = null;
        }
    } );

    // ========================================================================
    // PARTITION KEY VARIATIONS
    // ========================================================================

    describe( 'partition key handling', function () {

        it( 'handles no partition field (global partition)', async function () {
            // No .assetId() call means all messages go to same partition (id=0)
            pipelineHandle = await flow( 'noPartition' )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 2 } )
                .run();

            const msg1 = { value: 100 };
            await pipelineHandle.processMessage( msg1 );
            expect( msg1 ).to.have.property( 'smoothed' );

            // Second message uses same partition (id = 0)
            const msg2 = { value: 200 };
            await pipelineHandle.processMessage( msg2 );
            expect( msg2.smoothed ).to.not.equal( msg1.smoothed ); // EWMA accumulated
        } );

        it( 'handles single partition key', async function () {
            pipelineHandle = await flow( 'singleKey' )
                .assetId( 'sensorId' )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 2 } )
                .run();

            const msg = { sensorId: 'S1', value: 100 };
            await pipelineHandle.processMessage( msg );
            expect( msg ).to.have.property( 'smoothed' );
        } );

        it( 'creates separate partitions for different field values', async function () {
            pipelineHandle = await flow( 'multiPartition' )
                .assetId( 'sensorId' )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 2 } )
                .run();

            const msg1 = { sensorId: 'S1', value: 100 };
            const msg2 = { sensorId: 'S2', value: 200 };
            await pipelineHandle.processMessage( msg1 );
            await pipelineHandle.processMessage( msg2 );

            // Different partition values = different partitions
            const partitions = pipelineHandle.composerState.partitionSpecializations;
            expect( partitions.has( 'S1' ) ).to.equal( true );
            expect( partitions.has( 'S2' ) ).to.equal( true );
        } );

        it( 'reuses same partition for same field value', async function () {
            pipelineHandle = await flow( 'samePartition' )
                .assetId( 'sensorId' )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 2 } )
                .run();

            const msg1 = { sensorId: 'S1', value: 100 };
            const msg2 = { sensorId: 'S1', value: 200 };
            await pipelineHandle.processMessage( msg1 );
            await pipelineHandle.processMessage( msg2 );

            // Same partition value = same graph reused
            const partitions = pipelineHandle.composerState.partitionSpecializations;
            expect( partitions.size ).to.equal( 1 );
        } );

    } );

    // ========================================================================
    // EMITIF NODE WITH TOPIC INJECTION
    // ========================================================================

    describe( 'emitIf topic injection', function () {

        it( 'injects MQTT topic for mqtt target', async function () {
            const mockEmitter = {
                id: 'mqtt',
                durabilityClass: 'best-effort',
                createEmitter: function () {
                    return makeMockEmitterHandle();
                }
            };

            pipelineHandle = await flow( 'mqttTopic' )
                .emitter( mockEmitter, {} )
                .assetId( 'sensorId' )
                .emitIf( 'alert', ( msg ) => msg.value > 100,
                    { target: 'mqtt', insightType: 'highValue' } )
                .run();

            const msg = { sensorId: 'S1', value: 150 };
            await pipelineHandle.processMessage( msg );

            // Topic should be injected in state (two-level lookup)
            const partitions = pipelineHandle.composerState.partitionSpecializations;
            const stateStore = partitions.get( 'S1' )[ 0 ]; // Default specialization is 0
            expect( stateStore[ 0 ].topic ).to.include( 'S1' );
            expect( stateStore[ 0 ].topic ).to.include( 'highValue' );
        } );

        it( 'injects topic for terminal target', async function () {
            const mockEmitter = {
                id: 'terminal',
                durabilityClass: 'best-effort',
                createEmitter: function () {
                    return makeMockEmitterHandle();
                }
            };

            pipelineHandle = await flow( 'terminalTopic' )
                .emitter( mockEmitter, {} )
                .assetId( 'id' )
                .emitIf( 'log', ( _msg ) => true,
                    { target: 'terminal', insightType: 'debug' } )
                .run();

            const msg = { id: 'test', value: 1 };
            await pipelineHandle.processMessage( msg );

            const partitions = pipelineHandle.composerState.partitionSpecializations;
            const stateStore = partitions.get( 'test' )[ 0 ]; // Default specialization is 0
            expect( stateStore[ 0 ].topic ).to.include( 'debug' );
        } );

    } );

    // ========================================================================
    // CONTROLLER WITH TRIGGERS (trigger resolution paths)
    // ========================================================================

    describe( 'trigger resolution', function () {

        it( 'resolves single-target triggers', async function () {
            pipelineHandle = await flow( 'singleTarget' )
                .assetId( 'id' )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 2 } )
                .controller( 'ctrl', [ {
                    when: ( msg ) => msg.reset === true,
                    triggers: [ { control: 'reset', targets: [ 'ewma' ] } ]
                } ] )
                .run();

            // Build up state
            const msg1 = { id: 'S1', value: 100 };
            await pipelineHandle.processMessage( msg1 );
            const firstSmoothed = msg1.smoothed;

            // Trigger reset
            const msg2 = { id: 'S1', value: 50, reset: true };
            await pipelineHandle.processMessage( msg2 );

            // After reset, next value starts fresh
            const msg3 = { id: 'S1', value: 50 };
            await pipelineHandle.processMessage( msg3 );

            // Smoothed should be different from accumulated value
            expect( msg3.smoothed ).to.not.equal( firstSmoothed );
        } );

        it( 'resolves multi-target triggers (homogeneous)', async function () {
            pipelineHandle = await flow( 'multiTarget' )
                .assetId( 'id' )
                .esMean( 'fastEwma', 'value', { mean: 'fast' }, { halfLife: 5 } )
                .esMean( 'slowEwma', 'value', { mean: 'slow' }, { halfLife: 20 } )
                .controller( 'ctrl', [ {
                    when: ( msg ) => msg.resetAll === true,
                    triggers: [ { control: 'reset', targets: [ 'fastEwma', 'slowEwma' ] } ]
                } ] )
                .run();

            // Build up state with multiple messages
            await pipelineHandle.processMessage( { id: 'S1', value: 100 } );
            await pipelineHandle.processMessage( { id: 'S1', value: 101 } );
            await pipelineHandle.processMessage( { id: 'S1', value: 102 } );
            await pipelineHandle.processMessage( { id: 'S1', value: 103 } );
            await pipelineHandle.processMessage( { id: 'S1', value: 104 } );

            // Both EWMAs should be initialized (two-level lookup)
            const partitions = pipelineHandle.composerState.partitionSpecializations;
            const stateStoreBefore = partitions.get( 'S1' )[ 0 ]; // Default specialization is 0
            expect( stateStoreBefore[ 0 ].isInitialized ).to.equal( true );
            expect( stateStoreBefore[ 1 ].isInitialized ).to.equal( true );

            // Store esmValue before reset
            const fastValueBefore = stateStoreBefore[ 0 ].esmValue;
            const slowValueBefore = stateStoreBefore[ 1 ].esmValue;

            // Reset both
            await pipelineHandle.processMessage( { id: 'S1', value: 50, resetAll: true } );

            // After reset, isInitialized should be false (reset clears state)
            const stateStoreAfter = partitions.get( 'S1' )[ 0 ];
            // Reset puts state back to uninitialized, then update re-initializes
            // So after reset+update, value should be different from before
            expect( stateStoreAfter[ 0 ].esmValue ).to.not.equal( fastValueBefore );
            expect( stateStoreAfter[ 1 ].esmValue ).to.not.equal( slowValueBefore );
        } );

    } );

    // ========================================================================
    // FILTER NODE (passIf) - update returns null path
    // ========================================================================

    describe( 'filter node (passIf)', function () {

        it( 'blocks messages that fail predicate', async function () {
            pipelineHandle = await flow( 'filterTest' )
                .assetId( 'id' )
                .passIf( 'onlyPositive', ( msg, _counter ) => msg.value > 0 )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 2 } )
                .run();

            // Negative value should be blocked
            const msg1 = { id: 'S1', value: -10 };
            await pipelineHandle.processMessage( msg1 );
            expect( msg1 ).to.not.have.property( 'smoothed' ); // Never reached esMean

            // Positive value should pass through
            const msg2 = { id: 'S1', value: 10 };
            await pipelineHandle.processMessage( msg2 );
            expect( msg2 ).to.have.property( 'smoothed' );
        } );

    } );

    // ========================================================================
    // MULTI-NODE PIPELINES (fan-out via linear graph)
    // ========================================================================

    describe( 'multi-node pipelines', function () {

        it( 'chains multiple nodes in sequence', async function () {
            pipelineHandle = await flow( 'chainedNodes' )
                .assetId( 'id' )
                .sanitize( 'sanitize', 'value',
                    { failureReason: 'bad' },
                    { ranges: { value: { min: 0, max: 1000 } } } )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 2 } )
                .threshold( 'alert', 'smoothed',
                    { active: 'isHigh' },
                    { threshold: 50, mode: 'above', hysteresis: 5 } )
                .run();

            const msg = { id: 'S1', value: 100 };
            await pipelineHandle.processMessage( msg );

            // All nodes should have processed
            expect( msg ).to.not.have.property( 'bad' ); // In range, no failure
            expect( msg ).to.have.property( 'smoothed' );
            expect( msg ).to.have.property( 'isHigh' );
        } );

    } );

    // ========================================================================
    // SPECIALIZATION WITH EMITIF
    // ========================================================================

    describe( 'emitIf with direct predicate', function () {

        it( 'emits when predicate returns true', async function () {
            const mockEmitter = {
                id: 'mqtt',
                durabilityClass: 'best-effort',
                createEmitter: function () {
                    return makeMockEmitterHandle();
                }
            };

            pipelineHandle = await flow( 'emitDirect' )
                .emitter( mockEmitter, {} )
                .assetId( 'id' )
                .emitIf( 'alert', ( msg ) => msg.value > 100,
                    { target: 'mqtt', insightType: 'highValue' } )
                .run();

            // Below threshold - no emit
            const msg1 = { id: 'S1', value: 50 };
            await pipelineHandle.processMessage( msg1 );

            // Above threshold - should emit
            const msg2 = { id: 'S1', value: 150 };
            await pipelineHandle.processMessage( msg2 );

            // Check state to understand what happened (two-level lookup)
            const partitions = pipelineHandle.composerState.partitionSpecializations;
            const stateStore = partitions.get( 'S1' )[ 0 ]; // Default specialization is 0
            const emitState = stateStore[ 0 ];
            // emitIf should have emitter wired
            expect( emitState.emitter ).to.not.equal( undefined );
            expect( emitState.emitter.getHealth().connected ).to.equal( true );
            expect( emitState.passCount ).to.equal( 2 ); // Two messages processed
            expect( emitState.emissionCount ).to.equal( 1 ); // One emission (value > 100)
        } );

    } );

    // ========================================================================
    // DIFF NODE (dual input x, y)
    // ========================================================================

    describe( 'dual input nodes', function () {

        it( 'processes diff node with x and y inputs', async function () {
            pipelineHandle = await flow( 'diffNode' )
                .assetId( 'id' )
                .diff( 'pressureDiff', 'inlet', 'outlet',
                    { diff: 'deltaP' } )
                .run();

            const msg = { id: 'S1', inlet: 100, outlet: 80 };
            await pipelineHandle.processMessage( msg );

            expect( msg ).to.have.property( 'deltaP' );
            expect( msg.deltaP ).to.equal( 20 ); // 100 - 80
        } );

    } );

    // ========================================================================
    // VECTOR DISTANCE NODE (array inputs)
    // ========================================================================

    describe( 'vector operations', function () {

        it( 'processes vectorDistance with array inputs', async function () {
            pipelineHandle = await flow( 'vectorDist' )
                .assetId( 'id' )
                .vectorDistance( 'similarity', 'embedding1', 'embedding2',
                    { cosine: 'cosDist' } )
                .run();

            const msg = {
                id: 'S1',
                embedding1: [ 1, 0, 0 ],
                embedding2: [ 0, 1, 0 ]
            };
            await pipelineHandle.processMessage( msg );

            expect( msg ).to.have.property( 'cosDist' );
            // Orthogonal vectors have cosine distance of 1
            expect( msg.cosDist ).to.be.closeTo( 1, 0.001 );
        } );

    } );

} );

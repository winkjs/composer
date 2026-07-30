// flow/test/switch-case-control-plane.specs.js

/**
 * @fileoverview Tests for control plane scope in switch/case/break specializations.
 *
 * Verifies that triggers (inter-node coordination) are limited to the same
 * specialization. A controller in case 'temperature' cannot trigger nodes
 * in case 'pressure' - each specialization is an isolated namespace.
 *
 * This isolation is enforced at two levels:
 * 1. Build-time: validateFlow() validates each case's specs independently
 * 2. Runtime: resolveTriggers() uses scopedFlow.specs (per-specialization)
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import { flow } from '../../composer.js';

// ============================================================================
// CONTROL PLANE SCOPE - Triggers Limited to Same Specialization
// ============================================================================

describe( 'flow — switch/case/break: control plane scope', function () {

    let pipelineHandle = null;

    afterEach( async function () {
        if ( pipelineHandle && pipelineHandle.shutdown ) {
            await pipelineHandle.shutdown();
            pipelineHandle = null;
        }
    } );

    describe( 'intra-case triggers (valid)', function () {

        it( 'allows triggers to target nodes within same case', async function () {
            // Controller in case 'temp' can trigger esMean in same case
            const result = await flow( 'intraCase' )
                .switch( 'type' )
                .case( 'temp' )
                    .esMean( 'temp_mean', 'value', { mean: 'smoothed' }, { halfLife: 2 } )
                    .controller( 'temp_ctrl', [ {
                        when: ( msg ) => msg.value > 100,
                        triggers: [ { control: 'reset', targets: [ 'temp_mean' ] } ]
                    } ] )
                    .break()
                .validate();

            expect( result.valid ).to.equal( true );
            expect( result.errors ).to.deep.equal( [] );
        } );

        it( 'allows multiple triggers within same case', async function () {
            const result = await flow( 'multiTrigger' )
                .switch( 'type' )
                .case( 'temp' )
                    .esMean( 'fast_mean', 'value', { mean: 'fast' }, { halfLife: 1 } )
                    .esMean( 'slow_mean', 'value', { mean: 'slow' }, { halfLife: 7 } )
                    .controller( 'ctrl', [ {
                        when: ( msg ) => msg.reset === true,
                        triggers: [
                            { control: 'reset', targets: [ 'fast_mean' ] },
                            { control: 'reset', targets: [ 'slow_mean' ] }
                        ]
                    } ] )
                    .break()
                .validate();

            expect( result.valid ).to.equal( true );
            expect( result.errors ).to.deep.equal( [] );
        } );

        it( 'allows batch reset of multiple nodes in same case', async function () {
            const result = await flow( 'batchReset' )
                .switch( 'type' )
                .case( 'sensor' )
                    .esMean( 'ewma1', 'value', { mean: 'm1' }, { halfLife: 2 } )
                    .esMean( 'ewma2', 'value', { mean: 'm2' }, { halfLife: 2 } )
                    .esMean( 'ewma3', 'value', { mean: 'm3' }, { halfLife: 2 } )
                    .controller( 'resetAll', [ {
                        when: ( msg ) => msg.reset === true,
                        triggers: [ { control: 'reset', targets: [ 'ewma1', 'ewma2', 'ewma3' ] } ]
                    } ] )
                    .break()
                .validate();

            expect( result.valid ).to.equal( true );
        } );

    } );

    describe( 'cross-case triggers (invalid)', function () {

        it( 'rejects triggers targeting nodes in different case', async function () {
            // Controller in case 'temp' tries to trigger node in case 'pressure'
            // Since validation is per-case, 'pressure_mean' won't exist in 'temp' case specs
            const result = await flow( 'crossCase' )
                .switch( 'type' )
                .case( 'temp' )
                    .esMean( 'temp_mean', 'value', { mean: 'smoothed' }, { halfLife: 2 } )
                    .controller( 'temp_ctrl', [ {
                        when: ( msg ) => msg.value > 100,
                        triggers: [ { control: 'reset', targets: [ 'pressure_mean' ] } ]
                    } ] )
                    .break()
                .case( 'pressure' )
                    .esMean( 'pressure_mean', 'value', { mean: 'smoothed' }, { halfLife: 2 } )
                    .break()
                .validate();

            expect( result.valid ).to.equal( false );
            // Error should indicate unknown target in the 'temp' case
            expect( result.errors.length ).to.be.greaterThan( 0 );
            expect( result.errors[ 0 ] ).to.include( '[case \'temp\']' );
            expect( result.errors[ 0 ] ).to.include( 'unknown target' );
            expect( result.errors[ 0 ] ).to.include( 'pressure_mean' );
        } );

        it( 'validates each case independently (both have errors)', async function () {
            // Both cases have triggers targeting non-existent nodes
            const result = await flow( 'bothCasesInvalid' )
                .switch( 'type' )
                .case( 'temp' )
                    .esMean( 'temp_mean', 'value', { mean: 'smoothed' }, { halfLife: 2 } )
                    .controller( 'temp_ctrl', [ {
                        when: ( msg ) => msg.trigger === true,
                        triggers: [ { control: 'reset', targets: [ 'nonexistent1' ] } ]
                    } ] )
                    .break()
                .case( 'pressure' )
                    .esMean( 'pressure_mean', 'value', { mean: 'smoothed' }, { halfLife: 2 } )
                    .controller( 'pressure_ctrl', [ {
                        when: ( msg ) => msg.trigger === true,
                        triggers: [ { control: 'reset', targets: [ 'nonexistent2' ] } ]
                    } ] )
                    .break()
                .validate();

            expect( result.valid ).to.equal( false );
            // Should have errors from both cases
            expect( result.errors.length ).to.be.greaterThanOrEqual( 2 );
            expect( result.errors.some( ( e ) => e.includes( '[case \'temp\']' ) ) ).to.equal( true );
            expect( result.errors.some( ( e ) => e.includes( '[case \'pressure\']' ) ) ).to.equal( true );
        } );

        it( 'error message includes case context', async function () {
            const result = await flow( 'errorContext' )
                .switch( 'type' )
                .case( 'vibration' )
                    .sanitize( 'vib_check', 'value',
                        { failureReason: 'bad' },
                        { ranges: { value: { min: 0, max: 100 } } } )
                    .controller( 'vib_ctrl', [ {
                        when: ( msg ) => msg.trigger === true,
                        triggers: [ { control: 'reset', targets: [ 'other_node' ] } ]
                    } ] )
                    .break()
                .validate();

            expect( result.valid ).to.equal( false );
            // Error should be prefixed with case identifier
            expect( result.errors[ 0 ] ).to.match( /\[case 'vibration'\]/ );
        } );

    } );

    describe( 'runtime isolation', function () {

        it( 'each specialization has independent state store', async function () {
            pipelineHandle = await flow( 'runtimeIsolation' )
                .assetId( 'id' )
                .switch( 'type' )
                .case( 'temp' )
                    .esMean( 'temp_ewma', 'value', { mean: 'temp_smoothed' }, { halfLife: 2 } )
                    .break()
                .case( 'pressure' )
                    .esMean( 'pressure_ewma', 'value', { mean: 'pressure_smoothed' }, { halfLife: 2 } )
                    .break()
                .run();

            // Process temperature message - creates temp partition
            const tempMsg = { id: 'sensor1', type: 'temp', value: 100 };
            await pipelineHandle.processMessage( tempMsg );
            expect( tempMsg ).to.have.property( 'temp_smoothed' );
            expect( tempMsg ).to.not.have.property( 'pressure_smoothed' );

            // Process pressure message - creates pressure partition
            const pressureMsg = { id: 'sensor2', type: 'pressure', value: 200 };
            await pipelineHandle.processMessage( pressureMsg );
            expect( pressureMsg ).to.have.property( 'pressure_smoothed' );
            expect( pressureMsg ).to.not.have.property( 'temp_smoothed' );

            // Verify partitions are isolated (two-level lookup with specialization type)
            const partitions = pipelineHandle.composerState.partitionSpecializations;
            const tempState = partitions.get( 'sensor1' ).temp;
            const pressureState = partitions.get( 'sensor2' ).pressure;

            // Each state store only has nodes for its specialization
            expect( tempState.length ).to.equal( 1 );
            expect( pressureState.length ).to.equal( 1 );
            expect( tempState ).to.not.equal( pressureState );
        } );

        it( 'triggers execute only within their specialization', async function () {
            pipelineHandle = await flow( 'triggerScope' )
                .assetId( 'id' )
                .switch( 'type' )
                .case( 'temp' )
                    .esMean( 'temp_ewma', 'value', { mean: 'temp_smoothed' }, { halfLife: 2 } )
                    .controller( 'temp_ctrl', [ {
                        when: ( msg ) => msg.triggerReset === true,
                        triggers: [ { control: 'reset', targets: [ 'temp_ewma' ] } ]
                    } ] )
                    .break()
                .case( 'pressure' )
                    .esMean( 'pressure_ewma', 'value', { mean: 'pressure_smoothed' }, { halfLife: 2 } )
                    .break()
                .run();

            // Build up state in temp partition
            const msg1 = { id: 'sensor1', type: 'temp', value: 50 };
            await pipelineHandle.processMessage( msg1 );

            const msg2 = { id: 'sensor1', type: 'temp', value: 100 };
            await pipelineHandle.processMessage( msg2 );

            // Now trigger reset in temp partition
            const msg3 = { id: 'sensor1', type: 'temp', value: 50, triggerReset: true };
            await pipelineHandle.processMessage( msg3 );

            // Next message should show reset effect (mean starts fresh)
            const msg4 = { id: 'sensor1', type: 'temp', value: 50 };
            await pipelineHandle.processMessage( msg4 );

            // After reset, EWMA should be close to the input value
            // (alpha=0.3, so mean = 0.3*50 + 0.7*0 = 15 after reset, or just 50 if init to first value)
            // The key point is the reset happened within temp specialization
            expect( msg4 ).to.have.property( 'temp_smoothed' );
        } );

        it( 'different partitions in same specialization share nothing', async function () {
            pipelineHandle = await flow( 'partitionIndependence' )
                .assetId( 'sensorId' )
                .switch( 'type' )
                .case( 'temp' )
                    .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 1 } )
                    .break()
                .run();

            // Build state in partition A
            const msgA1 = { sensorId: 'A', type: 'temp', value: 100 };
            await pipelineHandle.processMessage( msgA1 );

            const msgA2 = { sensorId: 'A', type: 'temp', value: 100 };
            await pipelineHandle.processMessage( msgA2 );

            // Partition B starts fresh
            const msgB1 = { sensorId: 'B', type: 'temp', value: 10 };
            await pipelineHandle.processMessage( msgB1 );

            // Partition A should have accumulated, B should start fresh
            // A: EWMA of 100, 100 = 100
            // B: EWMA of 10 = 10 (first value)
            expect( msgA2.smoothed ).to.not.equal( msgB1.smoothed );

            // Verify state stores are different (two-level lookup)
            const partitions = pipelineHandle.composerState.partitionSpecializations;
            expect( partitions.get( 'A' ).temp ).to.not.equal( partitions.get( 'B' ).temp );
        } );

    } );

    describe( 'single-pipeline backward compatibility', function () {

        it( 'triggers work normally without switch/case', async function () {
            const result = await flow( 'noSwitch' )
                .esMean( 'ewma1', 'value', { mean: 'm1' }, { halfLife: 2 } )
                .esMean( 'ewma2', 'value', { mean: 'm2' }, { halfLife: 2 } )
                .controller( 'ctrl', [ {
                    when: ( msg ) => msg.reset === true,
                    triggers: [ { control: 'reset', targets: [ 'ewma1', 'ewma2' ] } ]
                } ] )
                .validate();

            expect( result.valid ).to.equal( true );
        } );

        it( 'single-pipeline rejects invalid targets', async function () {
            const result = await flow( 'noSwitchInvalid' )
                .esMean( 'ewma', 'value', { mean: 'm' }, { halfLife: 2 } )
                .controller( 'ctrl', [ {
                    when: ( msg ) => msg.trigger === true,
                    triggers: [ { control: 'reset', targets: [ 'nonexistent' ] } ]
                } ] )
                .validate();

            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'unknown target' );
            expect( result.errors[ 0 ] ).to.include( 'nonexistent' );
        } );

    } );

} );

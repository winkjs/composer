// flow/test/flow-infrastructure.specs.js

/**
 * @fileoverview Flow integration tests for infrastructure code coverage.
 *
 * These tests exercise code paths in partition-manager and wiring modules
 * that are only reachable through flow DSL integration:
 * - Partition manager yielding (threshold-based async)
 * - Unknown specialization handling
 * - Heterogeneous trigger validation
 * - Trigger target resolution
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import sinon from 'sinon';
import { flow } from '../../composer.js';
import { ENV_VARS } from '../../core/env-vars.js';

describe( 'flow — infrastructure coverage', function () {

    let pipelineHandle = null;

    afterEach( async function () {
        if ( pipelineHandle && pipelineHandle.shutdown ) {
            await pipelineHandle.shutdown();
            pipelineHandle = null;
        }
    } );

    // ========================================================================
    // PARTITION MANAGER YIELDING
    // ========================================================================

    describe( 'partition manager yielding', function () {

        it( 'yields when processing exceeds threshold', async function () {
            this.timeout( 5000 ); // eslint-disable-line no-invalid-this

            // Create flow with very low yield threshold to trigger yielding
            pipelineHandle = await flow( 'yieldTest' )
                .assetId( 'id' )
                .yield( { threshold: 1 } )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                .run();

            // Deterministic: rewind lastYield so the first pmUpdate call is
            // guaranteed to trigger the yield. 5 tight calls complete in
            // microseconds on modern hardware — insufficient to organically
            // cross a 1 ms threshold, which would make the test timing-flaky.
            const partitionState = pipelineHandle.composerState.partitionState;
            partitionState.lastYield = Date.now() - 100;

            // Process messages — the first call yields; subsequent calls run
            // synchronously until lastYield is stale again.
            const results = [];
            for ( let i = 0; i < 5; i += 1 ) {
                const result = pipelineHandle.processMessage( { id: `S${i}`, value: 100 } );
                results.push( result );
            }

            // At least one result should be a Promise (from the forced yield)
            const hasPromises = results.some( ( r ) => r instanceof Promise );
            expect( hasPromises ).to.equal( true );

            // Wait for all to complete (filter undefined out; Promise.all is
            // tolerant of non-Promise values, but being explicit is clearer)
            await Promise.all( results.filter( ( r ) => r instanceof Promise ) );

            // Verify all partitions were created
            const partitions = pipelineHandle.composerState.partitionSpecializations;
            expect( partitions.size ).to.equal( 5 );
        } );

        it( 'reuses existing partition stateStore', async function () {
            // Create flow with high yield threshold (default)
            pipelineHandle = await flow( 'noYieldTest' )
                .assetId( 'id' )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                .run();

            // Process first message to create partition
            const msg1 = { id: 'S1', value: 100 };
            await pipelineHandle.processMessage( msg1 );

            // Get stateStore from partitionSpecializations (two-level lookup)
            const partitions = pipelineHandle.composerState.partitionSpecializations;
            const stateStore1 = partitions.get( 'S1' )[ 0 ]; // Default specialization is 0
            expect( Array.isArray( stateStore1 ) ).to.equal( true );

            // Second message to same partition should reuse stateStore
            const msg2 = { id: 'S1', value: 110 };
            await pipelineHandle.processMessage( msg2 );

            const stateStore2 = partitions.get( 'S1' )[ 0 ];
            expect( stateStore2 ).to.equal( stateStore1 ); // Same stateStore instance
        } );

        // ====================================================================
        // SYNC-FIRST HOT PATH (ADR-013)
        // ====================================================================
        // processMessage is a regular (non-async) function. On the hot path
        // (yieldThreshold not exceeded) it returns `undefined` and runs the
        // pipeline synchronously. On the rare yield path it returns a
        // Promise. Existing callers that `await` work with both returns:
        // `await undefined` resolves immediately; `await Promise` behaves
        // normally.

        it( 'returns undefined on sync path (yieldThreshold: Infinity)', async function () {
            // Infinity threshold disables the yield mechanism entirely —
            // pmUpdate always returns the stateStore synchronously.
            pipelineHandle = await flow( 'syncPath' )
                .assetId( 'id' )
                .yield( { threshold: Infinity } )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                .run();

            const msg = { id: 'S1', value: 100 };
            const result = pipelineHandle.processMessage( msg );

            // Hot path returns undefined (not a Promise).
            expect( result ).to.equal( undefined );

            // Pipeline ran synchronously — msg was enriched before return.
            expect( msg ).to.have.property( 'smoothed' );
            expect( msg.smoothed ).to.equal( 100 );
        } );

        it( 'returns a Promise on yield path (forces yield)', async function () {
            this.timeout( 5000 ); // eslint-disable-line no-invalid-this

            pipelineHandle = await flow( 'yieldPath' )
                .assetId( 'id' )
                .yield( { threshold: 1 } )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                .run();

            // Deterministic: rewind lastYield so the next processMessage call
            // will cross the threshold and return a Promise.
            pipelineHandle.composerState.partitionState.lastYield = Date.now() - 100;

            const msg = { id: 'S1', value: 100 };
            const result = pipelineHandle.processMessage( msg );

            // Yield path returns a Promise (caller may await for breathing).
            expect( result ).to.be.instanceOf( Promise );

            // The message is processed before the breath (ADR-024), so the
            // enrichment is visible after the Promise resolves — and, since
            // the pipeline ran synchronously, already before it.
            await result;
            expect( msg ).to.have.property( 'smoothed' );
            expect( msg.smoothed ).to.equal( 100 );
        } );

        it( 'processes the yield-tick message before later messages (order preserved)', async function () {
            this.timeout( 5000 ); // eslint-disable-line no-invalid-this

            pipelineHandle = await flow( 'yieldOrder' )
                .assetId( 'id' )
                .yield( { threshold: 1 } )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                .run();

            // Deterministic: rewind lastYield so the FIRST message crosses the
            // threshold and triggers the yield tick.
            pipelineHandle.composerState.partitionState.lastYield = Date.now() - 100;

            const first = { id: 'S1', value: 100 };
            const second = { id: 'S1', value: 200 };

            // Feed both without awaiting — the shape of a fire-and-forget
            // caller (the MQTT source). Regression guard for the pre-ADR-024
            // defect where the yield tick deferred `first`'s pipeline to a
            // later event-loop turn, so `second` updated the partition first.
            const pending = pipelineHandle.processMessage( first );
            pipelineHandle.processMessage( second );

            // The first-fed message must have been processed first: an esMean
            // seeds its mean with the first sample it sees, so `first` reads
            // exactly 100 only when no other update ran before it. `second`
            // then reads a blend, never a fresh seed of 200.
            expect( first ).to.have.property( 'smoothed' );
            expect( first.smoothed ).to.equal( 100 );
            expect( second ).to.have.property( 'smoothed' );
            expect( second.smoothed ).to.not.equal( 200 );

            // The yield tick still hands back a Promise for callers that
            // want to breathe.
            expect( pending ).to.be.instanceOf( Promise );
            await pending;
        } );

    } );

    // ========================================================================
    // YIELD THRESHOLD DEFAULT (ENV-VAR, ADR-024)
    // ========================================================================

    describe( 'yield threshold default from env-vars', function () {

        it( 'defaults flow.yieldThreshold to YIELD_TIME_THRESHOLD_MS (500) when .yield() is not called', async function () {
            pipelineHandle = await flow( 'envDefault' )
                .assetId( 'id' )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                .run();

            expect( ENV_VARS.yieldTimeThresholdMs ).to.equal( 500 );
            expect( pipelineHandle.composerState.flow.yieldThreshold ).to.equal( 500 );
        } );

        it( 'a changed env default reaches the flow config', async function () {
            const stub = sinon.stub( ENV_VARS, 'yieldTimeThresholdMs' ).value( 120 );
            try {
                pipelineHandle = await flow( 'envOverride' )
                    .assetId( 'id' )
                    .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                    .run();

                expect( pipelineHandle.composerState.flow.yieldThreshold ).to.equal( 120 );
            } finally {
                stub.restore();
            }
        } );

        it( '.yield() still overrides the env default per flow', async function () {
            pipelineHandle = await flow( 'dslOverride' )
                .assetId( 'id' )
                .yield( { threshold: 42 } )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                .run();

            expect( pipelineHandle.composerState.flow.yieldThreshold ).to.equal( 42 );
        } );

    } );

    // ========================================================================
    // UNKNOWN SPECIALIZATION HANDLING
    // ========================================================================

    describe( 'unknown specialization handling', function () {

        it( 'drops messages for unknown specialization type', async function () {
            // Capture console.error output
            const originalError = console.error;
            const errors = [];
            console.error = function ( msg ) {
                errors.push( msg );
            };

            try {
                pipelineHandle = await flow( 'unknownSpec' )
                    .assetId( 'id' )
                    .switch( 'type' )
                    .case( 'known' )
                        .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                        .break()
                    .run();

                // Send message with unknown type
                const msg = { id: 'S1', type: 'unknown', value: 100 };
                await pipelineHandle.processMessage( msg );

                // Message should NOT have smoothed property (wasn't processed)
                expect( msg ).to.not.have.property( 'smoothed' );

                // Partition should NOT be created for unknown type
                const partitions = pipelineHandle.composerState.partitionSpecializations;
                expect( partitions.has( 'S1' ) ).to.equal( false );

                // Should have logged error
                expect( errors.length ).to.be.greaterThan( 0 );
                expect( errors[ 0 ] ).to.include( 'Unknown specialization' );
                expect( errors[ 0 ] ).to.include( 'unknown' );

            } finally {
                console.error = originalError;
            }
        } );

        it( 'processes known specialization normally', async function () {
            pipelineHandle = await flow( 'knownSpec' )
                .assetId( 'id' )
                .switch( 'type' )
                .case( 'temp' )
                    .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                    .break()
                .run();

            // Send message with known type
            const msg = { id: 'S1', type: 'temp', value: 100 };
            const result = pipelineHandle.processMessage( msg );

            // Result should be the stateStore (not null)
            const stateStore = result instanceof Promise ? await result : result;
            expect( stateStore ).to.not.equal( null );
            expect( msg ).to.have.property( 'smoothed' );
        } );

    } );

    // ========================================================================
    // HETEROGENEOUS TRIGGER VALIDATION
    // ========================================================================

    describe( 'heterogeneous trigger validation', function () {

        it( 'rejects triggers targeting different node types at runtime', async function () {
            // Heterogeneous triggers pass DSL validation but fail at runtime
            // when partition is created and triggers are resolved
            pipelineHandle = await flow( 'heteroTrigger' )
                .assetId( 'id' )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                .threshold( 'thresh', 'value', { active: 'isHigh' },
                    { threshold: 100, mode: 'above', hysteresis: 5 } )
                .controller( 'ctrl', [ {
                    when: ( msg ) => msg.reset === true,
                    // Invalid: targeting both esMean and threshold (different types)
                    triggers: [ { control: 'reset', targets: [ 'ewma', 'thresh' ] } ]
                } ] )
                .run();

            // Should throw when partition is created (first message)
            let error = null;
            try {
                await pipelineHandle.processMessage( { id: 'S1', value: 100 } );
            } catch ( e ) {
                error = e;
            }

            expect( error ).to.not.equal( null );
            expect( error.message ).to.include( 'incompatible' );
        } );

        it( 'accepts triggers targeting same node type', async function () {
            const result = await flow( 'homoTrigger' )
                .assetId( 'id' )
                .esMean( 'fast', 'value', { mean: 'fastSmooth' }, { halfLife: 5 } )
                .esMean( 'slow', 'value', { mean: 'slowSmooth' }, { halfLife: 20 } )
                .controller( 'ctrl', [ {
                    when: ( msg ) => msg.reset === true,
                    // Valid: both targets are esMean nodes
                    triggers: [ { control: 'reset', targets: [ 'fast', 'slow' ] } ]
                } ] )
                .validate();

            expect( result.valid ).to.equal( true );
        } );

    } );

    // ========================================================================
    // TRIGGER TARGET VALIDATION
    // ========================================================================

    describe( 'trigger target validation', function () {

        it( 'rejects triggers with non-existent target', async function () {
            const result = await flow( 'badTarget' )
                .assetId( 'id' )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                .controller( 'ctrl', [ {
                    when: ( msg ) => msg.reset === true,
                    triggers: [ { control: 'reset', targets: [ 'nonexistent' ] } ]
                } ] )
                .validate();

            expect( result.valid ).to.equal( false );
            expect( result.errors.some( ( e ) => e.includes( 'nonexistent' ) ) ).to.equal( true );
        } );

        it( 'rejects triggers with empty target name at DSL level', function () {
            // Empty target name is caught at controller DSL validation
            let error = null;
            try {
                flow( 'emptyTarget' )
                    .assetId( 'id' )
                    .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                    .controller( 'ctrl', [ {
                        when: ( msg ) => msg.reset === true,
                        triggers: [ { control: 'reset', targets: [ '' ] } ]
                    } ] );
            } catch ( e ) {
                error = e;
            }

            expect( error ).to.not.equal( null );
            expect( error.message ).to.include( 'Invalid trigger' );
        } );

        it( 'rejects triggers with invalid control method', async function () {
            const result = await flow( 'badControl' )
                .assetId( 'id' )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                .controller( 'ctrl', [ {
                    when: ( msg ) => msg.reset === true,
                    triggers: [ { control: 'invalidMethod', targets: [ 'ewma' ] } ]
                } ] )
                .validate();

            expect( result.valid ).to.equal( false );
            expect( result.errors.some( ( e ) => e.includes( 'invalidMethod' ) ) ).to.equal( true );
        } );

    } );

    // ========================================================================
    // MULTI-PARTITION CONCURRENT ACCESS
    // ========================================================================

    describe( 'multi-partition concurrent processing', function () {

        it( 'handles rapid partition creation', async function () {
            pipelineHandle = await flow( 'rapidPartitions' )
                .assetId( 'id' )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                .run();

            // Create 100 partitions rapidly
            const messages = [];
            for ( let i = 0; i < 100; i += 1 ) {
                messages.push( { id: `sensor_${i}`, value: Math.random() * 100 } );
            }

            // Process all messages
            const results = messages.map( ( msg ) => pipelineHandle.processMessage( msg ) );
            await Promise.all( results.filter( ( r ) => r instanceof Promise ) );

            // Verify all partitions created
            const partitions = pipelineHandle.composerState.partitionSpecializations;
            expect( partitions.size ).to.equal( 100 );
        } );

        it( 'maintains partition isolation', async function () {
            pipelineHandle = await flow( 'isolation' )
                .assetId( 'id' )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                .run();

            // Process different values for different partitions
            const msg1 = { id: 'A', value: 100 };
            const msg2 = { id: 'B', value: 200 };

            await pipelineHandle.processMessage( msg1 );
            await pipelineHandle.processMessage( msg2 );

            // Verify isolation - each should have its own smoothed value
            expect( msg1.smoothed ).to.not.equal( msg2.smoothed );

            // A should be close to 100, B close to 200
            expect( msg1.smoothed ).to.be.closeTo( 100, 10 );
            expect( msg2.smoothed ).to.be.closeTo( 200, 10 );
        } );

    } );

    // ========================================================================
    // NODE STATE ERROR TRACKING
    // ========================================================================

    describe( 'node state initialization', function () {

        it( 'initializes error tracking stats in state', async function () {
            pipelineHandle = await flow( 'errorStats' )
                .assetId( 'id' )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                .run();

            // Process a message to create partition and initialize state
            await pipelineHandle.processMessage( { id: 'S1', value: 100 } );

            // Check state has error tracking (two-level lookup)
            const partitions = pipelineHandle.composerState.partitionSpecializations;
            const stateStore = partitions.get( 'S1' )[ 0 ]; // Default specialization is 0
            const nodeState = stateStore[ 0 ];

            expect( nodeState ).to.have.property( 'errorStats' );
            expect( nodeState.errorStats ).to.have.property( 'totalErrors', 0 );
            expect( nodeState.errorStats ).to.have.property( 'recentErrors' );
            expect( Array.isArray( nodeState.errorStats.recentErrors ) ).to.equal( true );
        } );

    } );

    // ========================================================================
    // RESOLVED TRIGGERS IN STATE
    // ========================================================================

    describe( 'resolved triggers in state', function () {

        it( 'stores resolved triggers in node state', async function () {
            pipelineHandle = await flow( 'resolvedTriggers' )
                .assetId( 'id' )
                .esMean( 'ewma', 'value', { mean: 'smoothed' }, { halfLife: 10 } )
                .controller( 'ctrl', [ {
                    when: ( msg ) => msg.reset === true,
                    triggers: [ { control: 'reset', targets: [ 'ewma' ] } ]
                } ] )
                .run();

            // Process a message to create partition
            await pipelineHandle.processMessage( { id: 'S1', value: 100 } );

            // Check controller state has resolved triggers (two-level lookup)
            const partitions = pipelineHandle.composerState.partitionSpecializations;
            const stateStore = partitions.get( 'S1' )[ 0 ]; // Default specialization is 0

            // Find controller state (second node)
            const ctrlState = stateStore[ 1 ];
            expect( ctrlState.logic[ 0 ] ).to.have.property( 'resolvedTriggers' );
            expect( ctrlState.logic[ 0 ].resolvedTriggers ).to.have.length( 1 );

            // Resolved trigger should have control function and target states
            const resolved = ctrlState.logic[ 0 ].resolvedTriggers[ 0 ];
            expect( typeof resolved.control ).to.equal( 'function' );
            expect( Array.isArray( resolved.targets ) ).to.equal( true );
            expect( resolved.targets[ 0 ] ).to.equal( stateStore[ 0 ] ); // Points to ewma state
        } );

        it( 'resolves multi-target triggers to correct states', async function () {
            pipelineHandle = await flow( 'multiTargetResolved' )
                .assetId( 'id' )
                .esMean( 'fast', 'value', { mean: 'fastSmooth' }, { halfLife: 5 } )
                .esMean( 'slow', 'value', { mean: 'slowSmooth' }, { halfLife: 20 } )
                .controller( 'ctrl', [ {
                    when: ( msg ) => msg.reset === true,
                    triggers: [ { control: 'reset', targets: [ 'fast', 'slow' ] } ]
                } ] )
                .run();

            // Process a message
            await pipelineHandle.processMessage( { id: 'S1', value: 100 } );

            const partitions = pipelineHandle.composerState.partitionSpecializations;
            const stateStore = partitions.get( 'S1' )[ 0 ]; // Default specialization is 0
            const ctrlState = stateStore[ 2 ]; // Controller is third

            const resolved = ctrlState.logic[ 0 ].resolvedTriggers[ 0 ];
            expect( resolved.targets ).to.have.length( 2 );
            expect( resolved.targets[ 0 ] ).to.equal( stateStore[ 0 ] ); // fast
            expect( resolved.targets[ 1 ] ).to.equal( stateStore[ 1 ] ); // slow
        } );

    } );

    // ========================================================================
    // NODE METHOD ARGUMENT VALIDATION
    // ========================================================================

    describe( 'node method argument validation', function () {

        it( 'reports error context with single argument (name only)', function () {
            // When calling a node with only 1 argument (name only),
            // the callContext should show the name without extra args
            let error = null;
            try {
                flow( 'singleArg' )
                    .esMean( 'nameOnly' );  // Missing input, outputs, options
            } catch ( e ) {
                error = e;
            }

            expect( error ).to.not.equal( null );
            // Error context should include the node call with single arg
            expect( error.message ).to.include( '.esMean( nameOnly )' );
            expect( error.message ).to.include( 'Failed to process' );
        } );

        it( 'reports error context with multiple arguments', function () {
            // When calling with invalid args, context shows arg count
            let error = null;
            try {
                flow( 'multiArg' )
                    .esMean( 'test', 'input', 'invalid' );  // Invalid output type
            } catch ( e ) {
                error = e;
            }

            expect( error ).to.not.equal( null );
            // Error context should show the arg count
            expect( error.message ).to.include( '.esMean( test, +2 )' );
        } );

    } );

} );

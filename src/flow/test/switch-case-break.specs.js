/* eslint-disable camelcase, no-empty-function, no-sync, no-invalid-this */
// flow/test/switch-case-break.specs.js

/**
 * @fileoverview Tests for switch/case/break DSL syntax for flow specialization.
 *
 * This tests the multi-specialization feature that enables different processing
 * pipelines based on message content, using familiar JS switch/case/break syntax.
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import { flow, csv } from '../../composer.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ============================================================================
// TEST DATA
// ============================================================================
const GAUGE_RANGES = {
    pump_in_p: { min: 0, max: 10 },
    pump_out_p: { min: 0, max: 120 },
    temp: { min: 0, max: 100 },
    pressure: { min: 0, max: 200 },
    x: { min: 0, max: 100 },
    y: { min: 0, max: 100 }
};

// Mock source adapter
const mockSourceAdapter = {
    id: 'mockSource',
    start: function ( _config ) {
        return function () { /* stop */ };
    }
};

// Mock emitter adapter
const mockEmitterAdapter = {
    id: 'mockEmitter',
    createEmitter: function ( _config ) {
        return { publish: function () {}, shutdown: async function () {} };
    }
};

// ============================================================================
// .switch() METHOD
// ============================================================================
describe( 'flow — switch/case/break: .switch()', function () {

    it( 'accepts selector function and returns api for chaining', function () {
        const api = flow( 'switchTest' )
            .switch( 'type' );

        expect( api ).to.have.property( 'case' );
        expect( api ).to.have.property( 'build' );
    } );

    it( 'throws if field is not a string', function () {
        expect( () => flow( 'test' ).switch( ( msg ) => msg.type ) )
            .to.throw( '.switch() requires a non-empty string field name' );
    } );

    it( 'throws if field is not a valid identifier (hyphen)', function () {
        expect( () => flow( 'test' ).switch( 'sensor-type' ) )
            .to.throw( /valid identifier/ );
    } );

    it( 'throws if field is not a valid identifier (space)', function () {
        expect( () => flow( 'test' ).switch( 'sensor type' ) )
            .to.throw( /valid identifier/ );
    } );

    it( 'throws if field is not a valid identifier (leading digit)', function () {
        expect( () => flow( 'test' ).switch( '1sensor' ) )
            .to.throw( /valid identifier/ );
    } );

    it( 'throws if called twice', function () {
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .switch( 'other' )
        ).to.throw( '.switch() can only be called once per flow' );
    } );

    it( 'throws if called after nodes', function () {
        expect( () =>
            flow( 'test' )
                .sanitize( 'sanitize', [ 'pump_in_p' ],
                    { failureReason: 'bad_val_reason' },
                    { ranges: GAUGE_RANGES } )
                .switch( 'type' )
        ).to.throw( '.switch() cannot be called after nodes' );
    } );

} );

// ============================================================================
// .case() METHOD
// ============================================================================
describe( 'flow — switch/case/break: .case()', function () {

    it( 'creates a case block and returns api for chaining', function () {
        const api = flow( 'caseTest' )
            .switch( 'type' )
            .case( 'temperature' );

        expect( api ).to.have.property( 'sanitize' );
        expect( api ).to.have.property( 'break' );
    } );

    it( 'accepts string keys', function () {
        const api = flow( 'test' )
            .switch( 'type' )
            .case( 'temperature' )
            .sanitize( 'sanitize', [ 'pump_in_p' ],
                { failureReason: 'bad_val_reason' },
                { ranges: GAUGE_RANGES } )
            .break();

        expect( api ).to.have.property( 'case' );
    } );

    it( 'accepts numeric keys', function () {
        const api = flow( 'test' )
            .switch( 'sensorId' )
            .case( 1 )
            .sanitize( 'sanitize', [ 'pump_in_p' ],
                { failureReason: 'bad_val_reason' },
                { ranges: GAUGE_RANGES } )
            .break();

        expect( api ).to.have.property( 'case' );
    } );

    it( 'throws if called without active switch', function () {
        expect( () => flow( 'test' ).case( 'temp' ) )
            .to.throw( '.case() requires an active .switch()' );
    } );

    it( 'throws on duplicate case key', function () {
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .case( 'temp' )
                .sanitize( 'sanitize', [ 'pump_in_p' ],
                    { failureReason: 'bad_val_reason' },
                    { ranges: GAUGE_RANGES } )
                .break()
                .case( 'temp' )
        ).to.throw( 'duplicate case key \'temp\'' );
    } );

    it( 'throws if previous case not ended with break', function () {
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .case( 'temp' )
                .sanitize( 'sanitize', [ 'pump_in_p' ],
                    { failureReason: 'bad_val_reason' },
                    { ranges: GAUGE_RANGES } )
                .case( 'vibration' )
        ).to.throw( 'must end with .break()' );
    } );

} );

// ============================================================================
// .break() METHOD
// ============================================================================
describe( 'flow — switch/case/break: .break()', function () {

    it( 'ends case block and returns api for chaining', function () {
        const api = flow( 'breakTest' )
            .switch( 'type' )
            .case( 'temp' )
            .sanitize( 'sanitize', [ 'pump_in_p' ],
                { failureReason: 'bad_val_reason' },
                { ranges: GAUGE_RANGES } )
            .break();

        expect( api ).to.have.property( 'case' );
        expect( api ).to.have.property( 'build' );
        expect( api ).to.have.property( 'run' );
    } );

    it( 'throws if called without active switch', function () {
        expect( () => flow( 'test' ).break() )
            .to.throw( '.break() requires an active .switch()' );
    } );

    it( 'throws if called without active case', function () {
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .break()
        ).to.throw( '.break() must follow a .case()' );
    } );

    it( 'throws if case is empty', function () {
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .case( 'temp' )
                .break()
        ).to.throw( 'case \'temp\' is empty' );
    } );

    it( 'throws if called twice in a row', function () {
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .case( 'temp' )
                .sanitize( 'sanitize', [ 'pump_in_p' ],
                    { failureReason: 'bad_val_reason' },
                    { ranges: GAUGE_RANGES } )
                .break()
                .break()
        ).to.throw( '.break() must follow a .case()' );
    } );

} );

// ============================================================================
// STATE TRANSITIONS
// ============================================================================
describe( 'flow — switch/case/break: state transitions', function () {

    it( 'blocks config methods after .switch()', function () {
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .assetId( 'machineId' )
        ).to.throw( '.assetId() must be called before any nodes or .switch()' );
    } );

    it( 'blocks config methods after any node', function () {
        expect( () =>
            flow( 'test' )
                .sanitize( 'sanitize', [ 'pump_in_p' ],
                    { failureReason: 'bad_val_reason' },
                    { ranges: GAUGE_RANGES } )
                .assetId( 'machineId' )
        ).to.throw( '.assetId() must be called before any nodes or .switch()' );
    } );

    it( 'throws if partition field equals switch field', function () {
        expect( () =>
            flow( 'test' )
                .assetId( 'type' )
                .switch( 'type' )
        ).to.throw( 'partition field and switch field must be different' );
    } );

    it( 'blocks nodes when in SWITCH state (before .case())', function () {
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .sanitize( 'sanitize', [ 'pump_in_p' ],
                    { failureReason: 'bad_val_reason' },
                    { ranges: GAUGE_RANGES } )
        ).to.throw( 'node called outside of a .case() block' );
    } );

    it( 'blocks nodes after .break() (need new .case())', function () {
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .case( 'temp' )
                .sanitize( 'sanitize', [ 'pump_in_p' ],
                    { failureReason: 'bad_val_reason' },
                    { ranges: GAUGE_RANGES } )
                .break()
                .threshold( 'detect', 'pump_out_p',
                    { active: 'is_active' },
                    { mode: 'above', threshold: 78, hysteresis: 3 } )
        ).to.throw( 'node called after .break()' );
    } );

} );

// ============================================================================
// TERMINAL METHODS WITH SWITCH
// ============================================================================
describe( 'flow — switch/case/break: terminal methods', function () {

    it( '.build() generates multi-specialization code', function () {
        const source = flow( 'multiSpec' )
            .switch( 'type' )
            .case( 'temperature' )
                .sanitize( 'sanitize_temp', [ 'temp' ],
                    { failureReason: 'bad_reason' },
                    { ranges: GAUGE_RANGES } )
                .break()
            .case( 'pressure' )
                .sanitize( 'sanitize_pressure', [ 'pressure' ],
                    { failureReason: 'bad_reason' },
                    { ranges: GAUGE_RANGES } )
                .break()
            .build();

        expect( source ).to.include( 'flowBySpecialization' );
        expect( source ).to.include( '\'temperature\'' );
        expect( source ).to.include( '\'pressure\'' );
        expect( source ).to.include( 'sanitize_temp' );
        expect( source ).to.include( 'sanitize_pressure' );
    } );

    it( '.build() throws if switch has no cases', function () {
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .build()
        ).to.throw( '.switch() requires at least one .case()' );
    } );

    it( '.build() throws if final case lacks .break()', function () {
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .case( 'temp' )
                .sanitize( 'sanitize', [ 'pump_in_p' ],
                    { failureReason: 'bad_val_reason' },
                    { ranges: GAUGE_RANGES } )
                .build()
        ).to.throw( 'must end with .break()' );
    } );

    it( '.inspect() returns multi-specialization metadata', function () {
        const info = flow( 'inspectMulti' )
            .assetId( 'machineId' )
            .switch( 'type' )
            .case( 'temperature' )
                .sanitize( 'sanitize_temp', [ 'temp' ],
                    { failureReason: 'bad_reason' },
                    { ranges: GAUGE_RANGES } )
                .break()
            .case( 'pressure' )
                .sanitize( 'sanitize_p1', [ 'p1' ],
                    { failureReason: 'bad_reason' },
                    { ranges: { p1: { min: 0, max: 200 } } } )
                .sanitize( 'sanitize_p2', [ 'p2' ],
                    { failureReason: 'bad_reason' },
                    { ranges: { p2: { min: 0, max: 200 } } } )
                .break()
            .inspect();

        expect( info.mode ).to.equal( 'multi-specialization' );
        expect( info.nodeCount ).to.equal( 3 );
        expect( info.caseOrder ).to.deep.equal( [ 'temperature', 'pressure' ] );
        expect( info.specializations.temperature.nodeCount ).to.equal( 1 );
        expect( info.specializations.pressure.nodeCount ).to.equal( 2 );
        expect( info.runtime.partitionField ).to.equal( 'machineId' );
    } );

    it( '.validate() validates all cases', async function () {
        const result = await flow( 'validateMulti' )
            .switch( 'type' )
            .case( 'temp' )
                .sanitize( 'sanitize_temp', [ 'temp' ],
                    { failureReason: 'bad_reason' },
                    { ranges: GAUGE_RANGES } )
                .break()
            .validate();

        expect( result.valid ).to.equal( true );
        expect( result.errors ).to.deep.equal( [] );
    } );

} );

// ============================================================================
// BACKWARD COMPATIBILITY
// ============================================================================
describe( 'flow — switch/case/break: backward compatibility', function () {

    it( 'single-pipeline mode (no switch) still works', function () {
        const source = flow( 'backwardCompat' )
            .sanitize( 'sanitize', [ 'pump_in_p' ],
                { failureReason: 'bad_val_reason' },
                { ranges: GAUGE_RANGES } )
            .build();

        expect( source ).to.include( 'flowBySpecialization[ 0 ]' );
        expect( source ).to.include( 'sanitize' );
    } );

    it( '.inspect() returns single-pipeline mode', function () {
        const info = flow( 'singlePipeline' )
            .sanitize( 'sanitize', [ 'pump_in_p' ],
                { failureReason: 'bad_val_reason' },
                { ranges: GAUGE_RANGES } )
            .inspect();

        expect( info.mode ).to.equal( 'single-pipeline' );
        expect( info.nodeCount ).to.equal( 1 );
        expect( info.nodes ).to.be.an( 'array' );
        expect( info.specializations ).to.equal( undefined );
    } );

} );

// ============================================================================
// NODE NAME UNIQUENESS
// ============================================================================
describe( 'flow — switch/case/break: node name uniqueness', function () {

    it( 'throws on duplicate node names in different cases (canonical form)', function () {
        // Using canonical form: ( name, x, stats, options )
        // Both cases use the same node name 'myNode'
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .case( 'temp' )
                    .sanitize( 'myNode', 'x',
                        { failureReason: 'bad_reason' },
                        { ranges: GAUGE_RANGES } )
                    .break()
                .case( 'pressure' )
                    .sanitize( 'myNode', 'y',
                        { failureReason: 'bad_reason' },
                        { ranges: GAUGE_RANGES } )
        ).to.throw( 'duplicate node' );
    } );

    it( 'throws on duplicate node names in sugar form (same baseName_param)', function () {
        // Using sugar form: ( baseName, [inputs], stats, options )
        // Both cases use baseName 'sanitize' with input 'x', creating 'sanitize_x'
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .case( 'temp' )
                    .sanitize( 'sanitize', [ 'x' ],
                        { failureReason: 'bad_reason' },
                        { ranges: GAUGE_RANGES } )
                    .break()
                .case( 'pressure' )
                    .sanitize( 'sanitize', [ 'x' ],
                        { failureReason: 'bad_reason' },
                        { ranges: GAUGE_RANGES } )
        ).to.throw( 'duplicate node' );
    } );

    it( 'allows unique node names across cases', function () {
        const info = flow( 'uniqueNames' )
            .switch( 'type' )
            .case( 'temp' )
                .sanitize( 'sanitize_temp', [ 'x' ],
                    { failureReason: 'bad_reason' },
                    { ranges: GAUGE_RANGES } )
                .break()
            .case( 'pressure' )
                .sanitize( 'sanitize_pressure', [ 'y' ],
                    { failureReason: 'bad_reason' },
                    { ranges: GAUGE_RANGES } )
                .break()
            .inspect();

        expect( info.nodeCount ).to.equal( 2 );
    } );

} );

// ============================================================================
// CONFIG METHODS BEFORE SWITCH
// ============================================================================
describe( 'flow — switch/case/break: config ordering', function () {

    it( 'allows all config methods before switch', function () {
        const info = flow( 'configFirst' )
            .source( mockSourceAdapter, { path: './data.csv' } )
            .emitter( mockEmitterAdapter, { brokerUrl: 'mqtt://localhost' } )
            .assetId( 'machineId' )
            .switch( 'type' )
            .case( 'temp' )
                .sanitize( 'sanitize', [ 'x' ],
                    { failureReason: 'bad_reason' },
                    { ranges: GAUGE_RANGES } )
                .break()
            .inspect();

        expect( info.runtime.hasSource ).to.equal( true );
        expect( info.runtime.emitterCount ).to.equal( 1 );
        expect( info.runtime.partitionField ).to.equal( 'machineId' );
    } );

    it( 'blocks .source() after .switch()', function () {
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .source( mockSourceAdapter, { path: './data.csv' } )
        ).to.throw( '.source() must be called before any nodes or .switch()' );
    } );

    it( 'blocks .emitter() after .switch()', function () {
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .emitter( mockEmitterAdapter, {} )
        ).to.throw( '.emitter() must be called before any nodes or .switch()' );
    } );

} );

// ============================================================================
// FUNCTIONAL TESTS - Message Routing Behavior
// ============================================================================

describe( 'flow — switch/case/break: functional routing', function () {

    it( 'routes messages to correct specialization via processMessage', async function () {
        // Use out-of-range values to trigger sanitize failureReason output
        // Temperature range: 0-50, Pressure range: 0-100
        const pipelineHandle = await flow( 'routingFunctional' )
            .assetId( 'id' )
            .switch( 'type' )
            .case( 'temperature' )
                .sanitize( 'temp_sanitize', 'value',
                    { failureReason: 'temp_bad' },
                    { ranges: { value: { min: 0, max: 50 } } } )
                .break()
            .case( 'pressure' )
                .sanitize( 'pressure_sanitize', 'value',
                    { failureReason: 'pressure_bad' },
                    { ranges: { value: { min: 0, max: 100 } } } )
                .break()
            .run();

        // Temperature message with out-of-range value (60 > 50)
        const tempMsg = { id: 'sensor1', type: 'temperature', value: 60 };
        await pipelineHandle.processMessage( tempMsg );

        // Should have been processed by temperature pipeline (sanitize publishes on failure)
        expect( tempMsg ).to.have.property( 'temp_bad' );
        expect( tempMsg.temp_bad ).to.equal( 'range' );

        // Pressure message with out-of-range value (150 > 100)
        const pressureMsg = { id: 'sensor2', type: 'pressure', value: 150 };
        await pipelineHandle.processMessage( pressureMsg );

        // Should have been processed by pressure pipeline
        expect( pressureMsg ).to.have.property( 'pressure_bad' );
        expect( pressureMsg.pressure_bad ).to.equal( 'range' );

        // Verify cross-contamination didn't happen
        expect( tempMsg ).to.not.have.property( 'pressure_bad' );
        expect( pressureMsg ).to.not.have.property( 'temp_bad' );

        await pipelineHandle.shutdown();
    } );

    it( 'handles unknown specialization keys gracefully (message dropped)', async function () {
        const RANGES = { value: { min: 0, max: 50 } };

        const pipelineHandle = await flow( 'unknownKeyTest' )
            .assetId( 'id' )
            .switch( 'type' )
            .case( 'temperature' )
                .sanitize( 'temp_sanitize', 'value',
                    { failureReason: 'temp_bad' },
                    { ranges: RANGES } )
                .break()
            .run();

        // Process a message with unknown type - should not throw
        // Use out-of-range value to verify it's NOT processed
        const unknownMsg = { id: 'sensor1', type: 'humidity', value: 999 };
        await pipelineHandle.processMessage( unknownMsg );

        // Message should NOT have been processed (no pipeline for 'humidity')
        expect( unknownMsg ).to.not.have.property( 'temp_bad' );

        await pipelineHandle.shutdown();
    } );

    it( 'maintains partition isolation across specializations', async function () {
        // Use range that will trigger failure
        const RANGES = { value: { min: 0, max: 50 } };

        const pipelineHandle = await flow( 'partitionIsolation' )
            .assetId( 'sensorId' )
            .switch( 'type' )
            .case( 'temp' )
                .sanitize( 'sanitize', 'value',
                    { failureReason: 'bad' },
                    { ranges: RANGES } )
                .break()
            .run();

        // Process messages for different partitions with out-of-range values
        const msg1 = { sensorId: 'A', type: 'temp', value: 60 };
        const msg2 = { sensorId: 'B', type: 'temp', value: 70 };

        await pipelineHandle.processMessage( msg1 );
        await pipelineHandle.processMessage( msg2 );

        // Both should be processed independently with failures
        expect( msg1 ).to.have.property( 'bad' );
        expect( msg1.bad ).to.equal( 'range' );
        expect( msg2 ).to.have.property( 'bad' );
        expect( msg2.bad ).to.equal( 'range' );

        // Verify partition state is isolated via composerState.partitionSpecializations Map
        const partitions = pipelineHandle.composerState.partitionSpecializations;
        expect( partitions.has( 'A' ) ).to.equal( true );
        expect( partitions.has( 'B' ) ).to.equal( true );

        await pipelineHandle.shutdown();
    } );

    it( 'uses numeric specialization keys correctly', async function () {
        // Trigger failures with out-of-range values
        const RANGES = { value: { min: 0, max: 40 } };

        const pipelineHandle = await flow( 'numericKeys' )
            .assetId( 'id' )
            .switch( 'priority' )
            .case( 1 )
                .sanitize( 'high_priority', 'value',
                    { failureReason: 'high_bad' },
                    { ranges: RANGES } )
                .break()
            .case( 2 )
                .sanitize( 'low_priority', 'value',
                    { failureReason: 'low_bad' },
                    { ranges: RANGES } )
                .break()
            .run();

        // Out-of-range values to trigger failures
        const highPriorityMsg = { id: '1', priority: 1, value: 50 };
        const lowPriorityMsg = { id: '2', priority: 2, value: 60 };

        await pipelineHandle.processMessage( highPriorityMsg );
        await pipelineHandle.processMessage( lowPriorityMsg );

        // Each should only have its own failure reason
        expect( highPriorityMsg ).to.have.property( 'high_bad' );
        expect( highPriorityMsg ).to.not.have.property( 'low_bad' );

        expect( lowPriorityMsg ).to.have.property( 'low_bad' );
        expect( lowPriorityMsg ).to.not.have.property( 'high_bad' );

        await pipelineHandle.shutdown();
    } );

    it( 'processes multiple messages through same specialization', async function () {
        // Range that triggers failure
        const RANGES = { value: { min: 0, max: 20 } };

        const pipelineHandle = await flow( 'multipleMessages' )
            .assetId( 'id' )
            .switch( 'type' )
            .case( 'temp' )
                .sanitize( 'sanitize', 'value',
                    { failureReason: 'bad' },
                    { ranges: RANGES } )
                .break()
            .run();

        // Send multiple out-of-range messages to same partition
        const msg1 = { id: 'sensor1', type: 'temp', value: 25 };
        const msg2 = { id: 'sensor1', type: 'temp', value: 30 };
        const msg3 = { id: 'sensor1', type: 'temp', value: 35 };

        await pipelineHandle.processMessage( msg1 );
        await pipelineHandle.processMessage( msg2 );
        await pipelineHandle.processMessage( msg3 );

        // All should be processed with failures
        expect( msg1 ).to.have.property( 'bad' );
        expect( msg2 ).to.have.property( 'bad' );
        expect( msg3 ).to.have.property( 'bad' );

        await pipelineHandle.shutdown();
    } );

    it( 'applies different node pipelines per specialization', async function () {
        // Temperature: sanitize with range 0-50
        // Pressure: sanitize with range 0-200
        const pipelineHandle = await flow( 'differentPipelines' )
            .assetId( 'id' )
            .switch( 'type' )
            .case( 'temperature' )
                .sanitize( 'temp_check', 'value',
                    { failureReason: 'temp_out_of_range' },
                    { ranges: { value: { min: 0, max: 50 } } } )
                .break()
            .case( 'pressure' )
                .sanitize( 'pressure_check', 'value',
                    { failureReason: 'pressure_out_of_range' },
                    { ranges: { value: { min: 0, max: 200 } } } )
                .break()
            .run();

        // Temperature 60 is out of range for temp (0-50) - will trigger failure
        const tempMsg = { id: '1', type: 'temperature', value: 60 };
        await pipelineHandle.processMessage( tempMsg );
        expect( tempMsg.temp_out_of_range ).to.equal( 'range' );

        // Pressure 60 is in range for pressure (0-200) - no failure, no output
        const pressureMsg = { id: '2', type: 'pressure', value: 60 };
        await pipelineHandle.processMessage( pressureMsg );
        // sanitize only publishes on failure, so no property added for in-range value
        expect( pressureMsg ).to.not.have.property( 'pressure_out_of_range' );

        // Pressure 250 is out of range (0-200) - will trigger failure
        const pressureMsg2 = { id: '3', type: 'pressure', value: 250 };
        await pipelineHandle.processMessage( pressureMsg2 );
        expect( pressureMsg2.pressure_out_of_range ).to.equal( 'range' );

        await pipelineHandle.shutdown();
    } );

} );

// ============================================================================
// INTEGRATION TESTS - Pipeline Lifecycle
// ============================================================================

// Helper: create temporary CSV file
const createTestCsv = function ( rows ) {
    const tmpDir = os.tmpdir();
    const filePath = path.join( tmpDir, `test-${Date.now()}.csv` );
    const header = 'id,type,value';
    const lines = [ header, ...rows ];
    fs.writeFileSync( filePath, lines.join( '\n' ) );
    return filePath;
};

describe( 'flow — switch/case/break: integration lifecycle', function () {
    let testCsvPath = null;
    let pipelineHandle = null;

    afterEach( async function () {
        if ( pipelineHandle && pipelineHandle.shutdown ) {
            await pipelineHandle.shutdown();
            pipelineHandle = null;
        }
        if ( testCsvPath && fs.existsSync( testCsvPath ) ) {
            fs.unlinkSync( testCsvPath );
            testCsvPath = null;
        }
    } );

    it( 'starts multi-specialization pipeline with .run()', async function () {
        this.timeout( 5000 );

        const mockEmitter = {
            id: 'mqtt',
            createEmitter: function ( _config ) {
                return {
                    publishNow: function () {
                        return { ok: true };
                    },
                    shutdown: async function () {}
                };
            }
        };

        testCsvPath = createTestCsv( [
            '1,temperature,25.5'
        ] );

        const RANGES = {
            value: { min: 0, max: 200 }
        };

        pipelineHandle = await flow( 'routingTest' )
            .source( csv, { path: testCsvPath, delayMs: 0 } )
            .emitter( mockEmitter, {} )
            .assetId( 'id' )
            .switch( 'type' )
            .case( 'temperature' )
                .sanitize( 'sanitize_temp', [ 'value' ],
                    { failureReason: 'bad_reason' },
                    { ranges: RANGES } )
                .break()
            .case( 'pressure' )
                .sanitize( 'sanitize_pressure', [ 'value' ],
                    { failureReason: 'bad_reason' },
                    { ranges: RANGES } )
                .break()
            .run();

        // Wait for CSV processing
        await new Promise( ( r ) => setTimeout( r, 200 ) );

        // Verify the pipeline handle has the correct properties
        expect( pipelineHandle ).to.have.property( 'flowName', 'routingTest' );
        expect( pipelineHandle ).to.have.property( 'processMessage' );
        expect( pipelineHandle ).to.have.property( 'shutdown' );
        expect( pipelineHandle ).to.have.property( 'composerState' );
    } );

    it( 'returns pipeline handle with processMessage for multi-specialization', async function () {
        this.timeout( 5000 );

        const mockEmitter = {
            id: 'mqtt',
            createEmitter: function ( _config ) {
                return {
                    publishNow: function () {
                        return { ok: true };
                    },
                    shutdown: async function () {}
                };
            }
        };

        testCsvPath = createTestCsv( [ '1,temperature,25' ] );

        const RANGES = { value: { min: 0, max: 100 } };

        pipelineHandle = await flow( 'handleTest' )
            .source( csv, { path: testCsvPath } )
            .emitter( mockEmitter, {} )
            .switch( 'type' )
            .case( 'temperature' )
                .sanitize( 'sanitize', [ 'value' ],
                    { failureReason: 'bad_reason' },
                    { ranges: RANGES } )
                .break()
            .run();

        expect( pipelineHandle ).to.have.property( 'flowName', 'handleTest' );
        expect( pipelineHandle ).to.have.property( 'shutdown' );
        expect( pipelineHandle ).to.have.property( 'processMessage' );
        expect( pipelineHandle ).to.have.property( 'composerState' );
    } );

} );


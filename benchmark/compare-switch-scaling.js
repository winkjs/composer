/**
 * @fileoverview Switch/Case Routing Overhead — Scaling Test
 *
 * Does routing overhead grow with the number of switch cases?
 *
 *   Static:    8-node CPD pipeline (baseline, no routing)
 *   Switch2:   2×8 nodes — only temp executes
 *   Switch3:   3×8 nodes — only temp executes
 *   Switch10: 10×8 nodes — only temp executes
 *
 * All receive identical temp-only data so pipeline execution is the same.
 * The only variable is the number of defined (but unexecuted) specializations.
 *
 * Usage:
 *   node benchmark/compare-switch-scaling.js [partitions] [iterations]
 *   node benchmark/compare-switch-scaling.js 10 500
 */

import { createPipeline as createStaticPipeline } from './cpd-static-flow.js';
import { createPipeline as createSwitch2Pipeline } from './cpd-switch-flow.js';
import { createPipeline as createSwitch3Pipeline } from './cpd-switch3-flow.js';
import { createPipeline as createSwitch10Pipeline } from './cpd-switch10-flow.js';
import { data as rawData } from '../../data/cpd-data.js';

// ============================================================================
// CONFIGURATION
// ============================================================================
const PARTITIONS = parseInt( process.argv[ 2 ], 10 ) || 10;
const ITERATIONS = parseInt( process.argv[ 3 ], 10 ) || 500;
const PARTITION_OFFSET = 2;
const WARMUP_ITERATIONS = 5;

// ============================================================================
// RANDOM INTERLEAVING
// ============================================================================

const shuffle = function ( arr ) {
    for ( let i = arr.length - 1; i > 0; i -= 1 ) {
        const j = Math.floor( Math.random() * ( i + 1 ) );
        const temp = arr[ i ];
        arr[ i ] = arr[ j ];
        arr[ j ] = temp;
    }
    return arr;
};

const createPartitionOrder = function ( count ) {
    const order = new Array( count );
    for ( let i = 0; i < count; i += 1 ) {
        order[ i ] = i;
    }
    return order;
};

// ============================================================================
// DATA TRANSFORM (zero-allocation)
// ============================================================================

const msg = { id: 0, temp: 0, value: 0, type: 'temperature', seq: 0, timestamp: 0 };

/**
 * Fill pre-allocated message with temp-only data.
 * Switch flows use 'value' + 'type'; static uses 'temp'.
 * All get the same temperature values.
 */
const fillMessage = function ( partitionId, dataIndex, iteration ) {
    const base = rawData[ dataIndex ];
    const adjustedValue = base.temp + ( partitionId * PARTITION_OFFSET );

    msg.id = partitionId;
    msg.temp = adjustedValue;
    msg.value = adjustedValue;
    msg.type = 'temperature';
    msg.seq = ( iteration * rawData.length ) + dataIndex;
    msg.timestamp = Date.now();

    return msg;
};

// ============================================================================
// SINGLE BENCHMARK RUN
// ============================================================================
const runSingleBenchmark = async function ( name, createPipeline ) {
    const handle = await createPipeline();
    const partitionOrder = createPartitionOrder( PARTITIONS );

    // Warmup (random interleaving)
    for ( let iter = 0; iter < WARMUP_ITERATIONS; iter += 1 ) {
        for ( let d = 0; d < rawData.length; d += 1 ) {
            shuffle( partitionOrder );
            for ( const p of partitionOrder ) {
                fillMessage( p, d, iter );
                await handle.processMessage( msg ); // eslint-disable-line no-await-in-loop
            }
        }
    }

    // Force GC if available
    if ( global.gc ) global.gc();

    // Measurement (random interleaving)
    const startTime = process.hrtime.bigint();
    let totalMessages = 0;

    for ( let iter = 0; iter < ITERATIONS; iter += 1 ) {
        for ( let d = 0; d < rawData.length; d += 1 ) {
            shuffle( partitionOrder );
            for ( const p of partitionOrder ) {
                fillMessage( p, d, iter );
                await handle.processMessage( msg ); // eslint-disable-line no-await-in-loop
                totalMessages += 1;
            }
        }
    }

    const endTime = process.hrtime.bigint();
    await handle.shutdown();

    const durationNs = endTime - startTime;
    const durationMs = Number( durationNs ) / 1e6;
    const msgsPerSec = Math.round( totalMessages / ( durationMs / 1000 ) );
    const nsPerMsg = Number( durationNs ) / totalMessages;

    return { name, durationMs, totalMessages, msgsPerSec, nsPerMsg };
};

// ============================================================================
// COMPARISON
// ============================================================================
const runComparison = async function () {
    console.log( '\n========================================' );
    console.log( '  SWITCH ROUTING — SCALING TEST' );
    console.log( '========================================\n' );

    console.log( 'Configuration:' );
    console.log( `  Partitions:    ${PARTITIONS}` );
    console.log( `  Iterations:    ${ITERATIONS}` );
    console.log( `  Data points:   ${rawData.length}` );
    console.log( `  Total msgs:    ${( PARTITIONS * rawData.length * ITERATIONS ).toLocaleString()}` );
    console.log( '' );

    // Run static benchmark (8 nodes, baseline — no routing)
    process.stdout.write( 'Running static   (8 nodes, no routing)...  ' );
    const staticResult = await runSingleBenchmark( 'static', createStaticPipeline );
    console.log( 'done.' );

    if ( global.gc ) global.gc();

    // Run 2-case switch benchmark
    process.stdout.write( 'Running switch-2 (2×8 nodes, routed)...   ' );
    const switch2Result = await runSingleBenchmark( 'switch-2', createSwitch2Pipeline );
    console.log( 'done.' );

    if ( global.gc ) global.gc();

    // Run 3-case switch benchmark
    process.stdout.write( 'Running switch-3  (3×8 nodes, routed)...   ' );
    const switch3Result = await runSingleBenchmark( 'switch-3', createSwitch3Pipeline );
    console.log( 'done.' );

    if ( global.gc ) global.gc();

    // Run 10-case switch benchmark
    process.stdout.write( 'Running switch-10 (10×8 nodes, routed)...  ' );
    const switch10Result = await runSingleBenchmark( 'switch-10', createSwitch10Pipeline );
    console.log( 'done.' );

    // Calculate overhead vs static baseline
    const sw2Overhead = ( ( ( switch2Result.nsPerMsg - staticResult.nsPerMsg ) / staticResult.nsPerMsg ) * 100 ).toFixed( 2 );
    const sw3Overhead = ( ( ( switch3Result.nsPerMsg - staticResult.nsPerMsg ) / staticResult.nsPerMsg ) * 100 ).toFixed( 2 );
    const sw10Overhead = ( ( ( switch10Result.nsPerMsg - staticResult.nsPerMsg ) / staticResult.nsPerMsg ) * 100 ).toFixed( 2 );
    const sw2LatencyDiff = switch2Result.nsPerMsg - staticResult.nsPerMsg;
    const sw3LatencyDiff = switch3Result.nsPerMsg - staticResult.nsPerMsg;
    const sw10LatencyDiff = switch10Result.nsPerMsg - staticResult.nsPerMsg;

    // Results
    console.log( '\n========================================' );
    console.log( '  RESULTS' );
    console.log( '========================================\n' );

    console.log( '┌─────────────────┬───────────────────┬───────────────────┬───────────────────┬───────────────────┐' );
    console.log( '│ Metric          │ Static (baseline) │ Switch-2          │ Switch-3          │ Switch-10         │' );
    console.log( '├─────────────────┼───────────────────┼───────────────────┼───────────────────┼───────────────────┤' );
    console.log( `│ Throughput      │ ${staticResult.msgsPerSec.toLocaleString().padStart( 12 )} msg/s │ ${switch2Result.msgsPerSec.toLocaleString().padStart( 12 )} msg/s │ ${switch3Result.msgsPerSec.toLocaleString().padStart( 12 )} msg/s │ ${switch10Result.msgsPerSec.toLocaleString().padStart( 12 )} msg/s │` );
    console.log( `│ Latency         │ ${staticResult.nsPerMsg.toFixed( 0 ).padStart( 12 )} ns    │ ${switch2Result.nsPerMsg.toFixed( 0 ).padStart( 12 )} ns    │ ${switch3Result.nsPerMsg.toFixed( 0 ).padStart( 12 )} ns    │ ${switch10Result.nsPerMsg.toFixed( 0 ).padStart( 12 )} ns    │` );
    console.log( `│ vs Static       │ ${'-'.padStart( 12 )}       │ ${( sw2Overhead + '%' ).padStart( 12 )}       │ ${( sw3Overhead + '%' ).padStart( 12 )}       │ ${( sw10Overhead + '%' ).padStart( 12 )}       │` );
    console.log( `│ Total time      │ ${( staticResult.durationMs / 1000 ).toFixed( 2 ).padStart( 12 )} s     │ ${( switch2Result.durationMs / 1000 ).toFixed( 2 ).padStart( 12 )} s     │ ${( switch3Result.durationMs / 1000 ).toFixed( 2 ).padStart( 12 )} s     │ ${( switch10Result.durationMs / 1000 ).toFixed( 2 ).padStart( 12 )} s     │` );
    console.log( '└─────────────────┴───────────────────┴───────────────────┴───────────────────┴───────────────────┘' );

    console.log( '\n  Routing Scaling:' );
    console.log( `    2-case cost:    ${sw2LatencyDiff.toFixed( 0 ).padStart( 6 )} ns/msg  (${sw2Overhead}%)` );
    console.log( `    3-case cost:    ${sw3LatencyDiff.toFixed( 0 ).padStart( 6 )} ns/msg  (${sw3Overhead}%)` );
    console.log( `    10-case cost:   ${sw10LatencyDiff.toFixed( 0 ).padStart( 6 )} ns/msg  (${sw10Overhead}%)` );
    console.log( `    Marginal 2→3:   ${( sw3LatencyDiff - sw2LatencyDiff ).toFixed( 0 ).padStart( 6 )} ns/msg` );
    console.log( `    Marginal 3→10:  ${( sw10LatencyDiff - sw3LatencyDiff ).toFixed( 0 ).padStart( 6 )} ns/msg  (${( ( sw10LatencyDiff - sw3LatencyDiff ) / 7 ).toFixed( 0 )} ns/case)` );

    console.log( '\n========================================\n' );
};

// ============================================================================
// ENTRY POINT
// ============================================================================
runComparison()
    .catch( ( err ) => {
        console.error( 'Comparison failed:', err );
        throw err;
    } );

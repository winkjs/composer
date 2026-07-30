/**
 * @fileoverview NaN Propagation vs Switch/Case Routing
 *
 * Three-way comparison:
 *   Static:  8-node CPD pipeline (baseline)
 *   Switch:  2×8 nodes, routed — only temp pipeline runs (8 nodes execute)
 *   Dual:    16-node linear chain — 8 active + 8 idle via NaN propagation
 *
 * All three receive identical temp-only data.
 *
 * Usage:
 *   node benchmark/compare-nan.js [partitions] [iterations]
 *   node benchmark/compare-nan.js 10 500
 */

import { createPipeline as createStaticPipeline } from './cpd-static-flow.js';
import { createPipeline as createSwitchPipeline } from './cpd-switch-flow.js';
import { createPipeline as createDualPipeline } from './cpd-dual-flow.js';
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
 * Switch flow uses 'value' + 'type'; static/dual use 'temp'.
 * All three get the same temperature values.
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
    console.log( '  NaN PROPAGATION vs SWITCH ROUTING' );
    console.log( '========================================\n' );

    console.log( 'Configuration:' );
    console.log( `  Partitions:    ${PARTITIONS}` );
    console.log( `  Iterations:    ${ITERATIONS}` );
    console.log( `  Data points:   ${rawData.length}` );
    console.log( `  Total msgs:    ${( PARTITIONS * rawData.length * ITERATIONS ).toLocaleString()}` );
    console.log( '' );

    // Run static benchmark (8 nodes, baseline)
    process.stdout.write( 'Running static  (8 nodes, baseline)... ' );
    const staticResult = await runSingleBenchmark( 'static', createStaticPipeline );
    console.log( 'done.' );

    if ( global.gc ) global.gc();

    // Run switch benchmark (2×8 nodes, routed — only 8 execute)
    process.stdout.write( 'Running switch  (2×8 nodes, routed)... ' );
    const switchResult = await runSingleBenchmark( 'switch', createSwitchPipeline );
    console.log( 'done.' );

    if ( global.gc ) global.gc();

    // Run dual benchmark (16 nodes linear, 8 idle via NaN)
    process.stdout.write( 'Running dual    (16 nodes, 8 idle)...  ' );
    const dualResult = await runSingleBenchmark( 'dual', createDualPipeline );
    console.log( 'done.' );

    // Calculate overhead vs static baseline
    const switchOverhead = ( ( ( switchResult.nsPerMsg - staticResult.nsPerMsg ) / staticResult.nsPerMsg ) * 100 ).toFixed( 2 );
    const dualOverhead = ( ( ( dualResult.nsPerMsg - staticResult.nsPerMsg ) / staticResult.nsPerMsg ) * 100 ).toFixed( 2 );
    const switchLatencyDiff = switchResult.nsPerMsg - staticResult.nsPerMsg;
    const dualLatencyDiff = dualResult.nsPerMsg - staticResult.nsPerMsg;
    const costPerIdleNode = dualLatencyDiff / 8;

    // Results
    console.log( '\n========================================' );
    console.log( '  RESULTS' );
    console.log( '========================================\n' );

    console.log( '┌─────────────────┬───────────────────┬───────────────────┬───────────────────┐' );
    console.log( '│ Metric          │ Static (8 nodes)  │ Switch (2×8)      │ Dual (16 linear)  │' );
    console.log( '├─────────────────┼───────────────────┼───────────────────┼───────────────────┤' );
    console.log( `│ Throughput      │ ${staticResult.msgsPerSec.toLocaleString().padStart( 12 )} msg/s │ ${switchResult.msgsPerSec.toLocaleString().padStart( 12 )} msg/s │ ${dualResult.msgsPerSec.toLocaleString().padStart( 12 )} msg/s │` );
    console.log( `│ Latency         │ ${staticResult.nsPerMsg.toFixed( 0 ).padStart( 12 )} ns    │ ${switchResult.nsPerMsg.toFixed( 0 ).padStart( 12 )} ns    │ ${dualResult.nsPerMsg.toFixed( 0 ).padStart( 12 )} ns    │` );
    console.log( `│ vs Static       │ ${'-'.padStart( 12 )}       │ ${( switchOverhead + '%' ).padStart( 12 )}       │ ${( dualOverhead + '%' ).padStart( 12 )}       │` );
    console.log( `│ Total time      │ ${( staticResult.durationMs / 1000 ).toFixed( 2 ).padStart( 12 )} s     │ ${( switchResult.durationMs / 1000 ).toFixed( 2 ).padStart( 12 )} s     │ ${( dualResult.durationMs / 1000 ).toFixed( 2 ).padStart( 12 )} s     │` );
    console.log( '└─────────────────┴───────────────────┴───────────────────┴───────────────────┘' );

    console.log( `\n  Switch routing cost:  ${switchLatencyDiff.toFixed( 0 )} ns/msg` );
    console.log( `  NaN idle node cost:   ${costPerIdleNode.toFixed( 0 )} ns/node` );
    console.log( `  Total NaN overhead:   ${dualLatencyDiff.toFixed( 0 )} ns/msg (8 idle nodes)` );

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

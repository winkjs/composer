/**
 * @fileoverview Side-by-side benchmark comparison
 *
 * Runs both static and tunable flows, compares results.
 * Uses random interleaving to simulate realistic data arrival patterns.
 *
 * Usage:
 *   node benchmark/compare.js [partitions] [iterations]
 *   node benchmark/compare.js 10 500
 */

import { createPipeline as createStaticPipeline } from './cpd-static-flow.js';
import { createPipeline as createTunablePipeline } from './cpd-tunable-flow.js';
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

/**
 * Fisher-Yates shuffle for random partition ordering.
 * @param {Array} arr - Array to shuffle
 * @returns {Array} Same array, shuffled
 */
const shuffle = function ( arr ) {
    for ( let i = arr.length - 1; i > 0; i -= 1 ) {
        const j = Math.floor( Math.random() * ( i + 1 ) );
        const temp = arr[ i ];
        arr[ i ] = arr[ j ];
        arr[ j ] = temp;
    }
    return arr;
};

/**
 * Creates reusable partition order array.
 * @param {number} count - Number of partitions
 * @returns {number[]} Array [0, 1, 2, ..., count-1]
 */
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

/**
 * Pre-allocated message object for zero-allocation hot path.
 */
const msg = { id: 0, temp: 0, seq: 0, timestamp: 0 };

/**
 * Fill pre-allocated message with partition data.
 * @param {number} partitionId - Partition identifier
 * @param {number} dataIndex - Index in raw data array
 * @param {number} iteration - Current iteration number
 * @returns {Object} Same msg object, filled with new values
 */
const fillMessage = function ( partitionId, dataIndex, iteration ) {
    const base = rawData[ dataIndex ];
    msg.id = partitionId;
    msg.temp = base.temp + ( partitionId * PARTITION_OFFSET );
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

    return {
        name,
        durationMs,
        totalMessages,
        msgsPerSec,
        nsPerMsg
    };
};

// ============================================================================
// COMPARISON
// ============================================================================
const runComparison = async function () {
    console.log( '\n========================================' );
    console.log( '  CPD BENCHMARK COMPARISON' );
    console.log( '========================================\n' );

    console.log( 'Configuration:' );
    console.log( `  Partitions:    ${PARTITIONS}` );
    console.log( `  Iterations:    ${ITERATIONS}` );
    console.log( `  Data points:   ${rawData.length}` );
    console.log( `  Total msgs:    ${( PARTITIONS * rawData.length * ITERATIONS ).toLocaleString()}` );
    console.log( '' );

    // Run static benchmark
    process.stdout.write( 'Running static benchmark... ' );
    const staticResult = await runSingleBenchmark( 'static', createStaticPipeline );
    console.log( 'done.' );

    // Force GC between runs
    if ( global.gc ) global.gc();

    // Run tunable benchmark
    process.stdout.write( 'Running tunable benchmark... ' );
    const tunableResult = await runSingleBenchmark( 'tunable', createTunablePipeline );
    console.log( 'done.' );

    // Calculate overhead
    const throughputDiff = staticResult.msgsPerSec - tunableResult.msgsPerSec;
    const throughputPct = ( ( throughputDiff / staticResult.msgsPerSec ) * 100 ).toFixed( 2 );
    const latencyDiff = tunableResult.nsPerMsg - staticResult.nsPerMsg;

    // Results
    console.log( '\n========================================' );
    console.log( '  RESULTS' );
    console.log( '========================================\n' );

    console.log( '┌─────────────────┬───────────────────┬───────────────────┬────────────────┐' );
    console.log( '│ Metric          │ Static            │ Tunable           │ Overhead       │' );
    console.log( '├─────────────────┼───────────────────┼───────────────────┼────────────────┤' );
    console.log( `│ Throughput      │ ${staticResult.msgsPerSec.toLocaleString().padStart( 12 )} msg/s │ ${tunableResult.msgsPerSec.toLocaleString().padStart( 12 )} msg/s │ ${throughputPct.padStart( 9 )}%    │` );
    console.log( `│ Latency         │ ${staticResult.nsPerMsg.toFixed( 0 ).padStart( 12 )} ns    │ ${tunableResult.nsPerMsg.toFixed( 0 ).padStart( 12 )} ns    │ ${( '+' + latencyDiff.toFixed( 0 ) ).padStart( 9 )} ns   │` );
    console.log( `│ Total time      │ ${( staticResult.durationMs / 1000 ).toFixed( 2 ).padStart( 12 )} s     │ ${( tunableResult.durationMs / 1000 ).toFixed( 2 ).padStart( 12 )} s     │                │` );
    console.log( '└─────────────────┴───────────────────┴───────────────────┴────────────────┘' );

    console.log( '' );
    if ( parseFloat( throughputPct ) < 1 ) {
        console.log( '✓ Tunable overhead is negligible (< 1%)' );
    } else if ( parseFloat( throughputPct ) < 5 ) {
        console.log( '⚠ Tunable overhead is acceptable (< 5%)' );
    } else {
        console.log( '❌ Tunable overhead is significant (>= 5%)' );
    }

    console.log( '\n========================================\n' );

    return { static: staticResult, tunable: tunableResult, overhead: { throughputPct, latencyDiff } };
};

// ============================================================================
// ENTRY POINT
// ============================================================================
runComparison()
    .then( ( results ) => {
        if ( process.env.JSON_OUTPUT ) { // eslint-disable-line no-process-env
            console.log( JSON.stringify( results, null, 2 ) );
        }
    } )
    .catch( ( err ) => {
        console.error( 'Comparison failed:', err );
        throw err;
    } );

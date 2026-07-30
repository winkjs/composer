/**
 * @fileoverview Compression Benchmark Runner.
 *
 * Measures winnow compression pipeline performance with configurable
 * partitions (sensors). Uses synthetic vibration-like data with a
 * regime change to exercise all five winnow checks.
 *
 * Random partition interleaving simulates realistic multi-sensor
 * data arrival patterns and exposes cache thrashing.
 *
 * Usage:
 *   node benchmark/run-compression-benchmark.js [partitions] [iterations]
 *   node benchmark/run-compression-benchmark.js 1 1000      # single sensor
 *   node benchmark/run-compression-benchmark.js 100 500     # 100 sensors
 *   node benchmark/run-compression-benchmark.js 1000 100    # 1000 sensors
 *
 * Metrics: throughput (msg/sec), latency (ns/msg), memory, compression ratio.
 */

import { createPipeline } from './compression-winnow-flow.js';

// ── Configuration ──────────────────────────────────────────────────────────

const PARTITIONS = parseInt( process.argv[ 2 ], 10 ) || 1;
const ITERATIONS = parseInt( process.argv[ 3 ], 10 ) || 500;
const DATA_LENGTH = 500; // samples per iteration (simulates one snapshot segment)
const WARMUP_ITERATIONS = 2;

// ── Synthetic vibration data ───────────────────────────────────────────────
// Sinusoidal with noise + a regime change at 60% through.
// Exercises: warmup, deadband, trend reversal, step (regime), gap prevention.

const generateData = function ( n ) {
    const data = new Array( n );
    let seed = 42;
    const rng = function () {
        seed = ( ( Math.imul( seed, 1664525 ) ) + 1013904223 ) | 0;
        return ( ( seed >>> 0 ) + 1 ) / 4294967298;
    };
    const gauss = function () {
        const u1 = rng();
        const u2 = rng();
        return Math.sqrt( -2 * Math.log( u1 ) ) * Math.cos( 2 * Math.PI * u2 );
    };

    const changeAt = Math.floor( n * 0.6 );

    for ( let i = 0; i < n; i += 1 ) {
        const phase = ( 2 * Math.PI * i ) / 50;
        const amplitude = i < changeAt ? 0.15 : 0.30;
        const noise = gauss() * 0.02;
        data[ i ] = ( amplitude * Math.sin( phase ) ) + noise;
    }

    return data;
};

const rawData = generateData( DATA_LENGTH );

// ── Fisher-Yates shuffle ───────────────────────────────────────────────────

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
    for ( let i = 0; i < count; i += 1 ) order[ i ] = i;
    return order;
};

// ── Pre-allocated message (zero allocation in hot path) ────────────────────

const msg = { id: 0, value: 0, timestamp: 0 };

const fillMessage = function ( partitionId, dataIndex ) {
    msg.id = partitionId;
    msg.value = rawData[ dataIndex ] + ( partitionId * 0.001 ); // tiny per-partition offset
    msg.timestamp = dataIndex;
    // Clear downstream fields to prevent persistence across partitions
    msg.smoothed = undefined;
    msg.stdev = undefined;
    msg.gate = undefined;
    msg.trendDir = undefined;
    msg.roc = undefined;
    msg.store = undefined;
    msg.dev = undefined;
    msg.pred = undefined;
    msg.storedValue = undefined;
    return msg;
};

// ── Heap measurement ───────────────────────────────────────────────────────

const getHeapMB = function () {
    return Math.round( ( process.memoryUsage().heapUsed / 1048576 ) * 100 ) / 100;
};

// ── Run ────────────────────────────────────────────────────────────────────

const run = async function () {
    console.log( '\n════════════════════════════════════════' );
    console.log( '  COMPRESSION BENCHMARK (winnow node)' );
    console.log( '════════════════════════════════════════\n' );

    console.log( `  Partitions (sensors):  ${PARTITIONS}` );
    console.log( `  Iterations:            ${ITERATIONS}` );
    console.log( `  Samples per iteration: ${DATA_LENGTH}` );
    console.log( `  Total messages:        ${( PARTITIONS * DATA_LENGTH * ITERATIONS ).toLocaleString()}` );
    console.log( `  Warmup:                ${WARMUP_ITERATIONS} iterations\n` );

    // Init pipeline
    const handle = await createPipeline();
    console.log( `  Flow: ${handle.meta.name}` );
    console.log( `  Params: K=${handle.meta.params.K}, tightenBase=${handle.meta.params.tightenBase}\n` );

    // Warmup
    console.log( '  Warming up JIT...' );
    const warmupOrder = createPartitionOrder( PARTITIONS );
    for ( let iter = 0; iter < WARMUP_ITERATIONS; iter += 1 ) {
        for ( let d = 0; d < DATA_LENGTH; d += 1 ) {
            shuffle( warmupOrder );
            for ( const p of warmupOrder ) {
                fillMessage( p, d );
                await handle.processMessage( msg ); // eslint-disable-line no-await-in-loop
            }
        }
    }
    console.log( '  Done.\n' );

    if ( global.gc ) global.gc();

    // Measure
    console.log( '  Running benchmark...' );
    const heapBefore = getHeapMB();
    const startTime = process.hrtime.bigint();
    let totalMessages = 0;
    let storedMessages = 0;
    const partitionOrder = createPartitionOrder( PARTITIONS );

    for ( let iter = 0; iter < ITERATIONS; iter += 1 ) {
        for ( let d = 0; d < DATA_LENGTH; d += 1 ) {
            shuffle( partitionOrder );
            for ( const p of partitionOrder ) {
                fillMessage( p, d );
                await handle.processMessage( msg ); // eslint-disable-line no-await-in-loop
                totalMessages += 1;
                if ( msg.store === true ) storedMessages += 1;
            }
        }
        if ( ( iter + 1 ) % 100 === 0 ) {
            process.stdout.write( `  ${iter + 1}/${ITERATIONS}\r` );
        }
    }

    const endTime = process.hrtime.bigint();
    const heapAfter = getHeapMB();

    // Results
    const durationNs = endTime - startTime;
    const durationMs = Number( durationNs ) / 1e6;
    const msgsPerSec = Math.round( totalMessages / ( durationMs / 1000 ) );
    const nsPerMsg = Number( durationNs ) / totalMessages;
    const compressionRatio = ( ( 1 - ( storedMessages / totalMessages ) ) * 100 );

    console.log( '\n' );
    console.log( '  ════════════════════════════════════════' );
    console.log( '  RESULTS' );
    console.log( '  ════════════════════════════════════════\n' );

    console.log( `  Total time:        ${( durationMs / 1000 ).toFixed( 2 )}s` );
    console.log( `  Messages:          ${totalMessages.toLocaleString()}` );
    console.log( `  Throughput:        ${msgsPerSec.toLocaleString()} msg/sec` );
    console.log( `  Latency:           ${nsPerMsg.toFixed( 0 )} ns/msg` );
    console.log( '' );
    console.log( `  Stored messages:   ${storedMessages.toLocaleString()}` );
    console.log( `  Compression:       ${compressionRatio.toFixed( 1 )}%` );
    console.log( '' );
    console.log( `  Heap before:       ${heapBefore} MB` );
    console.log( `  Heap after:        ${heapAfter} MB` );
    console.log( `  Heap delta:        ${( heapAfter - heapBefore ).toFixed( 2 )} MB` );
    console.log( `  Per partition:     ${( ( heapAfter - heapBefore ) / PARTITIONS * 1024 ).toFixed( 1 )} KB` );
    console.log( '' );

    await handle.shutdown();
    console.log( '  ════════════════════════════════════════\n' );
};

run().catch( ( err ) => {
    console.error( 'Benchmark failed:', err );
    throw err;
} );

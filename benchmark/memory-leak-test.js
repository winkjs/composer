/**
 * @fileoverview Memory Leak Detection Test
 *
 * Runs extended iterations with periodic memory sampling to detect leaks.
 * A leak would show monotonically increasing heap after GC.
 *
 * Usage:
 *   node --expose-gc benchmark/memory-leak-test.js [partitions] [iterations] [sample-interval]
 *   node --expose-gc benchmark/memory-leak-test.js 10 5000 500
 */

import { createPipeline as createStaticPipeline } from './cpd-static-flow.js';
import { createPipeline as createTunablePipeline } from './cpd-tunable-flow.js';
import { data as rawData } from '../../data/cpd-data.js';

const FLOW_TYPE = process.argv[ 5 ] || 'static';
const createPipeline = FLOW_TYPE === 'tunable' ? createTunablePipeline : createStaticPipeline;

// ============================================================================
// CONFIGURATION
// ============================================================================
const PARTITIONS = parseInt( process.argv[ 2 ], 10 ) || 10;
const ITERATIONS = parseInt( process.argv[ 3 ], 10 ) || 5000;
const SAMPLE_INTERVAL = parseInt( process.argv[ 4 ], 10 ) || 500;
const PARTITION_OFFSET = 2;

// ============================================================================
// MEMORY SAMPLING
// ============================================================================
const samples = [];

const sampleMemory = function ( iteration ) {
    // Force GC to get true retained memory
    if ( global.gc ) global.gc();

    const mem = process.memoryUsage();
    samples.push( {
        iteration,
        heapUsed: Math.round( mem.heapUsed / 1024 / 1024 * 100 ) / 100,
        heapTotal: Math.round( mem.heapTotal / 1024 / 1024 * 100 ) / 100,
        rss: Math.round( mem.rss / 1024 / 1024 * 100 ) / 100,
        external: Math.round( mem.external / 1024 / 1024 * 100 ) / 100
    } );
};

// ============================================================================
// LEAK DETECTION ANALYSIS
// ============================================================================
const analyzeForLeak = function () {
    if ( samples.length < 3 ) return { leak: false, reason: 'Insufficient samples' };

    // Skip first sample (warmup)
    const heapValues = samples.slice( 1 ).map( ( s ) => s.heapUsed );

    // Calculate linear regression slope
    const n = heapValues.length;
    const sumX = ( n * ( n - 1 ) ) / 2;
    const sumY = heapValues.reduce( ( a, b ) => a + b, 0 );
    const sumXY = heapValues.reduce( ( sum, y, x ) => sum + ( x * y ), 0 );
    const sumX2 = ( n * ( n - 1 ) * ( ( 2 * n ) - 1 ) ) / 6;

    const slope = ( ( n * sumXY ) - ( sumX * sumY ) ) / ( ( n * sumX2 ) - ( sumX * sumX ) );
    const avgHeap = sumY / n;

    // Calculate min, max, stddev
    const minHeap = Math.min( ...heapValues );
    const maxHeap = Math.max( ...heapValues );
    const variance = heapValues.reduce( ( sum, v ) => sum + Math.pow( v - avgHeap, 2 ), 0 ) / n;
    const stddev = Math.sqrt( variance );

    // Leak detection criteria:
    // 1. Positive slope > 0.001 MB per sample interval (growing trend)
    // 2. Last 3 samples all above average (sustained growth)
    // 3. Range > 2x stddev (not just noise)

    const lastThree = heapValues.slice( -3 );
    const lastThreeAboveAvg = lastThree.every( ( v ) => v > avgHeap );
    const range = maxHeap - minHeap;

    const hasGrowthTrend = slope > 0.001;
    const hasSustainedGrowth = lastThreeAboveAvg && ( lastThree[ 2 ] > lastThree[ 0 ] );
    const significantRange = range > ( 2 * stddev );

    const isLeak = hasGrowthTrend && hasSustainedGrowth && significantRange;

    return {
        leak: isLeak,
        slope: Math.round( slope * 10000 ) / 10000,
        avgHeap: Math.round( avgHeap * 100 ) / 100,
        minHeap: Math.round( minHeap * 100 ) / 100,
        maxHeap: Math.round( maxHeap * 100 ) / 100,
        stddev: Math.round( stddev * 100 ) / 100,
        range: Math.round( range * 100 ) / 100,
        criteria: {
            hasGrowthTrend,
            hasSustainedGrowth,
            significantRange
        }
    };
};

// ============================================================================
// DATA TRANSFORM
// ============================================================================
const transformMessage = function ( partitionId, dataIndex, iteration ) {
    const base = rawData[ dataIndex ];
    return {
        id: partitionId,
        temp: base.temp + ( partitionId * PARTITION_OFFSET ),
        seq: ( iteration * rawData.length ) + dataIndex,
        timestamp: Date.now()
    };
};

// ============================================================================
// MAIN TEST
// ============================================================================
const runLeakTest = async function () {
    console.log( '\n========================================' );
    console.log( '  MEMORY LEAK DETECTION TEST' );
    console.log( '========================================\n' );

    if ( !global.gc ) {
        console.log( '⚠ Run with --expose-gc for accurate results\n' );
    }

    console.log( 'Configuration:' );
    console.log( `  Partitions:       ${PARTITIONS}` );
    console.log( `  Iterations:       ${ITERATIONS}` );
    console.log( `  Sample interval:  every ${SAMPLE_INTERVAL} iterations` );
    console.log( `  Messages/iter:    ${PARTITIONS * rawData.length}` );
    console.log( `  Total messages:   ${( PARTITIONS * rawData.length * ITERATIONS ).toLocaleString()}` );
    console.log( '' );

    // Initialize pipeline
    console.log( 'Initializing pipeline...' );
    const handle = await createPipeline();
    console.log( '  Done.\n' );

    // Initial sample
    sampleMemory( 0 );
    console.log( `Initial heap: ${samples[ 0 ].heapUsed} MB\n` );

    console.log( 'Running leak test...' );
    const startTime = Date.now();

    for ( let iter = 0; iter < ITERATIONS; iter += 1 ) {
        // Process all partitions for this iteration
        for ( let p = 0; p < PARTITIONS; p += 1 ) {
            for ( let d = 0; d < rawData.length; d += 1 ) {
                const msg = transformMessage( p, d, iter );
                await handle.processMessage( msg ); // eslint-disable-line no-await-in-loop
            }
        }

        // Sample memory at intervals
        if ( ( iter + 1 ) % SAMPLE_INTERVAL === 0 ) {
            sampleMemory( iter + 1 );
            const latest = samples[ samples.length - 1 ];
            process.stdout.write(
                `  Iter ${( iter + 1 ).toString().padStart( 5 )} | ` +
                `Heap: ${latest.heapUsed.toFixed( 2 ).padStart( 6 )} MB | ` +
                `RSS: ${latest.rss.toFixed( 2 ).padStart( 6 )} MB\n`
            );
        }
    }

    const elapsed = ( ( Date.now() - startTime ) / 1000 ).toFixed( 2 );
    console.log( `\nCompleted in ${elapsed}s\n` );

    // Final sample
    sampleMemory( ITERATIONS );

    // Cleanup
    await handle.shutdown();

    // Analysis
    const analysis = analyzeForLeak();

    console.log( '========================================' );
    console.log( '  RESULTS' );
    console.log( '========================================\n' );

    console.log( 'Memory Samples (after forced GC):' );
    console.log( '┌──────────┬───────────┬───────────┬───────────┐' );
    console.log( '│ Iter     │ Heap (MB) │ RSS (MB)  │ External  │' );
    console.log( '├──────────┼───────────┼───────────┼───────────┤' );
    for ( const s of samples ) {
        console.log(
            `│ ${s.iteration.toString().padStart( 8 )} │ ` +
            `${s.heapUsed.toFixed( 2 ).padStart( 9 )} │ ` +
            `${s.rss.toFixed( 2 ).padStart( 9 )} │ ` +
            `${s.external.toFixed( 2 ).padStart( 9 )} │`
        );
    }
    console.log( '└──────────┴───────────┴───────────┴───────────┘' );
    console.log( '' );

    console.log( 'Statistical Analysis:' );
    console.log( `  Heap min:     ${analysis.minHeap} MB` );
    console.log( `  Heap max:     ${analysis.maxHeap} MB` );
    console.log( `  Heap avg:     ${analysis.avgHeap} MB` );
    console.log( `  Heap stddev:  ${analysis.stddev} MB` );
    console.log( `  Heap range:   ${analysis.range} MB` );
    console.log( `  Slope:        ${analysis.slope} MB/sample` );
    console.log( '' );

    console.log( 'Leak Detection Criteria:' );
    console.log( `  Growth trend (slope > 0.001):     ${analysis.criteria.hasGrowthTrend ? '❌ YES' : '✓ NO'}` );
    console.log( `  Sustained growth (last 3 > avg):  ${analysis.criteria.hasSustainedGrowth ? '❌ YES' : '✓ NO'}` );
    console.log( `  Significant range (> 2σ):         ${analysis.criteria.significantRange ? '⚠ YES' : '✓ NO'}` );
    console.log( '' );

    if ( analysis.leak ) {
        console.log( '❌ POTENTIAL MEMORY LEAK DETECTED' );
        console.log( '   Heap shows consistent growth pattern over time.' );
    } else {
        console.log( '✓ NO MEMORY LEAK DETECTED' );
        console.log( '   Heap remains bounded within normal variance.' );
    }

    console.log( '\n========================================\n' );

    return { samples, analysis };
};

// ============================================================================
// ENTRY POINT
// ============================================================================
runLeakTest()
    .catch( ( err ) => {
        console.error( 'Test failed:', err );
        throw err;
    } );

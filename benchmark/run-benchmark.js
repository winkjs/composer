/**
 * @fileoverview CPD Benchmark Runner
 *
 * Measures pipeline performance with configurable partitions and iterations.
 * Applies deterministic per-partition offset transform to temperature data.
 *
 * Uses random interleaving to simulate realistic data arrival patterns:
 * - At each time step, partitions are processed in random order
 * - Per-partition temporal order is preserved (required for change detection)
 * - Maximizes partition switching to expose memory cache thrashing
 *
 * Usage:
 *   node benchmark/run-benchmark.js [flow] [partitions] [iterations]
 *   node benchmark/run-benchmark.js static 10 500
 *   node benchmark/run-benchmark.js tunable 10 500
 *   node benchmark/run-benchmark.js switch 10 500
 *
 * Metrics collected:
 * - Total processing time
 * - Messages per second (throughput)
 * - Nanoseconds per message (latency)
 * - Memory usage (heap before/after)
 * - Change detection validation per partition
 */

import { createPipeline as createStaticPipeline } from './cpd-static-flow.js';
import { createPipeline as createTunablePipeline } from './cpd-tunable-flow.js';
import { createPipeline as createSwitchPipeline } from './cpd-switch-flow.js';
import { data as rawData } from '../../data/cpd-data.js';

// ============================================================================
// CONFIGURATION
// ============================================================================
const FLOW_TYPE = process.argv[ 2 ] || 'static';  // 'static', 'tunable', or 'switch'
const PARTITIONS = parseInt( process.argv[ 3 ], 10 ) || 10;
const ITERATIONS = parseInt( process.argv[ 4 ], 10 ) || 500;

const PIPELINE_FACTORIES = {
    static: createStaticPipeline,
    tunable: createTunablePipeline,
    switch: createSwitchPipeline
};
const createPipeline = PIPELINE_FACTORIES[ FLOW_TYPE ] || createStaticPipeline;
const PARTITION_OFFSET = 2;  // Temperature offset per partition
const WARMUP_ITERATIONS = 1; // JIT warmup before measurement

// ============================================================================
// RANDOM INTERLEAVING
// ============================================================================

/**
 * Fisher-Yates shuffle for random partition ordering.
 * Mutates array in place for zero-allocation hot path.
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
 * Reused across all iterations to avoid GC pressure.
 * Switch flow uses 'value' and 'type'; static/tunable use 'temp'.
 */
const msg = { id: 0, temp: 0, value: 0, type: '', seq: 0, timestamp: 0 };

/**
 * Specialization types for switch flow.
 * Alternates per data index to simulate mixed message streams.
 */
const SPECIALIZATION_TYPES = [ 'temperature', 'pressure' ];

/**
 * Fill pre-allocated message with partition data.
 * Mutates msg in place - no allocation.
 * @param {number} partitionId - Partition identifier
 * @param {number} dataIndex - Index in raw data array
 * @param {number} iteration - Current iteration number
 * @returns {Object} Same msg object, filled with new values
 */
const fillMessage = function ( partitionId, dataIndex, iteration ) {
    const base = rawData[ dataIndex ];
    const adjustedValue = base.temp + ( partitionId * PARTITION_OFFSET );

    msg.id = partitionId;
    msg.temp = adjustedValue;           // For static/tunable flows
    msg.value = adjustedValue;          // For switch flow
    msg.type = SPECIALIZATION_TYPES[ dataIndex % 2 ];  // Alternate temperature/pressure
    msg.seq = ( iteration * rawData.length ) + dataIndex;
    msg.timestamp = Date.now();

    // Clear specialization-specific output fields for routing verification
    // (prevents field persistence across messages in reused object)
    msg.temp_m3 = undefined;
    msg.pres_m3 = undefined;

    return msg;
};

// ============================================================================
// METRICS COLLECTION
// ============================================================================

/**
 * Captures heap memory usage.
 * @returns {number} Heap used in MB
 */
const getHeapMB = function () {
    const mem = process.memoryUsage();
    return Math.round( ( mem.heapUsed / 1024 / 1024 ) * 100 ) / 100;
};

/**
 * Formats duration in human-readable form.
 * @param {bigint} ns - Duration in nanoseconds
 * @returns {string} Formatted string
 */
const formatDuration = function ( ns ) {
    const ms = Number( ns ) / 1e6;
    if ( ms < 1000 ) return `${ms.toFixed( 2 )}ms`;
    return `${( ms / 1000 ).toFixed( 2 )}s`;
};

// ============================================================================
// CHANGE DETECTION TRACKER
// ============================================================================

/**
 * Tracks change detection events per partition.
 */
const createChangeTracker = function () {
    const detections = Object.create( null );

    return {
        record: function ( partitionId, msgIndex ) {
            if ( !detections[ partitionId ] ) {
                detections[ partitionId ] = [];
            }
            detections[ partitionId ].push( msgIndex );
        },
        getDetections: function () {
            return detections;
        },
        getSummary: function () {
            const summary = Object.create( null );
            for ( const [ pid, indices ] of Object.entries( detections ) ) {
                summary[ pid ] = {
                    count: indices.length,
                    firstAt: indices[ 0 ] ?? null
                };
            }
            return summary;
        }
    };
};

// ============================================================================
// ROUTING VERIFICATION TRACKER (for switch flows)
// ============================================================================

/**
 * Verifies messages are routed to correct specialization pipeline.
 * For switch flows, checks that specialization-specific fields are set.
 */
const createRoutingTracker = function () {
    let tempCorrect = 0;
    let tempWrong = 0;
    let presCorrect = 0;
    let presWrong = 0;

    return {
        /**
         * Verify routing after message processing.
         * Temperature messages should have temp_m3, pressure should have pres_m3.
         * @param {Object} processedMsg - Message after pipeline processing
         */
        verify: function ( processedMsg ) {
            if ( processedMsg.type === 'temperature' ) {
                // Temperature message should have temp_m3 (not pres_m3)
                if ( processedMsg.temp_m3 !== undefined && processedMsg.pres_m3 === undefined ) {
                    tempCorrect += 1;
                } else {
                    tempWrong += 1;
                }
            } else if ( processedMsg.type === 'pressure' ) {
                // Pressure message should have pres_m3 (not temp_m3)
                if ( processedMsg.pres_m3 !== undefined && processedMsg.temp_m3 === undefined ) {
                    presCorrect += 1;
                } else {
                    presWrong += 1;
                }
            }
        },
        getSummary: function () {
            return {
                temperature: { correct: tempCorrect, wrong: tempWrong },
                pressure: { correct: presCorrect, wrong: presWrong },
                totalCorrect: tempCorrect + presCorrect,
                totalWrong: tempWrong + presWrong
            };
        }
    };
};

// ============================================================================
// BENCHMARK EXECUTION
// ============================================================================

const runBenchmark = async function () {
    const FLOW_LABELS = {
        static: 'Static Parameters',
        tunable: 'Tunable Parameters',
        switch: 'Switch/Case Specialization'
    };
    const flowLabel = FLOW_LABELS[ FLOW_TYPE ] || 'Static Parameters';
    console.log( '\n========================================' );
    console.log( `  CPD BENCHMARK (${flowLabel})` );
    console.log( '========================================\n' );

    console.log( 'Configuration:' );
    console.log( `  Partitions:    ${PARTITIONS}` );
    console.log( `  Iterations:    ${ITERATIONS}` );
    console.log( `  Data points:   ${rawData.length}` );
    console.log( `  Total msgs:    ${( PARTITIONS * rawData.length * ITERATIONS ).toLocaleString()}` );
    console.log( `  Warmup:        ${WARMUP_ITERATIONS} iterations\n` );

    // Create pipeline
    console.log( 'Initializing pipeline...' );
    const handle = await createPipeline();
    console.log( `  Flow: ${handle.meta.name}` );
    console.log( `  Params: delta=${handle.meta.params.delta}, lambda=${handle.meta.params.lambda}` );
    if ( handle.meta.specializations ) {
        console.log( `  Specializations: ${handle.meta.specializations.join( ', ' )}` );
    }
    console.log( '' );

    // Change detection tracker
    const tracker = createChangeTracker();

    // Routing verification tracker (for switch flows)
    const routingTracker = FLOW_TYPE === 'switch' ? createRoutingTracker() : null;

    // Wrap processMessage to track change detections (uses global msg)
    const processAndTrack = async function ( msgIndex ) {
        await handle.processMessage( msg );
        // Check if change was detected (msg is enriched by pipeline)
        if ( msg.changeDetected ) {
            tracker.record( msg.id, msgIndex );
        }
        // Verify routing for switch flows
        if ( routingTracker ) {
            routingTracker.verify( msg );
        }
    };

    // ========================================================================
    // WARMUP PHASE (random interleaving)
    // ========================================================================
    console.log( 'Warming up JIT (random interleaving)...' );
    const warmupOrder = createPartitionOrder( PARTITIONS );
    for ( let iter = 0; iter < WARMUP_ITERATIONS; iter += 1 ) {
        for ( let d = 0; d < rawData.length; d += 1 ) {
            shuffle( warmupOrder );
            for ( const p of warmupOrder ) {
                fillMessage( p, d, iter );
                await handle.processMessage( msg ); // eslint-disable-line no-await-in-loop
            }
        }
    }
    console.log( '  Done.\n' );

    // Force GC if available (run with --expose-gc)
    if ( global.gc ) {
        global.gc();
    }

    // ========================================================================
    // MEASUREMENT PHASE (random interleaving)
    // ========================================================================
    console.log( 'Running benchmark (random interleaving)...' );

    const heapBefore = getHeapMB();
    const startTime = process.hrtime.bigint();

    let totalMessages = 0;
    const partitionOrder = createPartitionOrder( PARTITIONS );

    for ( let iter = 0; iter < ITERATIONS; iter += 1 ) {
        for ( let d = 0; d < rawData.length; d += 1 ) {
            shuffle( partitionOrder );
            for ( const p of partitionOrder ) {
                fillMessage( p, d, iter );
                await processAndTrack( d ); // eslint-disable-line no-await-in-loop
                totalMessages += 1;
            }
        }

        // Progress indicator
        if ( ( iter + 1 ) % 100 === 0 ) {
            process.stdout.write( `  ${iter + 1}/${ITERATIONS} iterations\r` );
        }
    }

    const endTime = process.hrtime.bigint();
    const heapAfter = getHeapMB();

    console.log( '\n' );

    // ========================================================================
    // RESULTS
    // ========================================================================
    const durationNs = endTime - startTime;
    const durationMs = Number( durationNs ) / 1e6;
    const msgsPerSec = Math.round( totalMessages / ( durationMs / 1000 ) );
    const nsPerMsg = Number( durationNs ) / totalMessages;

    console.log( '========================================' );
    console.log( '  RESULTS' );
    console.log( '========================================\n' );

    console.log( 'Performance:' );
    console.log( `  Total time:      ${formatDuration( durationNs )}` );
    console.log( `  Messages:        ${totalMessages.toLocaleString()}` );
    console.log( `  Throughput:      ${msgsPerSec.toLocaleString()} msg/sec` );
    console.log( `  Latency:         ${nsPerMsg.toFixed( 0 )} ns/msg` );
    console.log( '' );

    console.log( 'Memory:' );
    console.log( `  Heap before:     ${heapBefore} MB` );
    console.log( `  Heap after:      ${heapAfter} MB` );
    console.log( `  Delta:           ${( heapAfter - heapBefore ).toFixed( 2 )} MB` );
    console.log( '' );

    console.log( 'Change Detection (first occurrence per partition):' );
    const summary = tracker.getSummary();
    const partitionIds = Object.keys( summary ).sort( ( a, b ) => Number( a ) - Number( b ) );

    if ( partitionIds.length === 0 ) {
        console.log( '  No changes detected!' );
    } else {
        // Show first few and last few if many partitions
        const MAX_SHOW = 5;
        const showIds = partitionIds.length <= ( MAX_SHOW * 2 ) ?
            partitionIds :
            [ ...partitionIds.slice( 0, MAX_SHOW ), '...', ...partitionIds.slice( -MAX_SHOW ) ];

        for ( const pid of showIds ) {
            if ( pid === '...' ) {
                console.log( '  ...' );
            } else {
                const s = summary[ pid ];
                console.log( `  Partition ${pid}: first at index ${s.firstAt}, total ${s.count}` );
            }
        }
    }
    console.log( '' );

    // ========================================================================
    // VALIDATION
    // ========================================================================
    console.log( 'Validation:' );
    const expectedChangeIndex = 485;  // Approximate change point in data
    const tolerance = 20;

    let valid = true;
    for ( const pid of Object.keys( summary ) ) {
        const firstAt = summary[ pid ].firstAt;
        if ( Math.abs( firstAt - expectedChangeIndex ) > tolerance ) {
            console.log( `  ❌ Partition ${pid}: change at ${firstAt}, expected ~${expectedChangeIndex}` );
            valid = false;
        }
    }

    if ( valid && partitionIds.length === PARTITIONS ) {
        console.log( `  ✓ All ${PARTITIONS} partitions detected change near index ${expectedChangeIndex}` );
    } else if ( partitionIds.length !== PARTITIONS ) {
        console.log( `  ⚠ Only ${partitionIds.length}/${PARTITIONS} partitions detected changes` );
    }

    // Routing verification (switch flows only)
    if ( routingTracker ) {
        console.log( '' );
        console.log( 'Routing Verification:' );
        const routing = routingTracker.getSummary();
        console.log( `  Temperature: ${routing.temperature.correct.toLocaleString()} correct, ${routing.temperature.wrong} wrong` );
        console.log( `  Pressure:    ${routing.pressure.correct.toLocaleString()} correct, ${routing.pressure.wrong} wrong` );
        if ( routing.totalWrong === 0 ) {
            console.log( `  ✓ All ${routing.totalCorrect.toLocaleString()} messages routed correctly` );
        } else {
            console.log( `  ❌ ${routing.totalWrong} messages routed incorrectly!` );
        }
    }

    console.log( '\n========================================\n' );

    // Cleanup
    await handle.shutdown();

    // Return results for programmatic use
    return {
        config: { partitions: PARTITIONS, iterations: ITERATIONS, dataPoints: rawData.length },
        performance: { durationMs, totalMessages, msgsPerSec, nsPerMsg },
        memory: { heapBefore, heapAfter, delta: heapAfter - heapBefore },
        validation: { valid, partitionsWithChange: partitionIds.length }
    };
};

// ============================================================================
// ENTRY POINT
// ============================================================================
runBenchmark()
    .then( ( results ) => {
        // Output JSON for programmatic consumption
        if ( process.env.JSON_OUTPUT ) { // eslint-disable-line no-process-env
            console.log( JSON.stringify( results, null, 2 ) );
        }
    } )
    .catch( ( err ) => {
        console.error( 'Benchmark failed:', err );
        throw err;
    } );

/**
 * @fileoverview QuestDB Write Benchmark
 *
 * Measures QuestDB storage adapter write performance with configurable
 * message counts and flush modes.
 *
 * Requires running QuestDB instance:
 *   docker run -p 9000:9000 -p 8812:8812 questdb/questdb
 *
 * Usage:
 *   node benchmark/questdb-write.js [messages] [flushMode] [autoFlushRows]
 *   node benchmark/questdb-write.js 100000 manual
 *   node benchmark/questdb-write.js 100000 auto 1000
 *
 * Metrics collected:
 * - Total write time (excluding flush)
 * - Flush time (for manual mode)
 * - Messages per second (throughput)
 * - Nanoseconds per message (latency)
 * - Memory usage (heap before/after)
 */

import pg from 'pg';
import { createQuestDBStorage } from '../src/core/storage-manager/questdb/index.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const QUESTDB_ILP_URL = process.env.QUESTDB_ILP_URL || 'localhost:9000'; // eslint-disable-line no-process-env
const QUESTDB_PG_URL = process.env.QUESTDB_PG_URL || 'localhost:8812'; // eslint-disable-line no-process-env

const MESSAGE_COUNT = parseInt( process.argv[ 2 ], 10 ) || 100000;
const FLUSH_MODE = process.argv[ 3 ] || 'manual';
const AUTO_FLUSH_ROWS = parseInt( process.argv[ 4 ], 10 ) || 1000;

const TABLE_PREFIX = `bench_${Date.now()}`;
const PARTITION_COUNT = 10;
const WARMUP_MESSAGES = 1000;

// ============================================================================
// TEST ASSET CLASS
// ============================================================================

const benchAssetClass = {
    name: 'benchmark',
    columns: {
        ts: { type: 'timestamp' },
        temp: { type: 'float64' },
        pressure: { type: 'float64' },
        count: { type: 'int64' },
        active: { type: 'bool' },
        mode: { type: 'string' }
    },
    insightTypes: {
        telemetry: {
            columns: [ 'ts', 'temp', 'pressure', 'count', 'active', 'mode' ],
            designatedTimestamp: 'ts'
        }
    }
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Check if QuestDB is available.
 *
 * @returns {Promise<boolean>} True if QuestDB is reachable
 */
const isQuestDBAvailable = async function () {
    const [ host, port ] = QUESTDB_PG_URL.split( ':' );
    const client = new pg.Client( {
        host,
        port: parseInt( port, 10 ),
        database: 'qdb',
        user: 'admin',
        password: process.env.QUESTDB_PASSWORD ?? 'quest',
        connectionTimeoutMillis: 3000
    } );

    try {
        await client.connect();
        await client.query( 'SELECT 1' );
        await client.end();
        return true;
    } catch ( _err ) { // eslint-disable-line no-unused-vars
        return false;
    }
};

/**
 * Drop test table (cleanup).
 *
 * @param {string} prefix - Table prefix
 */
const dropTestTable = async function ( prefix ) {
    // Wait for QuestDB eventual consistency before dropping
    // ILP writes may not be immediately visible via SQL
    await new Promise( ( resolve ) => setTimeout( resolve, 500 ) );

    const [ host, port ] = QUESTDB_PG_URL.split( ':' );
    const client = new pg.Client( {
        host,
        port: parseInt( port, 10 ),
        database: 'qdb',
        user: 'admin',
        password: process.env.QUESTDB_PASSWORD ?? 'quest'
    } );

    try {
        await client.connect();
        await client.query( `DROP TABLE IF EXISTS ${prefix}_telemetry` );
        await client.end();
    } catch ( _err ) { // eslint-disable-line no-unused-vars
        // Ignore cleanup errors
    }
};

/**
 * Captures heap memory usage.
 *
 * @returns {number} Heap used in MB
 */
const getHeapMB = function () {
    const mem = process.memoryUsage();
    return Math.round( ( mem.heapUsed / 1024 / 1024 ) * 100 ) / 100;
};

/**
 * Formats duration in human-readable form.
 *
 * @param {bigint} ns - Duration in nanoseconds
 * @returns {string} Formatted string
 */
const formatDuration = function ( ns ) {
    const ms = Number( ns ) / 1e6;
    if ( ms < 1000 ) return `${ms.toFixed( 2 )}ms`;
    return `${( ms / 1000 ).toFixed( 2 )}s`;
};

// ============================================================================
// DATA GENERATION (zero-allocation hot path)
// ============================================================================

/**
 * Pre-allocated message object for zero-allocation hot path.
 */
const msg = {
    ts: 0,
    temp: 0,
    pressure: 0,
    count: 0,
    active: true,
    mode: 'running'
};

const MODES = [ 'running', 'idle', 'startup', 'shutdown', 'maintenance' ];

/**
 * Fill pre-allocated message with synthetic data.
 * Mutates msg in place - no allocation.
 *
 * @param {number} index - Message index
 * @returns {Object} Same msg object, filled with new values
 */
const fillMessage = function ( index ) {
    msg.ts = Date.now();
    msg.temp = 20 + ( Math.sin( index * 0.01 ) * 10 );
    msg.pressure = 100 + ( Math.cos( index * 0.01 ) * 5 );
    msg.count = index;
    msg.active = ( index % 10 ) !== 0;
    msg.mode = MODES[ index % 5 ];
    return msg;
};

/**
 * Get partition ID for message (round-robin).
 *
 * @param {number} index - Message index
 * @returns {string} Partition ID
 */
const getPartitionId = function ( index ) {
    return `sensor-${String( index % PARTITION_COUNT ).padStart( 3, '0' )}`;
};

// ============================================================================
// BENCHMARK EXECUTION
// ============================================================================

const runBenchmark = async function () {
    console.log( '\n========================================' );
    console.log( '  QUESTDB WRITE BENCHMARK' );
    console.log( '========================================\n' );

    // Check QuestDB availability
    const available = await isQuestDBAvailable();
    if ( !available ) {
        console.log( '❌ QuestDB not available!' );
        console.log( '   Run: docker run -p 9000:9000 -p 8812:8812 questdb/questdb' );
        console.log( '' );
        return null;
    }

    console.log( 'Configuration:' );
    console.log( `  Messages:        ${MESSAGE_COUNT.toLocaleString()}` );
    console.log( `  Flush mode:      ${FLUSH_MODE}` );
    if ( FLUSH_MODE === 'auto' ) {
        console.log( `  Auto flush rows: ${AUTO_FLUSH_ROWS}` );
    }
    console.log( `  Partitions:      ${PARTITION_COUNT}` );
    console.log( `  Warmup:          ${WARMUP_MESSAGES.toLocaleString()} messages` );
    console.log( `  Table:           ${TABLE_PREFIX}_telemetry` );
    console.log( '' );

    // Create storage
    console.log( 'Initializing storage...' );
    const storageOptions = {
        ilpUrl: QUESTDB_ILP_URL,
        pgUrl: QUESTDB_PG_URL,
        flushMode: FLUSH_MODE
    };

    if ( FLUSH_MODE === 'auto' ) {
        storageOptions.autoFlushRows = AUTO_FLUSH_ROWS;
        storageOptions.autoFlushIntervalMs = 100;
    }

    const storage = await createQuestDBStorage(
        benchAssetClass,
        TABLE_PREFIX,
        storageOptions
    );
    console.log( '  Done.\n' );

    // ========================================================================
    // WARMUP PHASE
    // ========================================================================
    console.log( 'Warming up...' );
    for ( let i = 0; i < WARMUP_MESSAGES; i += 1 ) {
        fillMessage( i );
        storage.write( 'telemetry', msg, getPartitionId( i ) );
    }
    await storage.flush();
    console.log( '  Done.\n' );

    // Force GC if available
    if ( global.gc ) {
        global.gc();
    }

    // ========================================================================
    // MEASUREMENT PHASE
    // ========================================================================
    console.log( 'Running benchmark...' );

    const heapBefore = getHeapMB();
    const startTime = process.hrtime.bigint();

    // Write all messages
    for ( let i = 0; i < MESSAGE_COUNT; i += 1 ) {
        fillMessage( i );
        storage.write( 'telemetry', msg, getPartitionId( i ) );

        // Progress indicator
        if ( ( i + 1 ) % 10000 === 0 ) {
            process.stdout.write( `  ${( i + 1 ).toLocaleString()}/${MESSAGE_COUNT.toLocaleString()} messages\r` );
        }
    }

    const writeEndTime = process.hrtime.bigint();

    // Flush (for manual mode, measures network latency)
    const flushStartTime = process.hrtime.bigint();
    await storage.flush();
    const flushEndTime = process.hrtime.bigint();

    const heapAfter = getHeapMB();

    console.log( '\n' );

    // ========================================================================
    // RESULTS
    // ========================================================================
    const writeDurationNs = writeEndTime - startTime;
    const flushDurationNs = flushEndTime - flushStartTime;
    const totalDurationNs = flushEndTime - startTime;

    const writeDurationMs = Number( writeDurationNs ) / 1e6;
    const flushDurationMs = Number( flushDurationNs ) / 1e6;
    const totalDurationMs = Number( totalDurationNs ) / 1e6;

    const writePerSec = Math.round( MESSAGE_COUNT / ( writeDurationMs / 1000 ) );
    const totalPerSec = Math.round( MESSAGE_COUNT / ( totalDurationMs / 1000 ) );
    const nsPerWrite = Number( writeDurationNs ) / MESSAGE_COUNT;

    console.log( '========================================' );
    console.log( '  RESULTS' );
    console.log( '========================================\n' );

    console.log( 'Timing:' );
    console.log( `  Write time:      ${formatDuration( writeDurationNs )}` );
    console.log( `  Flush time:      ${formatDuration( flushDurationNs )}` );
    console.log( `  Total time:      ${formatDuration( totalDurationNs )}` );
    console.log( '' );

    console.log( 'Throughput:' );
    console.log( `  Write only:      ${writePerSec.toLocaleString()} msg/sec` );
    console.log( `  Including flush: ${totalPerSec.toLocaleString()} msg/sec` );
    console.log( '' );

    console.log( 'Latency:' );
    console.log( `  Per write:       ${nsPerWrite.toFixed( 0 )} ns/msg` );
    console.log( `  Per write:       ${( nsPerWrite / 1000 ).toFixed( 2 )} µs/msg` );
    console.log( '' );

    console.log( 'Memory:' );
    console.log( `  Heap before:     ${heapBefore} MB` );
    console.log( `  Heap after:      ${heapAfter} MB` );
    console.log( `  Delta:           ${( heapAfter - heapBefore ).toFixed( 2 )} MB` );
    console.log( '' );

    // ========================================================================
    // ASSESSMENT
    // ========================================================================
    console.log( 'Assessment:' );
    if ( writePerSec >= 1000000 ) {
        console.log( `  ✓ Excellent: ${( writePerSec / 1000000 ).toFixed( 2 )}M writes/sec` );
    } else if ( writePerSec >= 100000 ) {
        console.log( `  ✓ Good: ${( writePerSec / 1000 ).toFixed( 0 )}K writes/sec` );
    } else if ( writePerSec >= 10000 ) {
        console.log( `  ⚠ Acceptable: ${( writePerSec / 1000 ).toFixed( 0 )}K writes/sec` );
    } else {
        console.log( `  ❌ Slow: ${writePerSec.toLocaleString()} writes/sec` );
    }

    console.log( '\n========================================\n' );

    // Cleanup
    await storage.shutdown();
    await dropTestTable( TABLE_PREFIX );

    // Return results for programmatic use
    return {
        config: {
            messages: MESSAGE_COUNT,
            flushMode: FLUSH_MODE,
            autoFlushRows: AUTO_FLUSH_ROWS,
            partitions: PARTITION_COUNT
        },
        timing: {
            writeDurationMs,
            flushDurationMs,
            totalDurationMs
        },
        throughput: {
            writePerSec,
            totalPerSec,
            nsPerWrite
        },
        memory: {
            heapBefore,
            heapAfter,
            delta: heapAfter - heapBefore
        }
    };
};

// ============================================================================
// ENTRY POINT
// ============================================================================

runBenchmark()
    .then( ( results ) => {
        if ( results && process.env.JSON_OUTPUT ) { // eslint-disable-line no-process-env
            console.log( JSON.stringify( results, null, 2 ) );
        }
    } )
    .catch( ( err ) => {
        console.error( 'Benchmark failed:', err );
        throw err;
    } );

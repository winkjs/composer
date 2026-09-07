/**
 * @fileoverview QuestDB write benchmark.
 *
 * Measures the QuestDB storage adapter end to end: the cost of one
 * `write()` call on the hot path, and the rate at which rows are
 * accepted and land in QuestDB while composer runs every flush
 * (ADR-029). Each run selects the transport, so the client's two
 * transports can be compared on the same machine.
 *
 * The producer is a tight loop, so it follows the handbook's rule for
 * tight loops. Every thousand rows it reads the adapter's pressure.
 * When the buffer is nearly full it breathes, one event-loop turn at a
 * time, until the send in flight has landed. A loop that never breathes
 * would fill the buffer ceiling and have its rows refused with
 * `STORAGE_FULL`. The run reports every refusal and every row reported
 * lost, and reads the row count back over the PostgreSQL wire. So the
 * table also proves exact accounting: accepted equals landed.
 *
 * Requires a running QuestDB instance:
 *   docker compose up -d
 *
 * Usage:
 *   node benchmark/questdb-write.js [messages] [flushRows] [transport]
 *   node benchmark/questdb-write.js 100000
 *   node benchmark/questdb-write.js 1000000 50000 undici
 *
 * `messages` defaults to 100000, `flushRows` to the adapter's default
 * of 5000, and `transport` to `stdlib`. The other transport is
 * `undici`, the client's own default, selected with `stdlibHttp: false`.
 *
 * Metrics collected:
 * - Write time: the producer loop, breaths included
 * - Final flush time
 * - Messages accepted per second, and messages landed per second
 * - Nanoseconds per `write()` call
 * - Rows refused, rows reported lost, rows counted in the table
 * - Heap before and after
 */

import pg from 'pg';
import { createQuestDBStorage } from '../src/core/storage-manager/questdb/index.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const QUESTDB_ILP_URL = process.env.QUESTDB_ILP_URL || '127.0.0.1:9000'; // eslint-disable-line no-process-env
const QUESTDB_PG_URL = process.env.QUESTDB_PG_URL || '127.0.0.1:8812'; // eslint-disable-line no-process-env

const MESSAGE_COUNT = parseInt( process.argv[ 2 ], 10 ) || 100000;
const FLUSH_ROWS = parseInt( process.argv[ 3 ], 10 ) || 5000;
const TRANSPORT = process.argv[ 4 ] || 'stdlib';

const TABLE_PREFIX = `bench_${Date.now()}`;
const PARTITION_COUNT = 10;
const WARMUP_MESSAGES = 1000;

/** The producer reads the adapter's pressure this often. */
const PRESSURE_CHECK_EVERY = 1000;

/** The producer breathes while the buffer is this full or fuller. */
const PRESSURE_CEILING = 0.9;

/** How long to wait for the last rows to become visible over SQL. */
const LANDING_WAIT_MS = 10000;
const LANDING_POLL_MS = 100;

if ( ( TRANSPORT !== 'stdlib' ) && ( TRANSPORT !== 'undici' ) ) {
    console.error( `transport must be stdlib or undici, got: ${TRANSPORT}` );
    process.exit( 1 );
}

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
 * Opens one PostgreSQL client at the configured address.
 *
 * @param {number} [connectionTimeoutMillis] - Connect timeout, when a check must not hang
 * @returns {pg.Client} The client, not yet connected
 */
const pgClient = function ( connectionTimeoutMillis ) {
    const [ host, port ] = QUESTDB_PG_URL.split( ':' );
    return new pg.Client( {
        host,
        port: parseInt( port, 10 ),
        database: 'qdb',
        user: 'admin',
        password: process.env.QUESTDB_PASSWORD ?? 'quest', // eslint-disable-line no-process-env
        connectionTimeoutMillis
    } );
}; // pgClient()

/**
 * Check if QuestDB is available.
 *
 * @returns {Promise<boolean>} True if QuestDB is reachable
 */
const isQuestDBAvailable = async function () {
    const client = pgClient( 3000 );
    try {
        await client.connect();
        await client.query( 'SELECT 1' );
        await client.end();
        return true;
    } catch ( _err ) { // eslint-disable-line no-unused-vars
        return false;
    }
}; // isQuestDBAvailable()

/**
 * Counts the rows in the run's table.
 *
 * @param {string} prefix - Table prefix
 * @returns {Promise<number>} The row count, or -1 when the query failed
 */
const countRows = async function ( prefix ) {
    const client = pgClient();
    try {
        await client.connect();
        const result = await client.query( `SELECT count(*) AS n FROM ${prefix}_telemetry` );
        await client.end();
        return parseInt( result.rows[ 0 ].n, 10 );
    } catch ( _err ) { // eslint-disable-line no-unused-vars
        return -1;
    }
}; // countRows()

/**
 * Waits until the table holds the expected rows, or the wait runs out.
 * ILP rows become visible over SQL a moment after the send lands.
 *
 * @param {string} prefix - Table prefix
 * @param {number} expected - Rows accepted
 * @returns {Promise<number>} The last count seen
 */
const waitForLanding = async function ( prefix, expected ) {
    const deadline = Date.now() + LANDING_WAIT_MS;
    let landed = await countRows( prefix );
    while ( ( landed !== expected ) && ( Date.now() < deadline ) ) {
        await new Promise( ( resolve ) => setTimeout( resolve, LANDING_POLL_MS ) ); // eslint-disable-line no-await-in-loop
        landed = await countRows( prefix ); // eslint-disable-line no-await-in-loop
    }
    return landed;
}; // waitForLanding()

/**
 * Drop test table (cleanup).
 *
 * @param {string} prefix - Table prefix
 */
const dropTestTable = async function ( prefix ) {
    const client = pgClient();
    try {
        await client.connect();
        await client.query( `DROP TABLE IF EXISTS ${prefix}_telemetry` );
        await client.end();
    } catch ( _err ) { // eslint-disable-line no-unused-vars
        // Ignore cleanup errors
    }
}; // dropTestTable()

/**
 * Captures heap memory usage.
 *
 * @returns {number} Heap used in MB
 */
const getHeapMB = function () {
    const mem = process.memoryUsage();
    return Math.round( ( mem.heapUsed / 1024 / 1024 ) * 100 ) / 100;
}; // getHeapMB()

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
}; // formatDuration()

/**
 * One event-loop turn, so the send in flight can land.
 *
 * @returns {Promise<void>}
 */
const breathe = function () {
    return new Promise( ( resolve ) => setImmediate( resolve ) );
}; // breathe()

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
}; // fillMessage()

/**
 * Get partition ID for message (round-robin).
 *
 * @param {number} index - Message index
 * @returns {string} Partition ID
 */
const getPartitionId = function ( index ) {
    return `sensor-${String( index % PARTITION_COUNT ).padStart( 3, '0' )}`;
}; // getPartitionId()

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
        console.log( 'FAIL: QuestDB not available' );
        console.log( '   Run: docker compose up -d' );
        console.log( '' );
        return null;
    }

    console.log( 'Configuration:' );
    console.log( `  Messages:        ${MESSAGE_COUNT.toLocaleString()}` );
    console.log( `  Flush rows:      ${FLUSH_ROWS.toLocaleString()} (ceiling ${( FLUSH_ROWS * 10 ).toLocaleString()})` );
    console.log( `  Transport:       ${TRANSPORT}` );
    console.log( `  Partitions:      ${PARTITION_COUNT}` );
    console.log( `  Warmup:          ${WARMUP_MESSAGES.toLocaleString()} messages` );
    console.log( `  Table:           ${TABLE_PREFIX}_telemetry` );
    console.log( '' );

    // Create storage. Every loss is counted, so the table can say so.
    let rowsLost = 0;
    console.log( 'Initializing storage...' );
    const storage = await createQuestDBStorage( benchAssetClass, TABLE_PREFIX, {
        ilpUrl: QUESTDB_ILP_URL,
        pgUrl: QUESTDB_PG_URL,
        flushRows: FLUSH_ROWS,
        stdlibHttp: TRANSPORT === 'stdlib',
        onDeliveryFailure: function ( err, info ) {
            rowsLost += info.rowsLost;
            console.log( `  delivery failure: ${err.message}` );
        }
    } );
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

    let accepted = 0;
    let refused = 0;
    let breaths = 0;
    const heapBefore = getHeapMB();
    const startTime = process.hrtime.bigint();

    for ( let i = 0; i < MESSAGE_COUNT; i += 1 ) {
        fillMessage( i );
        if ( storage.write( 'telemetry', msg, getPartitionId( i ) ).ok ) {
            accepted += 1;
        } else {
            refused += 1;
        }

        if ( ( i % PRESSURE_CHECK_EVERY ) === 0 ) {
            while ( storage.getPressure() >= PRESSURE_CEILING ) {
                await breathe(); // eslint-disable-line no-await-in-loop
                breaths += 1;
            }
        }

        // Progress indicator
        if ( ( i + 1 ) % 100000 === 0 ) {
            process.stdout.write( `  ${( i + 1 ).toLocaleString()}/${MESSAGE_COUNT.toLocaleString()} messages\r` );
        }
    }

    const writeEndTime = process.hrtime.bigint();

    // The final flush carries whatever is still buffered.
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
    const landedPerSec = Math.round( accepted / ( totalDurationMs / 1000 ) );
    const nsPerWrite = Number( writeDurationNs ) / MESSAGE_COUNT;

    await storage.shutdown();
    const expectedRows = WARMUP_MESSAGES + accepted;
    const landed = await waitForLanding( TABLE_PREFIX, expectedRows );

    console.log( '========================================' );
    console.log( '  RESULTS' );
    console.log( '========================================\n' );

    console.log( 'Timing:' );
    console.log( `  Write time:      ${formatDuration( writeDurationNs )} (${breaths.toLocaleString()} breaths)` );
    console.log( `  Final flush:     ${formatDuration( flushDurationNs )}` );
    console.log( `  Total time:      ${formatDuration( totalDurationNs )}` );
    console.log( '' );

    console.log( 'Throughput:' );
    console.log( `  Write loop:      ${writePerSec.toLocaleString()} msg/sec` );
    console.log( `  Landed:          ${landedPerSec.toLocaleString()} msg/sec` );
    console.log( '' );

    console.log( 'Latency:' );
    console.log( `  Per write:       ${nsPerWrite.toFixed( 0 )} ns/msg` );
    console.log( `  Per write:       ${( nsPerWrite / 1000 ).toFixed( 2 )} µs/msg` );
    console.log( '' );

    console.log( 'Accounting:' );
    console.log( `  Accepted:        ${accepted.toLocaleString()}` );
    console.log( `  Refused:         ${refused.toLocaleString()}` );
    console.log( `  Reported lost:   ${rowsLost.toLocaleString()}` );
    console.log( `  In the table:    ${landed.toLocaleString()} (warmup included, expected ${expectedRows.toLocaleString()})` );
    console.log( '' );

    console.log( 'Memory:' );
    console.log( `  Heap before:     ${heapBefore} MB` );
    console.log( `  Heap after:      ${heapAfter} MB` );
    console.log( `  Delta:           ${( heapAfter - heapBefore ).toFixed( 2 )} MB` );
    console.log( '' );

    // ========================================================================
    // ASSESSMENT
    // ========================================================================
    const exact = ( refused === 0 ) && ( rowsLost === 0 ) && ( landed === expectedRows );
    console.log( 'Assessment:' );
    console.log( `  Accounting:      ${exact ? 'EXACT' : 'MISMATCH'}` );
    if ( landedPerSec >= 100000 ) {
        console.log( `  Rate:            GOOD, ${( landedPerSec / 1000 ).toFixed( 0 )}K landed/sec` );
    } else if ( landedPerSec >= 10000 ) {
        console.log( `  Rate:            ACCEPTABLE, ${( landedPerSec / 1000 ).toFixed( 0 )}K landed/sec` );
    } else {
        console.log( `  Rate:            SLOW, ${landedPerSec.toLocaleString()} landed/sec` );
    }

    console.log( '\n========================================\n' );

    await dropTestTable( TABLE_PREFIX );

    // Return results for programmatic use
    return {
        config: {
            messages: MESSAGE_COUNT,
            flushRows: FLUSH_ROWS,
            transport: TRANSPORT,
            partitions: PARTITION_COUNT
        },
        timing: {
            writeDurationMs,
            flushDurationMs,
            totalDurationMs,
            breaths
        },
        throughput: {
            writePerSec,
            landedPerSec,
            nsPerWrite
        },
        accounting: {
            accepted,
            refused,
            rowsLost,
            landed,
            expectedRows,
            exact
        },
        memory: {
            heapBefore,
            heapAfter,
            delta: heapAfter - heapBefore
        }
    };
}; // runBenchmark()

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

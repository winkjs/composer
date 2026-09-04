// core/storage-manager/questdb/test/slow-soak-questdb.specs.js

/* eslint-disable no-process-env, no-await-in-loop, no-invalid-this, no-continue */

/**
 * @fileoverview Soak test for the QuestDB storage adapter.
 *
 * A soak test runs a component at a steady, realistic load for a
 * stretch of wall-clock time. The burst tests in
 * `slow-questdb-throughput.specs.js` push the adapter flat-out for a
 * few seconds. They cannot see what only time reveals: a flush timer
 * that stops firing, a buffer that never empties, memory that creeps
 * up, or a row count that drifts away from what was written. This
 * soak runs the adapter for a configurable number of minutes against
 * a live QuestDB and asserts that none of those appear.
 *
 * It also exercises ADR-030 live. The adapter is built with no
 * injected dependencies, so the real setup probe opens a socket to
 * each endpoint before any client is built.
 *
 * --------------------------------------------------------------------
 * HOW TO RUN
 * --------------------------------------------------------------------
 *
 *   1. Start QuestDB from the repo's `docker-compose.yml`:
 *
 *        docker compose up -d
 *
 *   2. Run the hardening tier with `SOAK_MINUTES` set:
 *
 *        SOAK_MINUTES=2.5 npm run test:hardening
 *
 *      Without `SOAK_MINUTES` (or with `SOAK_MINUTES=0`) this test
 *      skips, so the regular hardening tier does not pay the cost.
 *      The same variable drives the MQTT emitter soak, so both run.
 *
 *      No programmatic GC. The soak observes what production sees
 *      across natural garbage-collection cycles. A forced collection
 *      would hide the memory dynamics that surface slow drift.
 *
 * --------------------------------------------------------------------
 * ENV VARS
 * --------------------------------------------------------------------
 *
 *   SOAK_MINUTES      required. Decimal is fine (`0.5` runs 30 s).
 *   QUESTDB_ILP_URL   defaults to `127.0.0.1:9000`.
 *   QUESTDB_PG_URL    defaults to `127.0.0.1:8812`.
 *   QUESTDB_PASSWORD  defaults to `quest` (the compose default).
 *
 * --------------------------------------------------------------------
 * TUNING CONSTANTS (edit in this file)
 * --------------------------------------------------------------------
 *
 *   PRODUCER_BATCH      50   — writes per loop iteration.
 *   PRODUCER_PACE_MS    10   — sleep between batches. With the batch
 *                        above the target rate is ~5 k msg/s: a
 *                        sustained edge rate, well inside the
 *                        client's send-buffer ceiling.
 *   PRESSURE_CEILING    1.0  — the producer pauses while
 *                        `getPressure()` reads the contract ceiling:
 *                        the buffer is at its flush boundary and the
 *                        flush is in flight. Below that, time paces
 *                        the producer. Do not lower this while the
 *                        client owns the flush: its interval trigger
 *                        is checked only on a row append, so a paused
 *                        producer stalls every flush until the idle
 *                        timer runs (the smoke run of 2026-09-04 saw
 *                        one tenth of the target rate at 0.5).
 *   AUTO_FLUSH_ROWS     5000 — the row boundary. At the target rate
 *                        it is crossed about once a second.
 *   AUTO_FLUSH_MS       1000 — the time boundary. Both flush
 *                        triggers fire many times even in a short run.
 *   SAMPLE_INTERVAL_MS  10 000 — one sample every ten seconds, so a
 *                        two-minute run still has enough samples for
 *                        the trend checks.
 *
 * --------------------------------------------------------------------
 * WHAT TO OBSERVE
 * --------------------------------------------------------------------
 *
 *   Per-sample log line:
 *
 *     [qdb-soak] sample N: written=W landed=L writeRate=R/s
 *                landRate=R/s pressure=P health=green heap=H MB rss=R MB
 *
 *   Healthy patterns: writeRate and landRate stay close and stable,
 *   pressure reads somewhere between 0 and 1 as each flush cycle
 *   fills and empties the buffer, health reads green or yellow and
 *   never red, and heap and rss move around a stable centre. Yellow
 *   is expected here: the adapter reports yellow above 0.66 pressure,
 *   and the producer fills the buffer to the flush boundary.
 *
 * --------------------------------------------------------------------
 * WHAT FAILURES MEAN
 * --------------------------------------------------------------------
 *
 *   rows landed < rows accepted  — loss. A clean shutdown promises
 *                                  that every buffered row was flushed
 *                                  and confirmed (ADR-018 §1.6). Read
 *                                  the delivery failures and the
 *                                  shutdown error first.
 *   delivery failures > 0        — a flush failed. Read `err.code`
 *                                  and `err.cause`.
 *   a red health sample, or any  — the sink lost its connection, or a
 *   write error on a sample        write failed. Either means the
 *                                  sink stopped keeping up.
 *   memory trend rising          — a leak. Both `heapUsed` and `rss`
 *                                  are checked: the client's send
 *                                  buffer lives in native memory that
 *                                  `heapUsed` never sees.
 *   late landRate < 50% of early — degradation. Check QuestDB's own
 *                                  logs (`docker logs questdb`).
 *
 * --------------------------------------------------------------------
 * SCOPE
 * --------------------------------------------------------------------
 *
 *   Two to three minutes is the smoke tier. A stuck flush path and a
 *   fast leak surface here. Slow drift needs the multi-hour rig soak,
 *   which runs outside this repo's test suite.
 */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach } from 'mocha';
import pg from 'pg';

import { createQuestDBStorage } from '../index.js';

const QUESTDB_ILP_URL = process.env.QUESTDB_ILP_URL || '127.0.0.1:9000';
const QUESTDB_PG_URL  = process.env.QUESTDB_PG_URL  || '127.0.0.1:8812';
const SOAK_MINUTES    = parseFloat( process.env.SOAK_MINUTES || '0' );

const SOAK_MS            = SOAK_MINUTES * 60_000;
const SAMPLE_INTERVAL_MS = 10_000;
const PRESSURE_CEILING   = 1.0;
const PRODUCER_BATCH     = 50;
const PRODUCER_PACE_MS   = 10;
const AUTO_FLUSH_ROWS    = 5000;
const AUTO_FLUSH_MS      = 1000;

// Mid-run memory tripwire. The end-of-run trend checks can never fire
// if runaway growth kills the process first, so the sampler stops the
// producer while the process is still alive and the run fails with
// its telemetry intact. (The emitter soak records the incident.)
const HEAP_TRIPWIRE_BYTES = 1_500 * 1024 * 1024;
const RSS_TRIPWIRE_BYTES  = 3_000 * 1024 * 1024;

const assetClass = {
    name: 'soakTest',
    columns: {
        _harnessId: { type: 'int64' },
        ts: { type: 'timestamp' },
        value: { type: 'float64', resolution: 0.01 }
    },
    insightTypes: {
        samples: {
            columns: [ '_harnessId', 'ts', 'value' ],
            designatedTimestamp: 'ts'
        }
    }
};

// ============================================================================
// HELPERS (shared shape with the rest of the QuestDB slow tier)
// ============================================================================

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

const createPgClient = async function () {
    const [ host, port ] = QUESTDB_PG_URL.split( ':' );
    const client = new pg.Client( {
        host,
        port: parseInt( port, 10 ),
        database: 'qdb',
        user: 'admin',
        password: process.env.QUESTDB_PASSWORD ?? 'quest'
    } );
    await client.connect();
    return client;
};

const dropTable = async function ( client, tableName ) {
    try {
        await client.query( `DROP TABLE IF EXISTS ${tableName}` );
    } catch ( _err ) { // eslint-disable-line no-unused-vars
        /* best-effort */
    }
};

const countRows = async function ( client, tableName ) {
    try {
        const result = await client.query( `SELECT count() FROM ${tableName}` );
        return parseInt( result.rows[ 0 ][ 'count()' ], 10 );
    } catch ( _err ) { // eslint-disable-line no-unused-vars
        return 0;
    }
};

const waitForRows = async function ( client, tableName, expected, maxMs ) {
    const start = Date.now();
    let last = 0;
    while ( ( Date.now() - start ) < maxMs ) {
        last = await countRows( client, tableName );
        if ( last >= expected ) return last;
        await new Promise( ( r ) => setTimeout( r, 200 ) );
    }
    return last;
};

const sleep = function ( ms ) {
    return new Promise( function ( resolve ) {
        setTimeout( resolve, ms );
    } );
};

const formatHeap = function ( bytes ) {
    return `${( bytes / 1024 / 1024 ).toFixed( 1 )} MB`;
};

const median = function ( arr ) {
    const sorted = [ ...arr ].sort( ( a, b ) => a - b );
    const mid = Math.floor( sorted.length / 2 );
    return ( sorted.length % 2 === 1 ) ? sorted[ mid ] : ( ( sorted[ mid - 1 ] + sorted[ mid ] ) / 2 );
};

/**
 * Trend assertions over the samples: memory and landed-row rate.
 *
 * Memory compares early-third against late-third MEDIANS. Under
 * natural GC the raw heap moves between collections, so a min/max
 * range is noisy; the median smooths that and shows the trend. Up to
 * 2x growth is allowed (warm-up settling into steady state). Both
 * `heapUsed` and `rss` are checked, because the client's send buffer
 * is native memory.
 *
 * Rate: the late-third median landed-row rate must stay within 50% of
 * the early third, so a sink that slows down over time is caught.
 *
 * Skips when fewer than 3 samples exist (a sub-30-second smoke).
 *
 * @param {Object[]} samples - The sampler's records
 */
const assertStableTrends = function ( samples ) {
    if ( samples.length < 3 ) {
        return;
    }
    const third = Math.floor( samples.length / 3 );
    const earlyHeap = median( samples.slice( 0, third ).map( ( s ) => s.heap ) );
    const lateHeap  = median( samples.slice( -third ).map( ( s ) => s.heap ) );
    const earlyRss  = median( samples.slice( 0, third ).map( ( s ) => s.rss ) );
    const lateRss   = median( samples.slice( -third ).map( ( s ) => s.rss ) );
    const earlyRate = median( samples.slice( 0, third ).map( ( s ) => s.landRate ) );
    const lateRate  = median( samples.slice( -third ).map( ( s ) => s.landRate ) );
    console.log( `    early/late median heap:  ${formatHeap( earlyHeap )} / ${formatHeap( lateHeap )}` );
    console.log( `    early/late median rss:   ${formatHeap( earlyRss )} / ${formatHeap( lateRss )}` );
    console.log( `    early/late median rate:  ${earlyRate.toFixed( 0 )} / ${lateRate.toFixed( 0 )} rows/s` );
    expect( lateHeap, 'late-median heap within 2x early-median (no progressive leak)' )
        .to.be.lessThan( earlyHeap * 2 );
    expect( lateRss, 'late-median rss within 2x early-median (no native-memory leak)' )
        .to.be.lessThan( earlyRss * 2 );
    expect( lateRate, 'late landed rate within 50% of early (no degradation)' )
        .to.be.greaterThan( earlyRate * 0.5 );
}; // assertStableTrends()

// ============================================================================
// TEST
// ============================================================================

describe( 'QuestDB Soak — sustained run', function () {

    // Time budget: the soak itself plus five minutes for setup, drain,
    // the final count, and assertions.
    this.timeout( ( SOAK_MINUTES + 5 ) * 60_000 );

    if ( SOAK_MINUTES <= 0 ) {
        it( 'soak test skipped (set SOAK_MINUTES env var to run)', function () {
            this.skip();
        } );
        return;
    }

    let qdbUp = false;
    let pgClient = null;
    const tablesToCleanUp = [];

    before( async function () {
        qdbUp = await isQuestDBAvailable();
        if ( !qdbUp ) {
            console.log( '  [SKIP] QuestDB not available — start with `docker compose up -d`' );
            return;
        }
        pgClient = await createPgClient();
    } );

    after( async function () {
        if ( pgClient ) {
            for ( const t of tablesToCleanUp ) {
                await dropTable( pgClient, t );
            }
            await pgClient.end();
        }
    } );

    beforeEach( function () {
        if ( !qdbUp ) this.skip();
    } );

    it( `runs ${SOAK_MINUTES} min at ~${Math.floor( ( PRODUCER_BATCH * 1000 ) / PRODUCER_PACE_MS )} msg/s with zero loss, no red health, and bounded memory`, async function () {
        const tablePrefix = `soak_${Date.now()}`;
        const tableName = `${tablePrefix}_samples`;
        tablesToCleanUp.push( tableName );

        const warnings = [];
        const deliveryFailures = [];

        // No injected dependencies: the real setup probe (ADR-030),
        // the real clients, the real flush timers.
        const storage = await createQuestDBStorage( assetClass, tablePrefix, {
            ilpUrl: QUESTDB_ILP_URL,
            pgUrl: QUESTDB_PG_URL,
            flushMode: 'auto',
            autoFlushRows: AUTO_FLUSH_ROWS,
            autoFlushIntervalMs: AUTO_FLUSH_MS,
            onWarning: function ( msg ) {
                warnings.push( msg );
            },
            onDeliveryFailure: function ( err, ctx ) {
                deliveryFailures.push( { code: err.code, message: err.message, table: ctx && ctx.tableName } );
            }
        } );

        // One mutable record shared by the producer, the sampler, and
        // the final assertions.
        const stats = { written: 0, rejected: 0, stopProducer: false };

        // Producer: batches of writes, paced by time, and paused only
        // while the adapter's pressure reads the ceiling (buffer at
        // its flush boundary, flush in flight). See PRESSURE_CEILING
        // in the header for why the pause is not lower.
        const producerLoop = async function () {
            while ( !stats.stopProducer ) {
                if ( storage.getPressure() >= PRESSURE_CEILING ) {
                    await sleep( 10 );
                    continue;
                }
                for ( let i = 0; i < PRODUCER_BATCH; i += 1 ) {
                    const msg = { _harnessId: stats.written + i, ts: Date.now(), value: ( i % 100 ) + 0.25 };
                    const result = storage.write( 'samples', msg, 'soakTest' );
                    if ( !result.ok ) {
                        stats.rejected += 1;
                    }
                }
                stats.written += PRODUCER_BATCH;
                await sleep( PRODUCER_PACE_MS );
            }
        }; // producerLoop()

        // Sampler: every SAMPLE_INTERVAL_MS, memory, the rows landed
        // so far (one count query), and the adapter's own health.
        const samples = [];
        let lastWritten = 0;
        let lastLanded = 0;
        let sampleIndex = 0;
        let memoryTripwire = null;

        const samplerLoop = async function () {
            while ( !stats.stopProducer ) {
                await sleep( SAMPLE_INTERVAL_MS );
                if ( stats.stopProducer ) break;
                sampleIndex += 1;
                const mem = process.memoryUsage();
                const landed = await countRows( pgClient, tableName );
                const health = storage.getHealth();
                const seconds = SAMPLE_INTERVAL_MS / 1000;
                const writeRate = ( stats.written - lastWritten ) / seconds;
                const landRate = ( landed - lastLanded ) / seconds;
                lastWritten = stats.written;
                lastLanded = landed;
                samples.push( {
                    heap: mem.heapUsed,
                    rss: mem.rss,
                    writeRate,
                    landRate,
                    pressure: health.pressure,
                    status: health.status,
                    writeErrors: health.consecutiveWriteErrors
                } );
                console.log(
                    `  [qdb-soak] sample ${sampleIndex}: written=${stats.written} landed=${landed} ` +
                    `writeRate=${writeRate.toFixed( 0 )}/s landRate=${landRate.toFixed( 0 )}/s ` +
                    `pressure=${health.pressure.toFixed( 2 )} health=${health.status} ` +
                    `heap=${formatHeap( mem.heapUsed )} rss=${formatHeap( mem.rss )} ` +
                    `rejected=${stats.rejected} failures=${deliveryFailures.length}`
                );
                if ( ( mem.heapUsed > HEAP_TRIPWIRE_BYTES ) || ( mem.rss > RSS_TRIPWIRE_BYTES ) ) {
                    memoryTripwire = `sample ${sampleIndex}: heap ${formatHeap( mem.heapUsed )} / rss ${formatHeap( mem.rss )} ` +
                        `crossed the tripwire (${formatHeap( HEAP_TRIPWIRE_BYTES )} heap / ${formatHeap( RSS_TRIPWIRE_BYTES )} rss)`;
                    console.log( `  [qdb-soak] MEMORY TRIPWIRE — ${memoryTripwire}; stopping producer` );
                    stats.stopProducer = true;
                }
            }
        }; // samplerLoop()

        const startedAt = Date.now();
        const producerPromise = producerLoop();
        const samplerPromise  = samplerLoop();
        await sleep( SOAK_MS );
        stats.stopProducer = true;
        await producerPromise;
        await samplerPromise;
        const producingMs = Date.now() - startedAt;

        // Drain: shutdown is drain-then-close. A throw is captured, not
        // rethrown, so the summary and the row count always print.
        const tShutdown = Date.now();
        let shutdownError = null;
        try {
            await storage.shutdown( { timeout: 60_000 } );
        } catch ( err ) {
            shutdownError = err;
            console.log( `  [qdb-soak] lossy shutdown: ${err.message}` );
        }
        const drainMs = Date.now() - tShutdown;

        // QuestDB commits ILP batches asynchronously: poll for the
        // accepted count, bounded.
        const accepted = stats.written - stats.rejected;
        const finalCount = await waitForRows( pgClient, tableName, accepted, 60_000 );
        const finalHeap = process.memoryUsage().heapUsed;
        const unhealthy = samples.filter( ( s ) => ( s.status === 'red' ) || ( s.writeErrors > 0 ) );

        console.log( '\n  [qdb-soak] final summary:' );
        console.log( `    soak duration:       ${SOAK_MINUTES} min (${producingMs} ms producing)` );
        console.log( `    written:             ${stats.written}` );
        console.log( `    rejected by write(): ${stats.rejected}` );
        console.log( `    accepted:            ${accepted}` );
        console.log( `    rows in QuestDB:     ${finalCount}` );
        console.log( `    rows missing:        ${accepted - finalCount}` );
        console.log( `    overall write rate:  ${( ( stats.written / producingMs ) * 1000 ).toFixed( 0 )} msg/s` );
        console.log( `    drain time:          ${drainMs} ms` );
        console.log( `    samples:             ${samples.length} (red or with write errors: ${unhealthy.length})` );
        console.log( `    final heap:          ${formatHeap( finalHeap )}` );
        console.log( `    soft warnings:       ${warnings.length}` );
        console.log( `    delivery failures:   ${deliveryFailures.length}` );
        console.log( `    shutdown:            ${shutdownError ? `THREW [${shutdownError.code}]` : 'clean resolve'}` );

        // Hard assertions, loudest first.
        // 0. Memory stayed bounded for the whole run.
        expect( memoryTripwire, `memory tripwire fired: ${memoryTripwire}` ).to.equal( null );
        // 1. Shutdown kept the delivery invariant: no throw.
        expect( shutdownError, 'shutdown resolved cleanly' ).to.equal( null );
        // 2. No flush failed, and no row was refused at a load the
        //    producer paused at the pressure ceiling.
        expect( deliveryFailures, 'no delivery failures' ).to.deep.equal( [] );
        expect( stats.rejected, 'no write() refusals' ).to.equal( 0 );
        expect( warnings, 'no soft warnings on clean data' ).to.deep.equal( [] );
        // 3. Every accepted row landed. The count is the truth the
        //    delivery invariant is measured against.
        expect( finalCount, 'every accepted row landed' ).to.equal( accepted );
        // 4. Health never read red and no sample carried a write error.
        //    A sustained state, so a sampled observation may assert it.
        //    Yellow is not asserted against: pressure passes 0.66 on
        //    its way to the flush boundary in every cycle.
        expect( unhealthy, 'no red health sample and no write errors' ).to.deep.equal( [] );
        // 5. Memory and landed-rate trends held across the run.
        assertStableTrends( samples );
    } );

} );

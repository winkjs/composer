// core/storage-manager/questdb/test/slow-questdb-throughput.specs.js

/* eslint-disable no-process-env, no-await-in-loop, no-invalid-this */

/**
 * @fileoverview Sustained-throughput and pressure-response tests for
 * QuestDB, driven by testHarness.
 *
 * Slow tier — runs only via `npm run test:hardening`; the regular
 * `npm test` ignores `slow-*.specs.js` so daily flow is fast.
 *
 * Two concerns:
 *
 *   1. **Sustained throughput** — drive the harness flat-out for a
 *      meaningful run (~60 s on commodity hardware), assert no row
 *      loss, log the observed msg/s and heap delta. The hard
 *      assertion is "every harness id present in QDB" — the
 *      throughput number itself is logged for documentation, not
 *      asserted as a tight bound (CI machines vary). A conservative
 *      absolute floor (1 000 msg/s) catches catastrophic regressions
 *      without flaking on slower hardware.
 *
 *   2. **Pressure response** — sample `getPressure()` while the
 *      harness drives load; assert the counter rises (proving the
 *      buffer fills under load), never exceeds 1.0 (the contract
 *      bound), and resets at least once (proving auto-flush at the
 *      `autoFlushRows` boundary cleared the counter).
 *
 * Requires QuestDB and Mosquitto running via the repo's
 * `docker-compose.yml`. Tests skip cleanly if QuestDB is not
 * reachable.
 */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach } from 'mocha';
import pg from 'pg';

import { flow } from '../../../../composer.js';
import * as testHarness from '../../../source-manager/test-harness/index.js';
import { storages as wireStorages } from '../../../wiring/index.js';
import questdbAdapter from '../index.js';

const QUESTDB_ILP_URL = process.env.QUESTDB_ILP_URL || 'localhost:9000';
const QUESTDB_PG_URL  = process.env.QUESTDB_PG_URL  || 'localhost:8812';
const RUN_PREFIX      = `tput_${Date.now()}`;

const assetClass = {
    name: 'tputTest',
    columns: {
        _harnessId: { type: 'int64' },
        partitionId: { type: 'string' },
        ts: { type: 'timestamp' },
        value: { type: 'float64', resolution: 0.01 }
    },
    insightTypes: {
        samples: {
            columns: [ '_harnessId', 'partitionId', 'ts', 'value' ],
            designatedTimestamp: 'ts'
        }
    }
};

const buildMessageTemplate = function ( messageCount, intervalMs = 0 ) {
    return {
        seed: 1,
        messageCount,
        intervalMs,
        fields: {
            partitionId: { type: 'string', values: [ 'tputTest' ] },
            ts: { type: 'timestamp', mode: 'monotonic-ms', seedValue: Date.now() },
            value: { type: 'float64', range: [ 0, 100 ], resolution: 0.01 }
        }
    };
};

// ============================================================================
// SHARED HELPERS (mirror the fast e2e suite)
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

const waitForRows = async function ( client, tableName, expected, maxMs = 30000 ) {
    const start = Date.now();
    let last = 0;
    while ( ( Date.now() - start ) < maxMs ) {
        last = await countRows( client, tableName );
        if ( last >= expected ) return last;
        await new Promise( ( r ) => setTimeout( r, 200 ) );
    }
    return last;
};

const formatHeap = function ( bytes ) {
    return `${( bytes / 1024 / 1024 ).toFixed( 1 )} MB`;
};

// ============================================================================
// TESTS
// ============================================================================

describe( 'QuestDB Hardening — sustained throughput and pressure response', function () {

    // Big budget — these hardening tests deliberately run long.
    this.timeout( 180000 );

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

    // --------------------------------------------------------------------
    // Test 1 — Sustained throughput with no row loss
    // --------------------------------------------------------------------

    it( 'sustains a flat-out run without losing rows', async function () {
        // Failure mode (found during hardening): at unpaced
        // production rates that exceed QDB's ingest rate, the
        // @questdb/nodejs-client send buffer (default
        // `max_buf_size = 100 MiB`) fills up. Once full, HTTP
        // flushes start timing out at `request_timeout` (~10 s)
        // and the rows in those failed flushes get dropped. With
        // our row shape (~78 bytes/row on the wire) the buffer
        // caps at ~1.28 M rows. The "ceiling" is therefore
        // time-bounded, not count-bounded.
        //
        // Per the no-silent-failures contract, the QDB
        // adapter now throws `DELIVERY_FAILED` from inside the
        // sender.at() catch handler when no `onDeliveryFailure`
        // callback is provided. Tests provide an explicit callback
        // so we can capture failures into a list. The assertions:
        // zero failures captured AND every row landed.
        //
        // 500 000 messages keeps us well below the buffer ceiling
        // on commodity hardware while still exercising the
        // pipeline meaningfully (~1.7 s of unpaced production at
        // observed ~287 k msg/s, ~100 auto-flush boundaries crossed).
        const messageCount = 500000;
        const tablePrefix = `${RUN_PREFIX}_run`;
        const tableName = `${tablePrefix}_samples`;
        tablesToCleanUp.push( tableName );

        // Force a GC cycle before the run so heap-delta numbers are
        // less noisy. Available when node is started with --expose-gc;
        // a no-op otherwise.
        if ( typeof global.gc === 'function' ) global.gc();
        const memBefore = process.memoryUsage();

        // Capture both kinds of failures explicitly:
        //   - warnings: per-row data-quality issues (we expect zero
        //     since the harness produces clean data).
        //   - deliveryFailures: batch-level drops from sender.at()
        //     async flush rejection. Without an explicit callback
        //     the QDB adapter throws — but the throw happens inside
        //     a Promise .catch() and surfaces as an unhandled
        //     rejection that could kill the test runner. Capturing
        //     into a list lets the test fail cleanly with details
        //     when the failure mode triggers.
        const warnings = [];
        const deliveryFailures = [];

        const t0 = Date.now();
        const handle = await flow( 'tputRun' )
            .source( testHarness, {
                messageTemplate: buildMessageTemplate( messageCount ),
                assetClass,
                shutdownOnComplete: false
            } )
            .assetClass( assetClass )
            .storage( questdbAdapter, {
                ilpUrl: QUESTDB_ILP_URL,
                pgUrl: QUESTDB_PG_URL,
                tablePrefix,
                flushMode: 'auto',
                autoFlushRows: 5000,
                autoFlushIntervalMs: 600000,
                onWarning: function ( msg ) {
                    warnings.push( msg );
                },
                onDeliveryFailure: function ( err, ctx ) {
                    deliveryFailures.push( {
                        message: err && err.message,
                        table: ctx && ctx.tableName
                    } );
                }
            } )
            .assetId( 'partitionId' )
            .persistIf( 'persist', ( _msg ) => true,
                { storageName: 'questdb', insightType: 'samples' } )
            .run();

        await handle.whenComplete();
        const generationMs = Date.now() - t0;
        await handle.shutdown();

        // Drain budget — at the zero-loss ceiling (1M messages),
        // QDB usually has all rows visible within a couple of
        // seconds of shutdown returning.
        const finalCount = await waitForRows( pgClient, tableName, messageCount, 30000 );

        if ( typeof global.gc === 'function' ) global.gc();
        const memAfter = process.memoryUsage();
        const observedRate = ( messageCount / generationMs ) * 1000;
        const heapDelta = memAfter.heapUsed - memBefore.heapUsed;

        console.log( '\n  [throughput] run summary:' );
        console.log( `    messages produced:  ${messageCount}` );
        console.log( `    rows in QDB:        ${finalCount}` );
        console.log( `    rows missing:       ${messageCount - finalCount}` );
        console.log( `    generation time:    ${generationMs} ms` );
        console.log( `    observed rate:      ${observedRate.toFixed( 0 )} msg/s` );
        console.log( `    heap before/after:  ${formatHeap( memBefore.heapUsed )} / ${formatHeap( memAfter.heapUsed )} (Δ ${formatHeap( heapDelta )})` );
        console.log( `    soft warnings:      ${warnings.length}` );
        console.log( `    delivery failures:  ${deliveryFailures.length}` );
        if ( deliveryFailures.length > 0 ) {
            console.log( '    first 3 delivery failures:' );
            for ( const f of deliveryFailures.slice( 0, 3 ) ) {
                console.log( `      - ${f.message} (table: ${f.table})` );
            }
        }

        // Hard assertions — the no-silent-failures contract:
        // 1. Zero delivery failures. Any captured failure means the
        //    QDB sender dropped a batch under the buffer/timeout
        //    failure mode. The test (and any production caller) MUST
        //    see this.
        expect( deliveryFailures, 'no delivery failures allowed' ).to.deep.equal( [] );

        // 2. Every message landed (no row loss). Redundant with #1
        //    today, but kept as a defence-in-depth: if a future code
        //    path lost rows by some channel that doesn't go through
        //    the delivery-failure callback, this catches it.
        expect( finalCount ).to.equal( messageCount );

        // 3. Conservative throughput floor — catches catastrophic
        //    regressions without flaking on slower hardware.
        expect( observedRate, 'observed rate floor' ).to.be.greaterThan( 1000 );

        // 4. Heap growth bounded. 500k messages with ~5k autoFlush
        //    rows means at most ~5k rows × ~200 B/row ≈ 1 MB in
        //    flight at any time. We allow 100 MB for jit profiles,
        //    buffers, etc. Anything beyond that suggests a leak.
        expect( heapDelta / 1024 / 1024 ).to.be.lessThan( 100 );
    } );

    // --------------------------------------------------------------------
    // Test 2 — Pressure response under load
    // --------------------------------------------------------------------

    it( 'pressure rises under load, never exceeds 1.0, and resets after auto-flush', async function () {
        // The unpaced (intervalMs = 0) harness completes its run
        // entirely in microtasks — so a `setInterval`-based sampler
        // (a macrotask) never gets a chance to fire, leaving zero
        // samples. We deliberately pace the harness here so each
        // message hop yields to the event loop, giving the sampler
        // real opportunities to read the pressure mid-flight.
        // 1 ms ask is clamped to ~4 ms by Node's timer floor; with
        // 2 000 messages that's an ~8 s run, plenty of sampling
        // headroom and far below the 180 s test budget.
        const autoFlushRows = 100;
        const messageCount = 2000;     // 20 boundaries crossed
        const intervalMs = 1;
        const tablePrefix = `${RUN_PREFIX}_pressure`;
        const tableName = `${tablePrefix}_samples`;
        tablesToCleanUp.push( tableName );

        const handle = await flow( 'pressureRun' )
            .source( testHarness, {
                messageTemplate: buildMessageTemplate( messageCount, intervalMs ),
                assetClass,
                shutdownOnComplete: false
            } )
            .assetClass( assetClass )
            .storage( questdbAdapter, {
                ilpUrl: QUESTDB_ILP_URL,
                pgUrl: QUESTDB_PG_URL,
                tablePrefix,
                flushMode: 'auto',
                autoFlushRows,
                autoFlushIntervalMs: 600000
            } )
            .assetId( 'partitionId' )
            .persistIf( 'persist', ( _msg ) => true,
                { storageName: 'questdb', insightType: 'samples' } )
            .run();

        // Reach into the live storage handle so we can poll its
        // pressure during the run. wire-storages keys singletons by
        // storage `id`; for this adapter, the key is 'questdb'.
        const storageHandle = wireStorages.get().questdb;
        expect( storageHandle, 'storage singleton must be wired' ).to.not.equal( undefined );
        expect( typeof storageHandle.getPressure, 'storage exposes getPressure' ).to.equal( 'function' );

        const samples = [];
        const sampler = setInterval( function () {
            samples.push( storageHandle.getPressure() );
        }, 25 );
        sampler.unref();

        await handle.whenComplete();
        clearInterval( sampler );
        await handle.shutdown();

        const finalCount = await waitForRows( pgClient, tableName, messageCount, 30000 );
        expect( finalCount ).to.equal( messageCount );

        const maxPressure = Math.max( ...samples );
        const minPressure = Math.min( ...samples );
        const sampleAtMax = samples.indexOf( maxPressure );

        console.log( '\n  [pressure] run summary:' );
        console.log( `    samples taken:      ${samples.length}` );
        console.log( `    pressure min:       ${minPressure.toFixed( 3 )}` );
        console.log( `    pressure max:       ${maxPressure.toFixed( 3 )} (sample #${sampleAtMax})` );
        console.log( `    autoFlushRows:      ${autoFlushRows}` );

        // Hard assertions:
        // 1. Pressure rose under load (proving the counter actually
        //    moves with buffered rows).
        expect( maxPressure, 'pressure must rise under load' ).to.be.greaterThan( 0 );

        // 2. Pressure never exceeded 1.0 — the documented bound
        //    (`getPressure()` is `bufferedRows / autoFlushRows`,
        //    clamped to 1.0 in the adapter).
        expect( maxPressure, 'pressure must not exceed 1.0' ).to.be.at.most( 1.0 );

        // 3. Pressure reset at least once during the run (auto-flush
        //    at the boundary cleared the buffered counter). With
        //    50 k messages and a 1 k boundary, we expect ~50 resets.
        //    A near-zero minimum proves at least one was sampled.
        expect( minPressure, 'pressure must reset after auto-flush' ).to.be.at.most( 0.1 );
    } );

} );

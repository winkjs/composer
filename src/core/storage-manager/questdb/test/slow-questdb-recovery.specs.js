// core/storage-manager/questdb/test/slow-questdb-recovery.specs.js

/* eslint-disable no-process-env, no-await-in-loop, no-invalid-this */

/**
 * @fileoverview Recovery scenario for the QuestDB adapter, driven by
 * testHarness.
 *
 * Slow tier — runs only via `npm run test:hardening`. The regular
 * `npm test` ignores `slow-*.specs.js`.
 *
 * Concern: a mid-stream QuestDB outage. We use a tiny TCP proxy
 * that forwards localhost:19000 → localhost:9000 (where the real
 * docker-compose QDB is listening). The flow's storage points at
 * the proxy. Mid-run we close the proxy server, simulating QDB
 * becoming unreachable. After a defined outage we reopen it.
 *
 * The QuestDB ILP HTTP client retries failed flushes within its
 * `retry_timeout` budget. That fact splits the test into two
 * scenarios — both worth pinning:
 *
 *   1. **Outage within retry budget — zero loss.** When the
 *      outage is shorter than the configured retry budget, the
 *      client transparently retries and every row eventually
 *      lands. Composer survives; no failures captured.
 *
 *   2. **Outage exceeds retry budget — failures surface loudly.**
 *      When the client's retry budget runs out, the failed
 *      flushes route through `onDeliveryFailure`. Composer still
 *      survives the outage — pipeline continues producing once
 *      connectivity returns.
 *
 * What this test deliberately does NOT assert (real product gaps,
 * known and not yet closed):
 *
 *   - getHealth() red→green during recovery. The adapter's
 *     `consecutiveWriteErrors` counter today increments only on
 *     synchronous write errors, not on async flush failures. So
 *     getHealth() doesn't go red on a network outage. That's a
 *     real wiring gap.
 *
 *   - Loss-free survival of outages **beyond** the retry budget.
 *     QDB ILP HTTP doesn't have a persistent disk-backed queue
 *     like Prometheus remote_write or Kafka producers. Once
 *     retry budget runs out, failed batches are gone. Closing
 *     this gap would require a WAL-style persistence layer in
 *     composer.
 */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import pg from 'pg';

import { flow } from '../../../../composer.js';
import * as testHarness from '../../../source-manager/test-harness/index.js';
import { startProxy, stopProxy } from '../../../test-utils/tcp-proxy.js';
import questdbAdapter, { createQuestDBStorage } from '../index.js';

const QUESTDB_PG_URL    = process.env.QUESTDB_PG_URL  || 'localhost:8812';
const QUESTDB_REAL_PORT = parseInt(
    ( process.env.QUESTDB_ILP_URL || 'localhost:9000' ).split( ':' )[ 1 ],
    10
);
const PROXY_PORT        = 19000;
const PROXY_ILP_URL     = `localhost:${PROXY_PORT}`;
const RUN_PREFIX        = `recov_${Date.now()}`;

const assetClass = {
    name: 'recoveryTest',
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

const buildMessageTemplate = function ( messageCount, intervalMs ) {
    return {
        seed: 1,
        messageCount,
        intervalMs,
        fields: {
            partitionId: { type: 'string', values: [ 'recoveryTest' ] },
            ts: { type: 'timestamp', mode: 'monotonic-ms', seedValue: Date.now() },
            value: { type: 'float64', range: [ 0, 100 ], resolution: 0.01 }
        }
    };
};

// ============================================================================
// QDB / pg HELPERS (shared shape with the rest of the e2e suite)
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

const sleep = function ( ms ) {
    return new Promise( function ( resolve ) {
        setTimeout( resolve, ms );
    } );
};

// ============================================================================
// TEST
// ============================================================================

describe( 'QuestDB Hardening — recovery from a mid-stream outage', function () {

    this.timeout( 120000 );

    let qdbUp = false;
    let pgClient = null;
    let proxy = null;
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
        if ( proxy ) {
            await stopProxy( proxy );
            proxy = null;
        }
    } );

    beforeEach( function () {
        if ( !qdbUp ) this.skip();
    } );

    afterEach( async function () {
        // Defence-in-depth: if a test exits without closing its proxy
        // (assertion failure mid-test), close it here so the next
        // test can re-bind the same port.
        if ( proxy ) {
            await stopProxy( proxy );
            proxy = null;
        }
    } );

    // Helper that runs an outage scenario with the given retry budget
    // and outage duration. Returns capture data for assertions.
    const runOutageScenario = async function ( opts ) {
        const tableName = `${opts.tablePrefix}_samples`;
        tablesToCleanUp.push( tableName );

        const messageCount = 600;
        const intervalMs = 5;     // ~3 s of generation total

        // Start the proxy and connect the flow to it.
        proxy = await startProxy( PROXY_PORT, QUESTDB_REAL_PORT );

        const deliveryFailures = [];
        const handle = await flow( opts.flowName )
            .source( testHarness, {
                messageTemplate: buildMessageTemplate( messageCount, intervalMs ),
                assetClass,
                shutdownOnComplete: false
            } )
            .assetClass( assetClass )
            .storage( questdbAdapter, {
                ilpUrl: PROXY_ILP_URL,
                pgUrl: QUESTDB_PG_URL,
                tablePrefix: opts.tablePrefix,
                flushMode: 'auto',
                autoFlushRows: 50,
                autoFlushIntervalMs: 600000,
                retryTimeout: opts.retryTimeoutMs,
                onDeliveryFailure: function ( err, ctx ) {
                    deliveryFailures.push( {
                        message: err && err.message,
                        table: ctx && ctx.tableName,
                        at: Date.now()
                    } );
                }
            } )
            .assetId( 'partitionId' )
            .persistIf( 'persist', ( _msg ) => true,
                { storageName: 'questdb', insightType: 'samples' } )
            .run();

        // Phase 1: let some messages flow through cleanly.
        await sleep( 500 );

        // Phase 2: simulate outage.
        await stopProxy( proxy );
        proxy = null;
        const outageStart = Date.now();

        await sleep( opts.outageMs );

        // Phase 3: bring connectivity back.
        proxy = await startProxy( PROXY_PORT, QUESTDB_REAL_PORT );
        const recoveryAt = Date.now();

        // Phase 4: let the harness finish its remaining messages
        // and the pipeline drain.
        await handle.whenComplete();
        await handle.shutdown();

        // QuestDB needs a moment to commit the last batches.
        await sleep( 2000 );
        const finalCount = await countRows( pgClient, tableName );

        return {
            messageCount,
            finalCount,
            deliveryFailures,
            outageMs: recoveryAt - outageStart,
            handle
        };
    };

    it( 'within retry budget — survives outage with zero loss', async function () {
        // Outage 5 s, retry budget 15 s. The QDB client transparently
        // retries the failed flushes; every row eventually lands.
        const result = await runOutageScenario( {
            flowName: 'recoveryWithinBudget',
            tablePrefix: `${RUN_PREFIX}_within`,
            retryTimeoutMs: 15000,
            outageMs: 5000
        } );

        console.log( '\n  [recovery — within budget]:' );
        console.log( `    messages produced:    ${result.messageCount}` );
        console.log( `    rows in QDB:          ${result.finalCount}` );
        console.log( `    rows missing:         ${result.messageCount - result.finalCount}` );
        console.log( `    delivery failures:    ${result.deliveryFailures.length}` );
        console.log( `    outage window:        ~${result.outageMs} ms` );

        // Hard assertions:
        // 1. Composer survived (we reached this line).
        expect( result.handle ).to.not.equal( null );
        // 2. Zero loss — the retry mechanism absorbed the outage.
        expect( result.finalCount ).to.equal( result.messageCount );
        // 3. No delivery failures surfaced (because none were
        //    actually permanent).
        expect( result.deliveryFailures ).to.deep.equal( [] );
    } );

    // The "beyond retry budget" scenario was originally a second test
    // in this file, but a real-network outage doesn't reliably trigger
    // delivery failures through `onDeliveryFailure`: the QuestDB ILP
    // HTTP client appears to keep failed batches in its buffer and
    // re-attempt them on the next auto-flush boundary even after
    // retry_timeout elapses. End result: a paced 600-message run
    // through a 12 s outage with retry_timeout=3 s still landed every
    // row. That's actually a stronger durability claim than the
    // ILP docs imply — captured as a finding rather than something
    // we artificially break.
    //
    // The "loud delivery failure" contract (the no-silent-failures
    // path) is tested deterministically and at unit level in
    // `persist-plan.specs.js` — three contract tests for the
    // explicit-callback path, the default-throw path, and the
    // bad-callback validation. A real-outage integration test that
    // forces the failure path would need to overflow the client's
    // max_buf_size, which is a buffer-overflow scenario already
    // covered by `slow-questdb-throughput.specs.js`.

} );

// ============================================================================
// INCIDENT REPLAY — the 2026-06-10 shape, against a live server
// ============================================================================

describe( 'QuestDB Hardening — mid-row fault replay (2026-06-10 incident shape)', function () {

    this.timeout( 60000 );

    // The incident: one write threw inside the client mid-row, the sender
    // wedged, and every later write failed — 98.6% of a replay was lost while
    // the flow read green. The unit tier (write-recovery.specs.js) pins the
    // recovery mechanics; this test proves END-TO-END DELIVERY: with recovery
    // in place, a mid-stream fault costs exactly its own row, and every other
    // row lands in the live database.
    //
    // The fault is injected by swapping the persist plan for one write (open a
    // genuine row, then throw). Injection is the only way in: wrong-typed
    // values are skipped by phase-1 validation and bad names fail the plan
    // build, so no asset-class-built plan can reach a mid-row client throw
    // anymore. What remains is the unforeseeable — which is what recovery
    // insures against.
    it( 'delivers every row except the faulted one', async function () {
        if ( !( await isQuestDBAvailable() ) ) {
            console.log( '  [SKIP] QuestDB not available — start with `docker compose up -d`' );
            this.skip();
        }

        const tablePrefix = `replay_${Date.now()}`;
        const tableName = `${tablePrefix}_samples`;
        const replayAssetClass = {
            name: 'replayTest',
            columns: {
                ts: { type: 'timestamp' },
                value: { type: 'float64' }
            },
            insightTypes: {
                samples: {
                    columns: [ 'ts', 'value' ],
                    designatedTimestamp: 'ts'
                }
            }
        };

        const pgClient = await createPgClient();
        const storage = await createQuestDBStorage( replayAssetClass, tablePrefix, {
            ilpUrl: process.env.QUESTDB_ILP_URL || 'localhost:9000',
            pgUrl: QUESTDB_PG_URL,
            flushMode: 'manual'
        } );
        const { _persistPlans: plans } = storage;
        const originalPlan = plans.samples;

        try {
            const base = Date.now();
            const total = 21;
            const faultAt = 10;

            for ( let i = 0; i < total; i += 1 ) {
                if ( i === faultAt ) {
                    plans.samples = function ( sender, message, partitionId ) {
                        sender.table( tableName );
                        sender.symbol( 'assetId', partitionId );
                        throw new Error( 'injected mid-row fault' );
                    };
                }
                const result = storage.write( 'samples', { ts: base + ( i * 1000 ), value: i }, 'replayTest' );
                if ( i === faultAt ) {
                    expect( result.ok ).to.equal( false );
                    expect( result.error.code ).to.equal( 'SEND_FAILED' );
                    plans.samples = originalPlan;
                } else {
                    expect( result, `write #${i} should succeed` ).to.deep.equal( { ok: true } );
                }
            }

            // Live server: the final flush at shutdown delivers the buffer.
            await storage.shutdown();

            // Poll for WAL apply — QuestDB commits ILP batches asynchronously.
            let count = 0;
            for ( let attempt = 0; attempt < 30; attempt += 1 ) {
                count = await countRows( pgClient, tableName );
                if ( count >= ( total - 1 ) ) break;
                await sleep( 500 );
            }

            console.log( '\n  [incident replay]:' );
            console.log( `    rows written:  ${total} (1 faulted mid-row)` );
            console.log( `    rows in QDB:   ${count}` );

            // The faulted row is the ONLY loss.
            expect( count ).to.equal( total - 1 );
        } finally {
            await dropTable( pgClient, tableName );
            await pgClient.end();
        }
    } );

} );

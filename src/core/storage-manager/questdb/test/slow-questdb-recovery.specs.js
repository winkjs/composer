// core/storage-manager/questdb/test/slow-questdb-recovery.specs.js

/* eslint-disable no-process-env, no-await-in-loop, no-invalid-this */

/**
 * @fileoverview Recovery from a mid-stream QuestDB outage, driven by
 * testHarness through a TCP proxy (ADR-029).
 *
 * Slow tier — runs only via `npm run test:hardening`. The regular
 * `npm test` ignores `slow-*.specs.js`.
 *
 * The proxy forwards 127.0.0.1:19000 to the real QuestDB on 9000.
 * The flow's storage points at the proxy. Mid-run the proxy closes,
 * so QuestDB becomes unreachable, and after a set outage it reopens.
 *
 * Composer owns every flush (ADR-029). The buffer ceiling is the
 * outage budget: rows written during an outage are held in memory up
 * to `bufferCeilingRows`, and past it a write is refused with
 * `STORAGE_FULL`. The flush that meets the outage fails at once on the
 * standard-library transport, the default since ADR-029 item 9 was
 * built. Its rows are reported lost, delivery pauses, and each
 * interval tick probes the endpoint. When a probe passes, one flush
 * carries everything held. Two legs pin that model:
 *
 *   1. **Ceiling sized to the outage.** The outage costs one batch,
 *      the one on the wire when the endpoint died. Every other row
 *      lands, exactly one loss is reported, and the ceiling is never
 *      hit.
 *
 *   2. **Ceiling smaller than the outage.** Rows past the ceiling are
 *      shed, visibly: pressure reads 1 while the endpoint is dead.
 *      The loss is confined to the outage window. The exact per-row
 *      shedding count is pinned at unit level in
 *      `buffer-ceiling.specs.js`; a live run can bound it, not count
 *      it, because a refusal leaves no mark in the flow's counters.
 *
 * The harness produces for longer than the outage lasts, so the flow
 * is still running when the endpoint returns and the tick resumes
 * delivery. A flow that completes while the endpoint is dead drains
 * at once: its final flush fails fast, and the rows are reported
 * dropped through shutdown, not landed. Until 2026-09-06 the undici
 * transport's own retry bridged that drain, so this file could let
 * the harness finish inside the outage. Health during the outage, the
 * pause, and the resume are proven in
 * `slow-questdb-health-outage.specs.js`.
 */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import pg from 'pg';

import { flow } from '../../../../composer.js';
import * as testHarness from '../../../source-manager/test-harness/index.js';
import { startProxy, stopProxy } from '../../../test-utils/tcp-proxy.js';
import { storages as wireStorages } from '../../../wiring/index.js';
import questdbAdapter, { createQuestDBStorage } from '../index.js';

const QUESTDB_PG_URL    = process.env.QUESTDB_PG_URL  || '127.0.0.1:8812';
const QUESTDB_REAL_PORT = parseInt(
    ( process.env.QUESTDB_ILP_URL || '127.0.0.1:9000' ).split( ':' )[ 1 ],
    10
);
const PROXY_PORT        = 19000;
const PROXY_ILP_URL     = `127.0.0.1:${PROXY_PORT}`;
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

    // Runs one outage with the given storage settings. The harness
    // produces 1,400 rows at 5 ms, about 200 rows a second. So a 5 s
    // outage covers about 1,000 rows, and the harness outlasts the
    // outage by more than a second. That matters. The flow drains its
    // sinks the moment the source completes. A harness that finished
    // inside the outage would drain into the dead endpoint. Returns
    // every fact the assertions need, including pressure samples
    // taken during the outage (a sustained state, so sampling may
    // assert it).
    const runOutageScenario = async function ( opts ) {
        const tableName = `${opts.tablePrefix}_samples`;
        tablesToCleanUp.push( tableName );

        const messageCount = 1400;
        const intervalMs = 5;

        // Start the proxy and connect the flow to it.
        proxy = await startProxy( PROXY_PORT, QUESTDB_REAL_PORT );

        const deliveryFailures = [];
        let produced = 0;
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
                flushRows: 50,
                // The tick is the probe cadence during a pause.
                flushIntervalMs: 500,
                ...opts.storage,
                onDeliveryFailure: function ( err, ctx ) {
                    deliveryFailures.push( {
                        message: err && err.message,
                        rowsLost: ctx && ctx.rowsLost,
                        abandoned: ctx && ctx.abandoned,
                        at: Date.now()
                    } );
                }
            } )
            .assetId( 'partitionId' )
            .persistIf( 'persist', function ( _msg ) {
                // Counts every row offered to the storage, so the
                // outage window's rows are known exactly.
                produced += 1;
                return true;
            }, { storageName: 'questdb', insightType: 'samples' } )
            .run();

        const storageHandle = wireStorages.get().questdb;
        expect( storageHandle, 'storage singleton must be wired' ).to.not.equal( undefined );

        // Phase 1: let some messages flow through cleanly.
        await sleep( 500 );
        const producedBeforeOutage = produced;

        // Phase 2: the outage. Sample pressure while the endpoint is dead.
        await stopProxy( proxy );
        proxy = null;
        const outageStart = Date.now();
        const heldAtOutageStart = storageHandle.getHealth().bufferedRows + storageHandle.getHealth().inFlightRows;
        const pressureSamples = [];
        while ( ( Date.now() - outageStart ) < opts.outageMs ) {
            pressureSamples.push( storageHandle.getPressure() );
            await sleep( 50 );
        }

        // Phase 3: bring connectivity back. Rows keep arriving until
        // the held rows drain, so the count at drain time bounds the
        // shedding from above.
        proxy = await startProxy( PROXY_PORT, QUESTDB_REAL_PORT );
        const recoveryAt = Date.now();
        const producedDuringOutage = produced - producedBeforeOutage;
        while ( ( storageHandle.getPressure() >= 1 ) && ( ( Date.now() - recoveryAt ) < 10000 ) ) {
            await sleep( 20 );
        }
        const producedUntilDrained = produced - producedBeforeOutage;

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
            pressureSamples,
            heldAtOutageStart,
            producedDuringOutage,
            producedUntilDrained,
            outageMs: recoveryAt - outageStart,
            handle
        };
    };

    const printSummary = function ( label, result ) {
        const maxPressure = Math.max( ...result.pressureSamples );
        console.log( `\n  [recovery — ${label}]:` );
        console.log( `    messages produced:    ${result.messageCount}` );
        console.log( `    held at outage start: ${result.heldAtOutageStart}` );
        console.log( `    produced in outage:   ${result.producedDuringOutage} (until drained: ${result.producedUntilDrained})` );
        console.log( `    rows in QDB:          ${result.finalCount}` );
        console.log( `    rows missing:         ${result.messageCount - result.finalCount}` );
        console.log( `    delivery failures:    ${result.deliveryFailures.length}` );
        console.log( `    max pressure:         ${maxPressure.toFixed( 3 )}` );
        console.log( `    outage window:        ~${result.outageMs} ms` );
    };

    it( 'ceiling sized to the outage: the outage costs one batch, every other row lands', async function () {
        // A 5 s outage at about 200 rows a second needs a ceiling of
        // about 1,000 rows. 2,000 leaves room. The flush that meets
        // the outage fails at once and its rows are reported lost.
        // Everything else is held, and lands when the tick resumes
        // delivery. A row reported lost may still land, when the
        // server committed the batch before the client saw the reset.
        // So the count is bounded, not exact.
        const result = await runOutageScenario( {
            flowName: 'recoveryCeilingHolds',
            tablePrefix: `${RUN_PREFIX}_holds`,
            outageMs: 5000,
            storage: { retryTimeout: 15000, bufferCeilingRows: 2000 }
        } );
        printSummary( 'ceiling holds', result );

        expect( result.deliveryFailures ).to.have.lengthOf( 1 );
        expect( result.deliveryFailures[ 0 ].abandoned ).to.equal( false );
        const rowsLost = result.deliveryFailures[ 0 ].rowsLost;
        expect( rowsLost ).to.be.greaterThan( 0 );
        expect( result.finalCount ).to.be.at.least( result.messageCount - rowsLost );
        expect( result.finalCount ).to.be.at.most( result.messageCount );
        expect( Math.max( ...result.pressureSamples ), 'the ceiling was never reached' ).to.be.lessThan( 1 );
    } );

    it( 'ceiling smaller than the outage: rows past it are shed, visibly, inside the outage', async function () {
        // The same outage against a 500-row ceiling. About 1,000 rows
        // arrive while the endpoint is dead, so about half are refused
        // with STORAGE_FULL. Pressure reads 1 for the rest of the
        // outage, which a sampler cannot miss. The batch on the wire
        // fails at once, as in the first leg.
        const result = await runOutageScenario( {
            flowName: 'recoveryCeilingSheds',
            tablePrefix: `${RUN_PREFIX}_sheds`,
            outageMs: 5000,
            storage: { retryTimeout: 15000, bufferCeilingRows: 500 }
        } );
        printSummary( 'ceiling sheds', result );

        // The ceiling was reached and held.
        expect( Math.max( ...result.pressureSamples ) ).to.equal( 1 );

        // The batch on the wire failed at once and left the tally.
        expect( result.deliveryFailures ).to.have.lengthOf( 1 );
        expect( result.deliveryFailures[ 0 ].abandoned ).to.equal( false );
        const rowsLost = result.deliveryFailures[ 0 ].rowsLost;

        // The room left under the ceiling when the endpoint died is
        // what the outage could hold, plus the slots the failed batch
        // gave back. Every row past it was refused until the held rows
        // drained after the endpoint returned. So the shed count lies
        // between the rows past the room at recovery and the rows past
        // the room at drain time. Both ends are counts, not samples.
        // The rows reported lost may or may not have landed, so they
        // widen the lower bound.
        const room = ( 500 - result.heldAtOutageStart ) + rowsLost;
        const shedAtLeast = result.producedDuringOutage - room;
        const shedAtMost = result.producedUntilDrained - room;
        expect( shedAtLeast, 'the outage overran the room' ).to.be.greaterThan( 0 );
        expect( result.finalCount ).to.be.at.most( result.messageCount - shedAtLeast );
        expect( result.finalCount ).to.be.at.least( result.messageCount - shedAtMost - rowsLost );
    } );

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
            ilpUrl: process.env.QUESTDB_ILP_URL || '127.0.0.1:9000',
            pgUrl: QUESTDB_PG_URL
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

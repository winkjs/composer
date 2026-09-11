// core/storage-manager/questdb/test/slow-questdb-health-outage.specs.js

/**
 * @fileoverview Health during a live QuestDB outage (ADR-029).
 * Hardening tier: runs under `npm run test:hardening`, never under
 * `npm test`.
 *
 * The run-5 soak found the adapter reporting green while every row
 * was lost. This spec kills the ILP path mid-run, through the TCP
 * proxy, and asserts what health says while the endpoint is dead and
 * after it returns. Two legs share one runner. The first lets the row
 * trigger start the flush that meets the outage. The second keeps
 * `flushRows` out of reach, so the interval timer starts it.
 *
 * What the client does on a closed port decides the shape. Its undici
 * transport retries a refused connection without end, so the flush
 * hangs until its deadline. Abandonment then reads red at once, the
 * probe fails, and delivery pauses. There is no "first failed flush"
 * step before red on a live kill; the unit spec
 * `health-ladder.specs.js` pins that step with a server that answers
 * an error; its live leg belongs to the fault-model matrix.
 *
 * Assertions follow the testing rule for sampled observations. Red
 * during the pause is a sustained state, so samples may assert it.
 * The transition back to green is awaited on the health fields
 * themselves, and the loss is taken from the `onDeliveryFailure`
 * callback, an event that cannot be missed.
 *
 * The flush that meets the outage fails at once. The standard-library
 * transport, the default since ADR-029 item 9 was built, rejects a
 * refused or reset connection without retrying it. So the batch on
 * the wire is reported lost with `abandoned: false`, the failure count
 * reads exactly one, and delivery pauses on the probe's finding. The
 * deadline stays a backstop and never fires here. Until 2026-09-06
 * the undici transport retried the connection inside the client, the
 * flush hung until the deadline, and this spec asserted an
 * abandonment. That shape is gone with the default.
 *
 * Two facts the live runs taught. First, rows reported lost can still
 * land: the server may have committed the batch before the client saw
 * the reset. So the reported loss is a ceiling on the real loss, and
 * the accounting here is a bound: rows landed lie between rows
 * accepted minus rows reported lost and rows accepted. Composer never
 * resends a failed batch, so the upper bound also proves no
 * duplicates. Second, with both triggers armed, either one can start
 * the flush that meets the outage, so the first leg accepts both and
 * only the second leg pins the timer.
 *
 * The log is asserted too. Every change of delivery state prints one
 * line through the facade, so a live outage must read, in order:
 * degraded at the failed batch, red at the pause, paused, resumed,
 * restored, and nothing else from the adapter. The pause is the red
 * edge (ADR-029), so health and the ladder both read red from the
 * pause itself, with one failure on the count. The restored line
 * names the rows reported lost, which must equal the sum the callback
 * received. That makes the log an event-driven record of the outage,
 * not a sampled one.
 */

/* eslint-disable no-process-env, no-await-in-loop, no-invalid-this */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import pg from 'pg';

import { flow } from '../../../../composer.js';
import * as testHarness from '../../../source-manager/test-harness/index.js';
import { startProxy, stopProxy } from '../../../test-utils/tcp-proxy.js';
import { storages as wireStorages } from '../../../wiring/index.js';
import questdbAdapter from '../index.js';

const QUESTDB_PG_URL    = process.env.QUESTDB_PG_URL  || '127.0.0.1:8812';
const QUESTDB_REAL_PORT = parseInt(
    ( process.env.QUESTDB_ILP_URL || '127.0.0.1:9000' ).split( ':' )[ 1 ],
    10
);
const PROXY_PORT        = 19001;
const PROXY_ILP_URL     = `127.0.0.1:${PROXY_PORT}`;
const RUN_PREFIX        = `health_${Date.now()}`;

/** Sampling period for health during the outage, well inside the pause. */
const SAMPLE_MS = 50;

const assetClass = {
    name: 'healthTest',
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
            partitionId: { type: 'string', values: [ 'healthTest' ] },
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

/**
 * Polls `getHealth()` until `predicate` holds or `maxMs` passes.
 * Returns the last reading either way; the caller asserts on it.
 */
const waitForHealth = async function ( storage, predicate, maxMs ) {
    const start = Date.now();
    let health = storage.getHealth();
    while ( !predicate( health ) && ( ( Date.now() - start ) < maxMs ) ) {
        await sleep( SAMPLE_MS );
        health = storage.getHealth();
    }
    return health;
};

/**
 * Captures the facade's warn and error lines while still printing
 * them. The lines are the event-driven record of every edge the
 * adapter passed, so the assertions can name them in order.
 */
const captureConsole = function () {
    const lines = [];
    const wrap = function ( level, original ) {
        return function ( ...args ) {
            lines.push( { level, text: String( args[ 0 ] ) } );
            original.apply( console, args );
        };
    };
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = wrap( 'warn', originalWarn );
    console.error = wrap( 'error', originalError );
    return {
        lines,
        restore: function () {
            console.warn = originalWarn;
            console.error = originalError;
        }
    };
}; // captureConsole()

// ============================================================================
// TEST
// ============================================================================

describe( 'QuestDB Hardening — health during a live outage', function () {

    this.timeout( 120000 );

    let qdbUp = false;
    let pgClient = null;
    let proxy = null;
    let capture = null;
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
        if ( capture ) {
            capture.restore();
            capture = null;
        }
        if ( proxy ) {
            await stopProxy( proxy );
            proxy = null;
        }
    } );

    /**
     * Runs one outage against the proxy and returns every fact the
     * assertions need. `opts.flushRows` decides which trigger meets the
     * outage: a reachable value lets the row trigger start it, an
     * unreachable one leaves it to the interval timer.
     */
    const runOutage = async function ( opts ) {
        const tableName = `${opts.tablePrefix}_samples`;
        tablesToCleanUp.push( tableName );

        proxy = await startProxy( PROXY_PORT, QUESTDB_REAL_PORT );
        capture = captureConsole();

        const deliveryFailures = [];
        const handle = await flow( opts.flowName )
            .source( testHarness, {
                messageTemplate: buildMessageTemplate( opts.messageCount, opts.intervalMs ),
                assetClass,
                shutdownOnComplete: false
            } )
            .assetClass( assetClass )
            .storage( questdbAdapter, {
                ilpUrl: PROXY_ILP_URL,
                pgUrl: QUESTDB_PG_URL,
                tablePrefix: opts.tablePrefix,
                flushRows: opts.flushRows,
                flushIntervalMs: 300,
                flushDeadlineMs: 800,
                onDeliveryFailure: function ( err, ctx ) {
                    deliveryFailures.push( { message: err.message, ctx } );
                }
            } )
            .assetId( 'partitionId' )
            .persistIf( 'persist', ( _msg ) => true,
                { storageName: 'questdb', insightType: 'samples' } )
            .run();

        const storages = Object.values( wireStorages.get() );
        expect( storages, 'one wired storage' ).to.have.lengthOf( 1 );
        const storage = storages[ 0 ];

        // Phase 1: a clean stretch, long enough for at least one flush.
        const baseline = await waitForHealth( storage, ( h ) => h.lastFlushAt !== null, 3000 );

        // Phase 2: the outage. Sample health while the endpoint is dead.
        await stopProxy( proxy );
        proxy = null;
        const outageStart = Date.now();
        const samples = [];
        while ( ( Date.now() - outageStart ) < opts.outageMs ) {
            samples.push( storage.getHealth() );
            await sleep( SAMPLE_MS );
        }

        // Phase 3: the endpoint returns. Wait for delivery to resume.
        proxy = await startProxy( PROXY_PORT, QUESTDB_REAL_PORT );
        const recovered = await waitForHealth(
            storage,
            ( h ) => h.status === 'green' && h.lastFlushAt > outageStart,
            10000
        );

        // Phase 4: let the harness finish, then drain.
        await handle.whenComplete();
        await handle.shutdown();
        await sleep( 1500 );
        const landed = await countRows( pgClient, tableName );
        const lines = capture.lines;
        capture.restore();
        capture = null;

        return { baseline, samples, recovered, deliveryFailures, landed, outageStart, lines };
    };

    /** The assertions both legs share. */
    const assertOutageTruth = function ( opts, result ) {
        const { baseline, samples, recovered, deliveryFailures, landed } = result;

        // Before the outage: healthy, and at least one flush had landed.
        expect( baseline.status ).to.equal( 'green' );
        expect( baseline.lastFlushAt ).to.be.a( 'number' );
        expect( baseline.consecutiveFlushFailures ).to.equal( 0 );

        // During the outage: red, not connected, paused, and the last
        // error is the one fast failure of the batch on the wire. The
        // pause is a sustained state, so the samples must contain it.
        const red = samples.filter( ( h ) => h.status === 'red' );
        expect( red.length, 'red samples during the outage' ).to.be.greaterThan( 0 );
        const last = red[ red.length - 1 ];
        expect( last.connected ).to.equal( false );
        expect( last.pausedSince ).to.be.a( 'number' );
        expect( last.consecutiveFlushFailures ).to.equal( 1 );
        expect( last.abandonedFlushes ).to.equal( 0 );
        expect( last.lastFlushError.abandoned ).to.equal( false );

        // The loss reached the callback once, as a fast failure with a
        // row count, its trigger, and the probe's finding.
        expect( deliveryFailures ).to.have.lengthOf( 1 );
        const failure = deliveryFailures[ 0 ];
        expect( failure.ctx.abandoned ).to.equal( false );
        expect( failure.ctx.rowsLost ).to.be.greaterThan( 0 );
        expect( opts.expectedTriggers ).to.include( failure.ctx.trigger );
        expect( failure.ctx.probe.ok ).to.equal( false );

        // After the endpoint returned: green again, connected, not
        // paused, the failure count reset, and a newer successful flush.
        expect( recovered.status ).to.equal( 'green' );
        expect( recovered.connected ).to.equal( true );
        expect( recovered.pausedSince ).to.equal( null );
        expect( recovered.consecutiveFlushFailures ).to.equal( 0 );
        expect( recovered.lastFlushAt ).to.be.greaterThan( baseline.lastFlushAt );
        // The last error stays readable after recovery.
        expect( recovered.lastFlushError.abandoned ).to.equal( false );

        // Accounting: every accepted row either landed or was reported
        // lost, and a row reported lost may still land (see the header).
        // No row lands twice.
        const rowsLost = deliveryFailures.reduce( ( sum, f ) => sum + f.ctx.rowsLost, 0 );
        expect( rowsLost ).to.be.greaterThan( 0 );
        expect( landed ).to.be.at.least( opts.messageCount - rowsLost );
        expect( landed ).to.be.at.most( opts.messageCount );

        // The log carries every edge once, in order: degraded at the
        // failed batch, red at the pause, paused, resumed, restored.
        // Nothing else from the adapter, whatever the outage length.
        // The restored line's row count is the same sum the callback
        // received.
        const adapterLines = result.lines.filter( ( l ) => l.text.includes( 'winkComposer/questdb' ) );
        expect( adapterLines.map( ( l ) => l.level ) ).to.deep.equal( [ 'warn', 'error', 'warn', 'warn', 'warn' ] );
        expect( adapterLines[ 0 ].text ).to.include( 'delivery degraded, 1 flush failed [DELIVERY_HEALTH]' );
        expect( adapterLines[ 1 ].text ).to.include( 'delivery red, paused after 1 failed flush(es) [DELIVERY_HEALTH]' );
        expect( adapterLines[ 2 ].text ).to.include( 'delivery paused' ).and.include( '[CIRCUIT_OPEN]' );
        expect( adapterLines[ 3 ].text ).to.include( 'delivery resumed' ).and.include( '[CIRCUIT_OPEN]' );
        expect( adapterLines[ 4 ].text ).to.include( `${rowsLost} row(s) reported lost meanwhile [DELIVERY_HEALTH]` );
    };

    it( 'producer at rate: one fast failure, red with pausedSince while the endpoint is dead, green after it returns', async function () {
        const opts = {
            flowName: 'healthOutageRows',
            tablePrefix: `${RUN_PREFIX}_rows`,
            messageCount: 800,
            intervalMs: 10,
            flushRows: 50,
            outageMs: 2500,
            expectedTriggers: [ 'rows', 'timer' ]
        };
        const result = await runOutage( opts );

        console.log( '\n  [health — producer at rate]:' );
        console.log( `    red samples:          ${result.samples.filter( ( h ) => h.status === 'red' ).length} of ${result.samples.length}` );
        console.log( `    delivery failures:    ${result.deliveryFailures.length}` );
        console.log( `    rows landed:          ${result.landed} of ${opts.messageCount}` );
        console.log( `    adapter log lines:    ${result.lines.filter( ( l ) => l.text.includes( 'winkComposer/questdb' ) ).length}` );

        assertOutageTruth( opts, result );
    } );

    it( 'timer path: the same truth when the interval timer starts the flush that meets the outage', async function () {
        const opts = {
            flowName: 'healthOutageTimer',
            tablePrefix: `${RUN_PREFIX}_timer`,
            messageCount: 160,
            intervalMs: 50,
            flushRows: 100000,
            outageMs: 2500,
            expectedTriggers: [ 'timer' ]
        };
        const result = await runOutage( opts );

        console.log( '\n  [health — timer path]:' );
        console.log( `    red samples:          ${result.samples.filter( ( h ) => h.status === 'red' ).length} of ${result.samples.length}` );
        console.log( `    delivery failures:    ${result.deliveryFailures.length}` );
        console.log( `    rows landed:          ${result.landed} of ${opts.messageCount}` );
        console.log( `    adapter log lines:    ${result.lines.filter( ( l ) => l.text.includes( 'winkComposer/questdb' ) ).length}` );

        assertOutageTruth( opts, result );
    } );
} );

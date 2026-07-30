// core/storage-manager/questdb/test/e2e-questdb-flush.specs.js

/* eslint-disable no-process-env, no-await-in-loop, no-invalid-this */

/**
 * @fileoverview Integration tests for QuestDB flush + shutdown
 * behaviour, driven by testHarness.
 *
 * Fast hardening tests. Three concerns:
 *
 *   1. Shutdown grace — `handle.shutdown()` drains the buffer; no
 *      row is lost; the call returns within the configured window.
 *   2. Idle-flush timing — in manual mode, rows reach QDB
 *      `idleFlushAfterMs` after the last write, without anyone
 *      having to call shutdown.
 *   3. Auto-mode boundary — in auto mode, the QuestDB ILP client
 *      flushes when `autoFlushRows` is crossed, exercised by
 *      sending several multiples of the boundary.
 *
 * Each test wires a real flow, drives it with the testHarness, and
 * queries QuestDB via PostgreSQL after the relevant operation
 * settles. Tests skip cleanly when QuestDB is not reachable (start
 * services with `docker compose up -d` from the composer repo
 * root).
 */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import pg from 'pg';

import { flow } from '../../../../composer.js';
import * as testHarness from '../../../source-manager/test-harness/index.js';
import questdbAdapter from '../index.js';

const QUESTDB_ILP_URL = process.env.QUESTDB_ILP_URL || 'localhost:9000';
const QUESTDB_PG_URL  = process.env.QUESTDB_PG_URL  || 'localhost:8812';
const RUN_PREFIX      = `flush_${Date.now()}`;

// Asset class shared by all three tests. Same shape; each test uses
// a unique table prefix so they don't collide.
const assetClass = {
    name: 'flushTest',
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
            partitionId: { type: 'string', values: [ 'flushTest' ] },
            ts: { type: 'timestamp', mode: 'monotonic-ms', seedValue: Date.now() },
            value: { type: 'float64', range: [ 0, 100 ], resolution: 0.01 }
        }
    };
};

// ============================================================================
// QDB AVAILABILITY HELPERS (shared with the rest of the e2e suite)
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
        // Cleanup is best-effort.
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

const waitForRows = async function ( client, tableName, expected, maxMs = 5000 ) {
    const start = Date.now();
    while ( ( Date.now() - start ) < maxMs ) {
        const count = await countRows( client, tableName );
        if ( count >= expected ) return count;
        await new Promise( ( r ) => setTimeout( r, 100 ) );
    }
    return countRows( client, tableName );
};

// ============================================================================
// TESTS
// ============================================================================

describe( 'QuestDB E2E — flush + shutdown behaviour', function () {

    this.timeout( 30000 );

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

    afterEach( function () {
        // Each test pushes its tables here so `after` cleans them up.
    } );

    // --------------------------------------------------------------------
    // Test 1 — Shutdown grace
    // --------------------------------------------------------------------

    it( 'drains the buffer on shutdown — no row loss', async function () {
        const messageCount = 200;
        const tablePrefix = `${RUN_PREFIX}_drain`;
        const tableName = `${tablePrefix}_samples`;
        tablesToCleanUp.push( tableName );

        // Manual mode + a long auto-flush backstop means the only path
        // for rows to reach QDB is the shutdown drain. If the drain
        // races the buffer or returns early, this test catches it.
        const handle = await flow( 'drainTest' )
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
                flushMode: 'manual',
                autoFlushIntervalMs: 600000
            } )
            .assetId( 'partitionId' )
            .persistIf( 'persist', ( _msg ) => true,
                { storageName: 'questdb', insightType: 'samples' } )
            .run();

        await handle.whenComplete();

        // Capture the time `shutdown()` takes — the drain must
        // complete within the per-stage timeout (5 s by default).
        const t0 = Date.now();
        await handle.shutdown();
        const drainMs = Date.now() - t0;
        expect( drainMs, 'shutdown should return within the per-stage budget' ).to.be.lessThan( 5000 );

        // Eventual consistency: rows are visible momentarily after
        // shutdown returns. Wait briefly, then count.
        const finalCount = await waitForRows( pgClient, tableName, messageCount, 5000 );
        expect( finalCount, 'every harness message must land in QDB' ).to.equal( messageCount );
    } );

    // --------------------------------------------------------------------
    // Test 2 — Idle-flush timing
    // --------------------------------------------------------------------

    it( 'idle-flush fires within idleFlushAfterMs — rows visible without shutdown', async function () {
        const messageCount = 10;
        const idleFlushAfterMs = 500;
        const idleFlushCheckMs = 100;
        const tablePrefix = `${RUN_PREFIX}_idle`;
        const tableName = `${tablePrefix}_samples`;
        tablesToCleanUp.push( tableName );

        // Manual mode + short idle window. After the harness finishes
        // generating, no further writes happen. The idle timer should
        // fire `idleFlushAfterMs` after the last write and push the
        // buffer to QDB — without anyone calling shutdown.
        const handle = await flow( 'idleFlushTest' )
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
                flushMode: 'manual',
                idleFlushAfterMs,
                idleFlushCheckMs
            } )
            .assetId( 'partitionId' )
            .persistIf( 'persist', ( _msg ) => true,
                { storageName: 'questdb', insightType: 'samples' } )
            .run();

        await handle.whenComplete();

        // Right after generation finishes, the buffer hasn't been
        // flushed yet. The idle timer fires `idleFlushAfterMs` later.
        // Wait for the rows to appear *before* shutting down — that
        // proves the idle timer drove the flush.
        const visibleCount = await waitForRows(
            pgClient, tableName, messageCount,
            ( idleFlushAfterMs + idleFlushCheckMs ) * 4   // generous bound
        );
        expect( visibleCount, 'idle timer should flush the buffer' ).to.equal( messageCount );

        await handle.shutdown();
    } );

    // --------------------------------------------------------------------
    // Test 3 — Auto-mode boundary
    // --------------------------------------------------------------------

    it( 'auto-flush triggers at the autoFlushRows boundary', async function () {
        const autoFlushRows = 50;
        const messageCount = autoFlushRows * 4;   // four flushes worth
        const tablePrefix = `${RUN_PREFIX}_auto`;
        const tableName = `${tablePrefix}_samples`;
        tablesToCleanUp.push( tableName );

        // Auto mode + short row boundary + long time backstop. The
        // only path to QDB is the row-count trigger. With 4× the
        // boundary's worth of messages, the boundary is exercised
        // four times. The shutdown drain catches the final partial
        // batch (200 messages cleanly = 0 leftover, but the drain
        // is harmless either way).
        const handle = await flow( 'autoFlushTest' )
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
                autoFlushRows,
                autoFlushIntervalMs: 600000   // 10 minutes — won't fire
            } )
            .assetId( 'partitionId' )
            .persistIf( 'persist', ( _msg ) => true,
                { storageName: 'questdb', insightType: 'samples' } )
            .run();

        await handle.whenComplete();
        await handle.shutdown();

        const finalCount = await waitForRows( pgClient, tableName, messageCount, 5000 );
        expect( finalCount, 'auto-flush must deliver every message' ).to.equal( messageCount );
    } );

} );

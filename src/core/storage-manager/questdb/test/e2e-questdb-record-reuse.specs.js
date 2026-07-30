// core/storage-manager/questdb/test/e2e-questdb-record-reuse.specs.js

/* eslint-disable no-process-env, no-await-in-loop, no-invalid-this */

/**
 * @fileoverview End-to-end proof of the record-reuse pattern through a real
 * flow and a live QuestDB.
 *
 * The service-free legs (core/test/record-reuse-pattern.specs.js) prove the
 * pattern at the gate and at the emitter. This spec proves it at the
 * altitude the user experiences: a full flow — testHarness source, the
 * partition manager fanning messages across TWO partitions, a persistIf
 * gate whose annotate fills ONE reused record — writing into a real
 * QuestDB. The claim under test: every stored row carries the values of
 * the message that produced it, keyed by timestamp, with the right
 * partition in the assetId column. If any part of the real path — wiring,
 * partition manager, gate, persist plan, ILP client — held the record and
 * read it late, rows would repeat a later firing's values and this fails.
 *
 * The expected values are copied inside the shaper, at firing time. That
 * is the right oracle for THIS claim: the subject is not what the pipeline
 * computes (the harness generates the numbers), but whether what the gate
 * handed the sink at firing N is what row N stores.
 *
 * Skips cleanly when QuestDB is not reachable — start services with
 * `docker compose up -d` from the composer repo root.
 */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach } from 'mocha';
import pg from 'pg';

import { flow } from '../../../../composer.js';
import * as testHarness from '../../../source-manager/test-harness/index.js';
import questdbAdapter from '../index.js';

const QUESTDB_ILP_URL = process.env.QUESTDB_ILP_URL || 'localhost:9000';
const QUESTDB_PG_URL  = process.env.QUESTDB_PG_URL  || 'localhost:8812';
const TABLE_PREFIX    = `reuse_${Date.now()}`;
const TABLE_NAME      = `${TABLE_PREFIX}_events`;
const MESSAGE_COUNT   = 300;

// Two partitions on purpose: the reused record is shared by the whole
// gate, so partition interleaving is where corruption would appear first.
const assetClass = {
    name: 'reuseCheck',
    columns: {
        _harnessId: { type: 'int64' },
        partitionId: { type: 'string' },
        ts: { type: 'timestamp' },
        reading: { type: 'float64', resolution: 0.01 },
        tag: { type: 'string' }
    },
    insightTypes: {
        events: {
            columns: [ 'ts', 'reading', 'tag' ],
            designatedTimestamp: 'ts'
        }
    }
};

const messageTemplate = {
    seed: 7,
    messageCount: MESSAGE_COUNT,
    intervalMs: 0,
    fields: {
        partitionId: { type: 'string', values: [ 'tankA', 'tankB' ] },
        ts: { type: 'timestamp', mode: 'monotonic-ms', seedValue: Date.now() },
        value: { type: 'float64', range: [ 0, 100 ], resolution: 0.01 }
    }
};

// ---------------------------------------------------------------------------
// QuestDB availability + query helpers (same shapes as the other e2e specs)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// TEST
// ---------------------------------------------------------------------------

describe( 'QuestDB E2E — record-reuse pattern through a real flow', function () {

    this.timeout( 30000 );

    let qdbUp = false;
    let pgClient = null;

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
            await dropTable( pgClient, TABLE_NAME );
            await pgClient.end();
        }
    } );

    beforeEach( function () {
        if ( !qdbUp ) this.skip();
    } );

    it( 'every stored row matches the message that produced it, on both partitions', async function () {

        // The reused record, handbook-shaped: one constant, two changing
        // fields, overwritten on every firing. `expected` copies the
        // firing's values at shape time — primitives, so the copies are
        // immune to the record's later mutation.
        const eventRecord = { ts: null, reading: null, tag: 'reuse' };
        const expected = [];
        const shapeEvent = function ( msg ) {
            eventRecord.ts = msg.ts;
            eventRecord.reading = msg.value;
            expected.push( { ts: msg.ts, reading: msg.value, partitionId: msg.partitionId } );
            return eventRecord;
        };

        const handle = await flow( 'reusePatternE2e' )
            .source( testHarness, {
                messageTemplate,
                assetClass,
                shutdownOnComplete: false
            } )
            .assetClass( assetClass )
            .storage( questdbAdapter, {
                ilpUrl: QUESTDB_ILP_URL,
                pgUrl: QUESTDB_PG_URL,
                tablePrefix: TABLE_PREFIX,
                flushMode: 'auto'
            } )
            .assetId( 'partitionId' )
            .persistIf( 'persistEvents', ( _msg ) => true, {
                storageName: 'questdb',
                insightType: 'events',
                annotate: shapeEvent
            } )
            .run();

        await handle.whenComplete();
        await handle.shutdown();

        // QuestDB applies its write-ahead log asynchronously; poll to the
        // known count before reading rows.
        const rowCount = await waitForRows( pgClient, TABLE_NAME, MESSAGE_COUNT );
        expect( rowCount, 'every message must land as a row' ).to.equal( MESSAGE_COUNT );
        expect( expected.length, 'the shaper must have fired once per message' ).to.equal( MESSAGE_COUNT );

        // Key rows by timestamp (monotonic-ms with 1 ms steps — unique per
        // message). The timestamp is cast to a long (epoch microseconds) in
        // SQL: the pg driver would otherwise parse the column as a
        // local-time Date and shift the epoch by the timezone offset.
        // assetId carries the partition id; the reused record never touches
        // it, so a partition mix-up would surface here too.
        const result = await pgClient.query(
            `SELECT assetId, cast(ts as long) ts_us, reading, tag FROM ${TABLE_NAME}`
        );
        const rowsByTs = new Map();
        for ( const row of result.rows ) {
            rowsByTs.set( Number( row.ts_us ) / 1000, row );
        }

        for ( const exp of expected ) {
            const row = rowsByTs.get( exp.ts );
            expect( row, `a row must exist for ts ${exp.ts}` ).to.not.equal( undefined );
            // The harness snaps values to the declared resolution and the
            // persist plan quantizes with the same helper, so the stored
            // float sits on the same grid as the shaped value; the
            // tolerance covers float64 representation only.
            expect( Number( row.reading ) ).to.be.closeTo( exp.reading, 1e-6 );
            expect( row.tag ).to.equal( 'reuse' );
            expect( row.assetId ).to.equal( exp.partitionId );
        }

        // Fixture guard: the interleaving this spec exists to exercise must
        // actually have happened. Cross-check the per-partition message
        // counts through the two independent capture paths — the shaper's
        // copies and the stored rows. The seeded harness makes both exact.
        const countByPartition = function ( items, field ) {
            const counts = {};
            for ( const item of items ) {
                counts[ item[ field ] ] = ( counts[ item[ field ] ] || 0 ) + 1;
            }
            return counts;
        };
        const expectedCounts = countByPartition( expected, 'partitionId' );
        const storedCounts = countByPartition( result.rows, 'assetId' );
        expect( Object.keys( expectedCounts ).sort() ).to.deep.equal( [ 'tankA', 'tankB' ] );
        expect( storedCounts ).to.deep.equal( expectedCounts );
    } );
} );

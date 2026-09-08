// core/storage-manager/questdb/test/slow-questdb-csv-replay.specs.js

/**
 * @fileoverview A file replay at adapter defaults lands every row
 * (ADR-029). Hardening tier: runs under `npm run test:hardening`,
 * never under `npm test`.
 *
 * The throughput spec drives the adapter with the test harness, which
 * can produce faster than any real source. This spec uses a real
 * source, the CSV reader, at the adapter's default settings: no flush
 * threshold, ceiling or interval override. A CSV replay yields to the
 * event loop between chunks, so the adapter's flushes settle while
 * the file is read, and the bounded buffer never fills. The assertion
 * is exact: every row lands, nothing is shed, nothing is reported.
 *
 * The file is generated under `.scratchpad` for the run and removed
 * after it. 200,000 rows take about a second to replay on a laptop.
 * The reference measurement of 1,000,000 rows at about 294,000 rows
 * a second (2026-09-05) stays in the epic.
 */

/* eslint-disable no-process-env, no-await-in-loop, no-invalid-this */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from 'chai';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';

import { flow, csv } from '../../../../composer.js';
import questdbAdapter from '../index.js';
import {
    QUESTDB_PG_URL, isQuestDBAvailable, createPgClient, dropTable, countRows, sleep, captureConsole
} from './slow-helpers.js';

const QUESTDB_ILP_URL = process.env.QUESTDB_ILP_URL || '127.0.0.1:9000';
const RUN_PREFIX      = `csvreplay_${Date.now()}`;
const CSV_ROWS        = 200000;
const CSV_PATH        = path.join(
    path.dirname( fileURLToPath( import.meta.url ) ),
    '..', '..', '..', '..', '..', '.scratchpad', `${RUN_PREFIX}.csv`
);

const assetClass = {
    name: 'csvReplay',
    columns: {
        partitionId: { type: 'string' },
        ts: { type: 'timestamp' },
        value: { type: 'float64', resolution: 0.01 }
    },
    insightTypes: {
        samples: {
            columns: [ 'partitionId', 'ts', 'value' ],
            designatedTimestamp: 'ts'
        }
    }
};

/** Writes the replay file: a header and `CSV_ROWS` rows one millisecond apart. */
const writeCsv = async function () {
    const t0 = Date.now();
    const lines = new Array( CSV_ROWS + 1 );
    lines[ 0 ] = 'partitionId,ts,value';
    for ( let i = 0; i < CSV_ROWS; i += 1 ) {
        lines[ i + 1 ] = `csvReplay,${t0 + i},${( ( i % 10000 ) / 100 ).toFixed( 2 )}`;
    }
    await mkdir( path.dirname( CSV_PATH ), { recursive: true } );
    await writeFile( CSV_PATH, `${lines.join( '\n' )}\n` );
};

/** Polls the row count until it reaches `expected` or `maxMs` passes. */
const waitForRows = async function ( client, tableName, expected, maxMs ) {
    const start = Date.now();
    let count = 0;
    while ( ( Date.now() - start ) < maxMs ) {
        count = await countRows( client, tableName );
        if ( count >= expected ) {
            return count;
        }
        await sleep( 250 );
    }
    return count;
};

describe( 'QuestDB Hardening — a CSV replay at adapter defaults', function () {

    this.timeout( 120000 );

    let qdbUp = false;
    let pgClient = null;
    let capture = null;
    const tablesToCleanUp = [];

    before( async function () {
        qdbUp = await isQuestDBAvailable();
        if ( !qdbUp ) {
            console.log( '  [SKIP] QuestDB not available — start with `docker compose up -d`' );
            return;
        }
        pgClient = await createPgClient();
        await writeCsv();
    } );

    after( async function () {
        if ( pgClient ) {
            for ( const t of tablesToCleanUp ) {
                await dropTable( pgClient, t );
            }
            await pgClient.end();
        }
        await rm( CSV_PATH, { force: true } );
    } );

    beforeEach( function () {
        if ( !qdbUp ) this.skip();
    } );

    // A failed assertion must not leave later specs with a wrapped console.
    afterEach( function () {
        if ( capture ) {
            capture.restore();
            capture = null;
        }
    } );

    it( 'lands every row, sheds nothing, reports nothing', async function () {
        const tablePrefix = `${RUN_PREFIX}_defaults`;
        const tableName = `${tablePrefix}_samples`;
        tablesToCleanUp.push( tableName );

        capture = captureConsole();
        const deliveryFailures = [];
        let produced = 0;
        const started = Date.now();
        const handle = await flow( 'csvReplayDefaults' )
            .source( csv, { path: CSV_PATH, shutdownOnComplete: false } )
            .assetClass( assetClass )
            .storage( questdbAdapter, {
                ilpUrl: QUESTDB_ILP_URL,
                pgUrl: QUESTDB_PG_URL,
                tablePrefix,
                onDeliveryFailure: function ( err, ctx ) {
                    deliveryFailures.push( { message: err.message, ctx } );
                }
            } )
            .assetId( 'partitionId' )
            .persistIf( 'persist', function ( _msg ) {
                produced += 1;
                return true;
            }, { storageName: 'questdb', insightType: 'samples' } )
            .run();

        await handle.whenComplete();
        await handle.shutdown();
        const wallMs = Date.now() - started;
        const lines = capture.lines;
        capture.restore();
        capture = null;

        const landed = await waitForRows( pgClient, tableName, CSV_ROWS, 30000 );
        const storageFullLines = lines.filter( ( l ) => l.text.includes( 'STORAGE_FULL' ) );
        const adapterLines = lines.filter( ( l ) => l.text.includes( 'winkComposer/questdb' ) );

        console.log( '\n  [csv replay — adapter defaults]:' );
        console.log( `    rows in file:      ${CSV_ROWS}` );
        console.log( `    rows produced:     ${produced}` );
        console.log( `    rows landed:       ${landed}` );
        console.log( `    wall time:         ${wallMs} ms (${Math.round( ( CSV_ROWS / wallMs ) * 1000 )} rows/s to shutdown resolved)` );

        expect( produced ).to.equal( CSV_ROWS );
        expect( landed ).to.equal( CSV_ROWS );
        expect( deliveryFailures ).to.deep.equal( [] );
        expect( storageFullLines ).to.deep.equal( [] );
        expect( adapterLines ).to.deep.equal( [] );
    } );
} );

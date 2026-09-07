// core/storage-manager/questdb/test/slow-questdb-black-hole.specs.js

/**
 * @fileoverview A server that accepts the connection and never answers
 * (ADR-029). Hardening tier: runs under `npm run test:hardening`,
 * never under `npm test`.
 *
 * A black hole is the shape of an endpoint whose process is alive but
 * wedged: the TCP connect succeeds, the request is written, and no
 * response ever comes. It differs from a closed port in every way
 * that matters to the adapter. The request does not fail at once; it
 * waits. The client's own request timeout ends the attempt, and the
 * client retries inside its retry budget. Composer's flush deadline,
 * when shorter, fires first and reports the batch as abandoned. And
 * the ADR-030 probe, a TCP connect, PASSES against a black hole, so
 * delivery is not paused. Each later flush meets the hole in turn.
 *
 * Single flight bounds that. One request hangs at a time, the buffer
 * grows only to the ceiling, and the abandonment count grows by at
 * most one per deadline period. The handle count is one, whatever the
 * length of the outage. This leg pins each of those bounds, then
 * replaces the hole with the proxy and asserts recovery.
 *
 * What the client does after an abandonment matters for recovery. On
 * its request timeout the client destroys the request, which frees
 * the agent's one socket, so the next flush does not queue behind a
 * dead request for long. The leg measures the time from the return
 * to the first landed flush and prints it.
 *
 * Accounting stays a bound. A batch reported lost may still land when
 * the client's retry reaches the restored endpoint inside the retry
 * budget. So landed rows lie between produced minus reported and
 * produced, and no row lands twice.
 */

/* eslint-disable no-await-in-loop, no-invalid-this */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';

import { flow } from '../../../../composer.js';
import * as testHarness from '../../../source-manager/test-harness/index.js';
import { startProxy, stopProxy, startBlackHole } from '../../../test-utils/tcp-proxy.js';
import { storages as wireStorages } from '../../../wiring/index.js';
import questdbAdapter from '../index.js';
import {
    QUESTDB_PG_URL, QUESTDB_REAL_PORT, buildAssetClass, buildMessageTemplate,
    isQuestDBAvailable, createPgClient, dropTable, countRows, sleep, waitForHealth,
    captureConsole, adapterLinesOf
} from './slow-helpers.js';

const PROXY_PORT    = 19003;
const PROXY_ILP_URL = `127.0.0.1:${PROXY_PORT}`;
const RUN_PREFIX    = `hole_${Date.now()}`;

const SAMPLE_MS         = 100;
const FLUSH_INTERVAL_MS = 300;
const FLUSH_DEADLINE_MS = 1500;
const HOLE_MS           = 8000;

const assetClass = buildAssetClass( 'blackHole' );

describe( 'QuestDB Hardening — a server that accepts and never answers', function () {

    this.timeout( 120000 );

    let qdbUp = false;
    let pgClient = null;
    let proxy = null;
    let hole = null;
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
    } );

    beforeEach( function () {
        if ( !qdbUp ) this.skip();
    } );

    afterEach( async function () {
        if ( capture ) {
            capture.restore();
            capture = null;
        }
        if ( hole ) {
            await stopProxy( hole );
            hole = null;
        }
        if ( proxy ) {
            await stopProxy( proxy );
            proxy = null;
        }
    } );

    it( 'abandons at the deadline without pausing, one request at a time, and recovers when the server answers again', async function () {
        const tablePrefix = `${RUN_PREFIX}_hole`;
        const tableName = `${tablePrefix}_samples`;
        tablesToCleanUp.push( tableName );

        proxy = await startProxy( PROXY_PORT, QUESTDB_REAL_PORT );
        capture = captureConsole();

        const deliveryFailures = [];
        let produced = 0;
        const handle = await flow( 'blackHole' )
            .source( testHarness, {
                messageTemplate: buildMessageTemplate( 'blackHole', 1400, 20 ),
                assetClass,
                shutdownOnComplete: false
            } )
            .assetClass( assetClass )
            .storage( questdbAdapter, {
                ilpUrl: PROXY_ILP_URL,
                pgUrl: QUESTDB_PG_URL,
                tablePrefix,
                flushRows: 2000,
                flushIntervalMs: FLUSH_INTERVAL_MS,
                bufferCeilingRows: 2000,
                retryTimeout: 500,
                requestTimeout: 1000,
                flushDeadlineMs: FLUSH_DEADLINE_MS,
                onDeliveryFailure: function ( err, ctx ) {
                    deliveryFailures.push( { message: err.message, ctx, at: Date.now() } );
                }
            } )
            .assetId( 'partitionId' )
            .persistIf( 'persist', function ( _msg ) {
                produced += 1;
                return true;
            }, { storageName: 'questdb', insightType: 'samples' } )
            .run();

        const storage = Object.values( wireStorages.get() )[ 0 ];

        // Phase 1: a clean stretch with at least one landed flush.
        const baseline = await waitForHealth( storage, ( h ) => h.lastFlushAt !== null, 3000 );
        expect( baseline.status ).to.equal( 'green' );

        // Phase 2: the hole. Requests are accepted and never answered.
        await stopProxy( proxy );
        proxy = null;
        hole = await startBlackHole( PROXY_PORT );
        const holeStart = Date.now();
        const samples = [];
        while ( ( Date.now() - holeStart ) < HOLE_MS ) {
            samples.push( storage.getHealth() );
            await sleep( SAMPLE_MS );
        }
        const reportsInHole = deliveryFailures.length;

        // Phase 3: the server answers again.
        await stopProxy( hole );
        hole = null;
        proxy = await startProxy( PROXY_PORT, QUESTDB_REAL_PORT );
        const returnedAt = Date.now();
        const recovered = await waitForHealth(
            storage,
            ( h ) => h.status === 'green' && h.lastFlushAt > holeStart,
            15000
        );
        const recoveredAt = Date.now();

        await handle.whenComplete();
        await handle.shutdown();
        await sleep( 1500 );
        const landed = await countRows( pgClient, tableName );
        const lines = adapterLinesOf( capture.lines );
        capture.restore();
        capture = null;

        const rowsLost = deliveryFailures.reduce( ( sum, f ) => sum + f.ctx.rowsLost, 0 );
        const abandonedReports = deliveryFailures.filter( ( f ) => f.ctx.abandoned === true );
        const maxAbandoned = Math.max( ...samples.map( ( h ) => h.abandonedFlushes ) );
        const maxInFlight = Math.max( ...samples.map( ( h ) => h.inFlightRows ) );

        console.log( '\n  [black hole]:' );
        console.log( `    samples:               ${samples.length}` );
        console.log( `    reports in the hole:   ${reportsInHole} (${abandonedReports.length} abandoned in all)` );
        console.log( `    abandoned flushes:     ${maxAbandoned}` );
        console.log( `    largest in-flight:     ${maxInFlight} row(s)` );
        console.log( `    resumed after return:  ${recoveredAt - returnedAt} ms` );
        console.log( `    rows landed:           ${landed} of ${produced} (${rowsLost} reported lost)` );

        // The first loss is an abandonment at the deadline, and the
        // probe passed: the hole accepts connections.
        expect( reportsInHole ).to.be.at.least( 1 );
        expect( deliveryFailures[ 0 ].ctx.abandoned ).to.equal( true );
        expect( deliveryFailures[ 0 ].ctx.probe.ok ).to.equal( true );
        expect( deliveryFailures[ 0 ].message ).to.include( `${FLUSH_DEADLINE_MS} ms` );
        deliveryFailures.forEach( ( f ) => {
            expect( f.ctx.probe.ok, 'every probe passed against the hole' ).to.equal( true );
        } );

        // Never paused: pausedSince stays null in every sample. Red from
        // the first abandonment on.
        samples.forEach( ( h ) => {
            expect( h.pausedSince ).to.equal( null );
        } );
        const firstRed = samples.findIndex( ( h ) => h.status === 'red' );
        expect( firstRed, 'red after the first abandonment' ).to.be.at.least( 0 );
        samples.slice( firstRed ).forEach( ( h ) => {
            expect( h.status ).to.equal( 'red' );
            expect( h.connected ).to.equal( false );
        } );

        // Bounded: one request at a time, one abandonment per deadline
        // period at most, the buffer under the ceiling.
        const periods = Math.floor( HOLE_MS / FLUSH_DEADLINE_MS );
        expect( maxAbandoned ).to.be.at.least( 1 );
        expect( maxAbandoned ).to.be.at.most( periods + 1 );
        samples.forEach( ( h ) => {
            expect( h.bufferedRows + h.inFlightRows ).to.be.at.most( 2000 );
        } );
        // Rows arrive at 50 a second; one deadline period plus the
        // client's give-up holds under 200 of them.
        expect( maxInFlight ).to.be.at.most( 200 );

        // Recovery: green with a newer flush, inside a bounded delay.
        expect( recovered.status ).to.equal( 'green' );
        expect( recovered.connected ).to.equal( true );
        expect( recovered.pausedSince ).to.equal( null );
        expect( recoveredAt - returnedAt ).to.be.at.most( 5000 );

        // Accounting: a bound, no duplicates.
        expect( landed ).to.be.at.least( produced - rowsLost );
        expect( landed ).to.be.at.most( produced );

        // The log: red once at the first abandonment, restored once at
        // the end, never paused.
        expect( lines[ 0 ].level ).to.equal( 'error' );
        expect( lines[ 0 ].text ).to.include( 'delivery red after 1 failed flush(es) [DELIVERY_HEALTH]' );
        expect( lines.some( ( l ) => l.text.includes( '[CIRCUIT_OPEN]' ) ), 'no pause line' ).to.equal( false );
        const restored = lines.filter( ( l ) => l.text.includes( 'delivery restored' ) );
        expect( restored ).to.have.lengthOf( 1 );
        expect( restored[ 0 ].text ).to.include( `${rowsLost} row(s) reported lost meanwhile` );
    } );
} );

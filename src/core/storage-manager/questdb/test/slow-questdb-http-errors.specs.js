// core/storage-manager/questdb/test/slow-questdb-http-errors.specs.js

/**
 * @fileoverview A live server that answers every flush with an HTTP
 * error (ADR-029). Hardening tier: runs under `npm run test:hardening`,
 * never under `npm test`.
 *
 * The unit spec `http-error-responses.specs.js` pins composer's
 * response to the client's rejection. This spec drives the real
 * client against a real HTTP responder, so the client's own timing
 * is measured too. Two legs share one runner:
 *
 *   1. The responder answers 400. The client does not retry that
 *      code, so the flush is rejected at once, within one interval
 *      tick of the responder switching to answers.
 *   2. The responder answers 500. The client retries that code inside
 *      its retry budget, so the rejection arrives after at least
 *      `retryTimeout` and well before composer's deadline.
 *
 * The responder sits on the port for the whole leg. It forwards to
 * QuestDB while rows should land, and answers the error while they
 * should not. The switch happens on the live server, so no request
 * on the wire is ever reset. A port bounce would reset one, and the
 * client reports a reset as a socket error, not as the status. That
 * shape belongs to the outage specs, not here.
 *
 * In both legs the probe passes, because the responder accepts
 * connections, so delivery is never paused. Each tick's flush fails
 * in turn and the ladder climbs to red. When the responder forwards
 * again, the next flush lands and one restored line prints. The log
 * therefore reads: degraded, red, restored, and never a pause line.
 *
 * Accounting stays a bound: a batch reported lost may land when the
 * client's retry reaches the restored endpoint inside the retry
 * budget.
 */

/* eslint-disable no-await-in-loop, no-invalid-this */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';

import { flow } from '../../../../composer.js';
import * as testHarness from '../../../source-manager/test-harness/index.js';
import { stopProxy, startHttpResponder } from '../../../test-utils/tcp-proxy.js';
import { storages as wireStorages } from '../../../wiring/index.js';
import questdbAdapter from '../index.js';
import {
    QUESTDB_PG_URL, QUESTDB_REAL_PORT, buildAssetClass, buildMessageTemplate,
    isQuestDBAvailable, createPgClient, dropTable, countRows, sleep, waitForHealth,
    captureConsole, adapterLinesOf
} from './slow-helpers.js';

const RESPONDER_PORT    = 19006;
const RESPONDER_ILP_URL = `127.0.0.1:${RESPONDER_PORT}`;
const RUN_PREFIX        = `httperr_${Date.now()}`;

const FLUSH_INTERVAL_MS = 300;
const RETRY_TIMEOUT_MS  = 500;
const REQUEST_TIMEOUT_MS = 1000;

/** How long the responder holds the port: enough ticks for the ladder to reach red. */
const RESPONDER_MS = 3000;

const assetClass = buildAssetClass( 'httpError' );

describe( 'QuestDB Hardening — a server that answers with an HTTP error', function () {

    this.timeout( 120000 );

    let qdbUp = false;
    let pgClient = null;
    let responder = null;
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
        if ( responder ) {
            await stopProxy( responder );
            responder = null;
        }
    } );

    /** Polls until `count()` holds or `maxMs` passes. */
    const waitFor = async function ( condition, maxMs ) {
        const start = Date.now();
        while ( !condition() && ( ( Date.now() - start ) < maxMs ) ) {
            await sleep( 20 );
        }
        return condition();
    };

    /** Runs one responder episode and returns every fact the assertions need. */
    const runResponder = async function ( opts ) {
        const tablePrefix = `${RUN_PREFIX}_${opts.statusCode}`;
        const tableName = `${tablePrefix}_samples`;
        tablesToCleanUp.push( tableName );

        // The responder forwards to QuestDB until the episode begins.
        responder = await startHttpResponder( RESPONDER_PORT, opts.statusCode );
        responder.forwardTo( QUESTDB_REAL_PORT );
        capture = captureConsole();

        const deliveryFailures = [];
        let produced = 0;
        const handle = await flow( opts.flowName )
            .source( testHarness, {
                messageTemplate: buildMessageTemplate( 'httpError', 700, 20 ),
                assetClass,
                shutdownOnComplete: false
            } )
            .assetClass( assetClass )
            .storage( questdbAdapter, {
                ilpUrl: RESPONDER_ILP_URL,
                pgUrl: QUESTDB_PG_URL,
                tablePrefix,
                flushRows: 2000,
                flushIntervalMs: FLUSH_INTERVAL_MS,
                bufferCeilingRows: 4000,
                retryTimeout: RETRY_TIMEOUT_MS,
                requestTimeout: REQUEST_TIMEOUT_MS,
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
        const baseline = await waitForHealth( storage, ( h ) => h.lastFlushAt !== null, 3000 );

        // The responder answers the error from here. Time the first
        // rejection from this instant.
        responder.answerWith( opts.statusCode );
        const responderStart = Date.now();
        const reported = await waitFor( () => deliveryFailures.length >= 1, 5000 );
        const firstReportAfterMs = deliveryFailures.length ? ( deliveryFailures[ 0 ].at - responderStart ) : null;

        // Hold the responder long enough for the ladder to reach red,
        // sampling health meanwhile.
        const samples = [];
        while ( ( Date.now() - responderStart ) < RESPONDER_MS ) {
            samples.push( storage.getHealth() );
            await sleep( 50 );
        }

        // The responder forwards to QuestDB again.
        responder.forwardTo( QUESTDB_REAL_PORT );
        const returnedAt = Date.now();
        const recovered = await waitForHealth(
            storage,
            ( h ) => h.status === 'green' && h.lastFlushAt > responderStart,
            10000
        );
        const recoveredAt = Date.now();

        await handle.whenComplete();
        await handle.shutdown();
        await sleep( 1500 );
        const landed = await countRows( pgClient, tableName );
        const lines = adapterLinesOf( capture.lines );
        capture.restore();
        capture = null;

        return {
            baseline,
            reported,
            firstReportAfterMs,
            samples,
            recovered,
            recoveredAt,
            returnedAt,
            deliveryFailures,
            produced,
            landed,
            lines
        };
    };

    /** The assertions both legs share. */
    const assertErrorAnswerTruth = function ( opts, result ) {
        const rowsLost = result.deliveryFailures.reduce( ( sum, f ) => sum + f.ctx.rowsLost, 0 );

        console.log( `\n  [http error — ${opts.statusCode}]:` );
        console.log( `    first report after:   ${result.firstReportAfterMs} ms` );
        console.log( `    reports:              ${result.deliveryFailures.length} (${rowsLost} row(s) reported lost)` );
        console.log( `    resumed after return: ${result.recoveredAt - result.returnedAt} ms` );
        console.log( `    rows landed:          ${result.landed} of ${result.produced}` );

        expect( result.baseline.status ).to.equal( 'green' );
        expect( result.reported, 'the first flush into the responder was reported' ).to.equal( true );

        // Every report: the client's message with the status, not
        // abandoned, and a passing probe.
        result.deliveryFailures.forEach( ( f ) => {
            expect( f.message ).to.include( `statusCode=${opts.statusCode}` );
            expect( f.ctx.abandoned ).to.equal( false );
            expect( f.ctx.probe.ok ).to.equal( true );
        } );

        // Never paused; red by the ladder once two flushes failed in a row.
        result.samples.forEach( ( h ) => {
            expect( h.pausedSince ).to.equal( null );
            expect( h.abandonedFlushes ).to.equal( 0 );
        } );
        const last = result.samples[ result.samples.length - 1 ];
        expect( last.status ).to.equal( 'red' );
        expect( last.connected ).to.equal( false );
        expect( last.consecutiveFlushFailures ).to.be.at.least( 2 );

        // Recovery and accounting.
        expect( result.recovered.status ).to.equal( 'green' );
        expect( result.recovered.consecutiveFlushFailures ).to.equal( 0 );
        expect( result.landed ).to.be.at.least( result.produced - rowsLost );
        expect( result.landed ).to.be.at.most( result.produced );

        // The log: degraded, red, restored, and never a pause line.
        const texts = result.lines.map( ( l ) => l.text );
        expect( texts[ 0 ] ).to.include( 'delivery degraded, 1 flush failed [DELIVERY_HEALTH]' );
        expect( texts[ 1 ] ).to.include( 'delivery red after 2 failed flush(es) [DELIVERY_HEALTH]' );
        expect( texts[ texts.length - 1 ] ).to.include( `${rowsLost} row(s) reported lost meanwhile [DELIVERY_HEALTH]` );
        expect( texts.some( ( t ) => t.includes( '[CIRCUIT_OPEN]' ) ), 'no pause line' ).to.equal( false );
        expect( result.lines ).to.have.lengthOf( 3 );
    };

    it( '400: the client rejects at once, composer reports the batch and carries on', async function () {
        const opts = { flowName: 'httpError400', statusCode: 400 };
        const result = await runResponder( opts );
        assertErrorAnswerTruth( opts, result );
        // At once: before one retry budget could have passed. The 500
        // leg below cannot report earlier than that budget, so this
        // bound is what tells the two apart (measured 250 ms).
        expect( result.firstReportAfterMs ).to.be.lessThan( RETRY_TIMEOUT_MS );
    } );

    it( '500: the client retries inside its budget first, then composer reports the batch', async function () {
        const opts = { flowName: 'httpError500', statusCode: 500 };
        const result = await runResponder( opts );
        assertErrorAnswerTruth( opts, result );
        // After the retry budget, measured from the responder switching
        // to answers, and well before any deadline could fire.
        expect( result.firstReportAfterMs ).to.be.at.least( RETRY_TIMEOUT_MS );
        expect( result.firstReportAfterMs ).to.be.lessThan( FLUSH_INTERVAL_MS + RETRY_TIMEOUT_MS + 1500 );
    } );
} );

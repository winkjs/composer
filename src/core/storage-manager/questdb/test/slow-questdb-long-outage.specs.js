// core/storage-manager/questdb/test/slow-questdb-long-outage.specs.js

/**
 * @fileoverview Outages that outlast every timeout (ADR-029).
 * Hardening tier: runs under `npm run test:hardening`, never under
 * `npm test`.
 *
 * The run-5 soak failed on an endpoint that never returned, at plant
 * rate, while the adapter reported green and memory grew without
 * bound. The health-outage spec proves the first seconds of such an
 * outage. This spec proves the rest. Three legs share one runner:
 *
 *   1. The endpoint returns after every budget has passed. The pause
 *      holds the whole time: one batch is reported lost at the cut,
 *      no flush starts while paused, so the deadline never fires and
 *      nothing is abandoned. Delivery resumes at the first tick after
 *      the return.
 *   2. The endpoint never returns, at plant rate. Rows are held up to
 *      the ceiling, memory stays flat, and shutdown reports the held
 *      rows as dropped with a classified error.
 *   3. The endpoint never returns, at a sustained rate. The buffer
 *      fills to the ceiling, new rows are shed with `STORAGE_FULL`,
 *      pressure reads 1 for the rest of the outage, and memory stays
 *      flat.
 *
 * Hold and probe is what makes an outage cost one batch, whatever its
 * length. After the first failed flush the probe finds the port
 * refused and delivery pauses. While paused no flush starts, so no
 * request can hang to its deadline, and each interval tick probes
 * instead. `pausedSince` therefore holds one value from the pause to
 * the resume, and `abandonedFlushes` stays 0. Both are asserted.
 *
 * Memory is asserted as medians of thirds, the way the soak spec does
 * it, with absolute bounds instead of a ratio: the late-third median
 * of RSS may exceed the early-third median by at most 16 MB, and heap
 * by at most 4 MB. The held buffer is small in these legs by design,
 * so the bounds are tight. Heap is measured after `global.gc()`, which
 * the hardening runner exposes; without it only RSS is bounded.
 *
 * Shutdown truth. The adapter's drain rejects with `DELIVERY_FAILED`
 * carrying `dropped.count`, the exact rows it could not deliver. The
 * flow handle must carry that rejection to its caller, because the
 * process exit code depends on it (the 2026-08-29 exit-1 ruling,
 * ADR-018 §7). These legs assert it on the handle.
 *
 * Nothing lands after the cut when the endpoint never returns. The
 * batch on the wire at the cut may still land, when the server
 * committed it before the client saw the reset, so the row count is
 * read one second after the cut and must not move again.
 */

/* eslint-disable no-await-in-loop, no-invalid-this */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';

import { flow } from '../../../../composer.js';
import * as testHarness from '../../../source-manager/test-harness/index.js';
import { startProxy, stopProxy } from '../../../test-utils/tcp-proxy.js';
import { storages as wireStorages } from '../../../wiring/index.js';
import questdbAdapter from '../index.js';
import {
    QUESTDB_PG_URL, QUESTDB_REAL_PORT, buildAssetClass, buildMessageTemplate,
    isQuestDBAvailable, createPgClient, dropTable, countRows, sleep, waitForHealth,
    captureConsole, adapterLinesOf, median, takeSample, formatMb
} from './slow-helpers.js';

const PROXY_PORT        = 19002;
const PROXY_ILP_URL     = `127.0.0.1:${PROXY_PORT}`;
const RUN_PREFIX        = `longout_${Date.now()}`;

/** Sampling period for health and memory during the outage. */
const SAMPLE_MS = 250;

/** The interval timer, which is also the probe cadence while paused. */
const FLUSH_INTERVAL_MS = 300;

/** How much the late-third median may exceed the early-third median. */
const RSS_GROWTH_BOUND_BYTES  = 16 * 1024 * 1024;
const HEAP_GROWTH_BOUND_BYTES = 4 * 1024 * 1024;

const assetClass = buildAssetClass( 'longOutage' );

// ============================================================================
// TEST
// ============================================================================

describe( 'QuestDB Hardening — outages that outlast every timeout', function () {

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
     * Runs one outage and returns every fact the assertions need.
     * `opts.returns` decides whether the proxy comes back; when it does
     * not, the flow is shut down into the dead endpoint and the
     * handle's rejection is captured, not thrown.
     */
    const runLongOutage = async function ( opts ) {
        const tableName = `${opts.tablePrefix}_samples`;
        tablesToCleanUp.push( tableName );

        proxy = await startProxy( PROXY_PORT, QUESTDB_REAL_PORT );
        capture = captureConsole();

        const deliveryFailures = [];
        let produced = 0;
        const handle = await flow( opts.flowName )
            .source( testHarness, {
                messageTemplate: buildMessageTemplate( 'longOutage', opts.messageCount, opts.intervalMs ),
                assetClass,
                shutdownOnComplete: false
            } )
            .assetClass( assetClass )
            .storage( questdbAdapter, {
                ilpUrl: PROXY_ILP_URL,
                pgUrl: QUESTDB_PG_URL,
                tablePrefix: opts.tablePrefix,
                flushRows: opts.flushRows,
                flushIntervalMs: FLUSH_INTERVAL_MS,
                bufferCeilingRows: opts.bufferCeilingRows,
                retryTimeout: opts.retryTimeout,
                requestTimeout: opts.requestTimeout,
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

        const storages = Object.values( wireStorages.get() );
        expect( storages, 'one wired storage' ).to.have.lengthOf( 1 );
        const storage = storages[ 0 ];

        // Phase 1: a clean stretch, long enough for at least one flush.
        const baseline = await waitForHealth( storage, ( h ) => h.lastFlushAt !== null, 3000 );

        // Phase 2: the outage. Sample health and memory while it lasts.
        // The row count one second in includes the fate of the batch
        // that was on the wire at the cut.
        await stopProxy( proxy );
        proxy = null;
        const outageStart = Date.now();
        const samples = [];
        let landedAfterCut = null;
        while ( ( Date.now() - outageStart ) < opts.outageMs ) {
            samples.push( takeSample( storage ) );
            if ( ( landedAfterCut === null ) && ( ( Date.now() - outageStart ) >= 1000 ) ) {
                landedAfterCut = await countRows( pgClient, tableName );
            }
            await sleep( SAMPLE_MS );
        }

        // Phase 3: the endpoint returns, or it does not.
        let returnedAt = null;
        let recovered = null;
        let recoveredAt = null;
        if ( opts.returns ) {
            proxy = await startProxy( PROXY_PORT, QUESTDB_REAL_PORT );
            returnedAt = Date.now();
            recovered = await waitForHealth(
                storage,
                ( h ) => h.status === 'green' && h.lastFlushAt > outageStart,
                10000
            );
            recoveredAt = Date.now();
        }

        // Phase 4: shut the flow down. Into a dead endpoint the drain
        // must reject; the rejection is captured for the assertions.
        const heldBeforeShutdown = storage.getHealth().bufferedRows;
        const producedBeforeShutdown = produced;
        let shutdownError = null;
        await handle.shutdown().catch( function ( err ) {
            shutdownError = err;
        } );
        await sleep( 1500 );
        const landed = await countRows( pgClient, tableName );
        const lines = capture.lines;
        capture.restore();
        capture = null;

        return {
            baseline,
            samples,
            landedAfterCut,
            returnedAt,
            recovered,
            recoveredAt,
            heldBeforeShutdown,
            producedBeforeShutdown,
            produced,
            shutdownError,
            deliveryFailures,
            landed,
            outageStart,
            lines
        };
    };

    /** The adapter's own lines, in order. */
    const adapterLines = function ( result ) {
        return adapterLinesOf( result.lines );
    };

    /** The pause holds: one value of pausedSince, red throughout, nothing abandoned. */
    const assertPauseHeld = function ( samples ) {
        const paused = samples.filter( ( s ) => s.health.pausedSince !== null );
        expect( paused.length, 'paused samples' ).to.be.greaterThan( samples.length / 2 );
        const firstPaused = samples.findIndex( ( s ) => s.health.pausedSince !== null );
        const afterPause = samples.slice( firstPaused );
        const distinct = new Set( afterPause.map( ( s ) => s.health.pausedSince ) );
        expect( distinct.size, 'one pausedSince value from the pause on' ).to.equal( 1 );
        afterPause.forEach( ( s ) => {
            expect( s.health.status ).to.equal( 'red' );
            expect( s.health.connected ).to.equal( false );
        } );
        samples.forEach( ( s ) => {
            expect( s.health.abandonedFlushes ).to.equal( 0 );
            expect( s.health.inFlightRows ).to.equal( 0 );
        } );
        return firstPaused;
    };

    /** Memory holds: late-third medians within the absolute bounds. */
    const assertMemoryFlat = function ( samples, label ) {
        const third = Math.floor( samples.length / 3 );
        expect( third, 'enough samples for thirds' ).to.be.at.least( 4 );
        const earlyRss = median( samples.slice( 0, third ).map( ( s ) => s.rss ) );
        const lateRss  = median( samples.slice( -third ).map( ( s ) => s.rss ) );
        console.log( `    early/late median rss:   ${formatMb( earlyRss )} / ${formatMb( lateRss )}` );
        expect( lateRss - earlyRss, `${label}: rss growth over the outage` ).to.be.lessThan( RSS_GROWTH_BOUND_BYTES );
        const gcEverywhere = samples.every( ( s ) => s.gcRan );
        if ( gcEverywhere ) {
            const earlyHeap = median( samples.slice( 0, third ).map( ( s ) => s.heap ) );
            const lateHeap  = median( samples.slice( -third ).map( ( s ) => s.heap ) );
            console.log( `    early/late median heap:  ${formatMb( earlyHeap )} / ${formatMb( lateHeap )}` );
            expect( lateHeap - earlyHeap, `${label}: heap growth over the outage` ).to.be.lessThan( HEAP_GROWTH_BOUND_BYTES );
        } else {
            console.log( '    heap bound skipped: run with --expose-gc (the hardening runner does)' );
        }
    };

    /** A dead endpoint at shutdown: the handle rejects with the exact drop. */
    const assertShutdownIntoDeadEndpoint = function ( result, ceiling ) {
        expect( result.shutdownError, 'the flow drain rejects on a storage loss (ADR-018 §7)' ).to.not.equal( null );
        expect( result.shutdownError.code ).to.equal( 'DELIVERY_FAILED' );
        expect( result.shutdownError.dropped.count ).to.be.at.least( result.heldBeforeShutdown );
        expect( result.shutdownError.dropped.count ).to.be.at.most( ceiling );
        const wiringLines = result.lines.filter( ( l ) => l.text.includes( 'storage \'questdb\' shutdown failed [DELIVERY_FAILED]' ) );
        expect( wiringLines, 'the wiring names the storage once' ).to.have.lengthOf( 1 );
        // Nothing landed after the cut.
        expect( result.landed ).to.equal( result.landedAfterCut );
    };

    it( 'returns after every budget: the pause holds, nothing is abandoned, one batch is lost', async function () {
        // retryTimeout and requestTimeout of one second each put the
        // client's own give-up at about two seconds and the derived
        // deadline near seven. Twelve seconds outlasts them all.
        const opts = {
            flowName: 'longOutageReturns',
            tablePrefix: `${RUN_PREFIX}_returns`,
            messageCount: 400,
            intervalMs: 50,
            flushRows: 2000,
            bufferCeilingRows: 2000,
            retryTimeout: 1000,
            requestTimeout: 1000,
            outageMs: 12000,
            returns: true
        };
        const result = await runLongOutage( opts );
        const rowsLost = result.deliveryFailures.reduce( ( sum, f ) => sum + f.ctx.rowsLost, 0 );

        console.log( '\n  [long outage — returns after every budget]:' );
        console.log( `    samples:              ${result.samples.length}` );
        console.log( `    delivery failures:    ${result.deliveryFailures.length} (${rowsLost} row(s) reported lost)` );
        console.log( `    resumed after return: ${result.recoveredAt - result.returnedAt} ms` );
        console.log( `    rows landed:          ${result.landed} of ${result.produced}` );

        expect( result.baseline.status ).to.equal( 'green' );
        assertPauseHeld( result.samples );

        expect( result.deliveryFailures ).to.have.lengthOf( 1 );
        expect( result.deliveryFailures[ 0 ].ctx.abandoned ).to.equal( false );
        expect( result.deliveryFailures[ 0 ].ctx.probe.ok ).to.equal( false );

        // Resumed within two ticks of the return, then a clean drain.
        expect( result.recovered.status ).to.equal( 'green' );
        expect( result.recovered.pausedSince ).to.equal( null );
        expect( result.recovered.abandonedFlushes ).to.equal( 0 );
        expect( result.recoveredAt - result.returnedAt ).to.be.at.most( ( 2 * FLUSH_INTERVAL_MS ) + 900 );
        expect( result.shutdownError ).to.equal( null );

        // Accounting: a bound, because a batch reported lost may land.
        expect( result.landed ).to.be.at.least( result.produced - rowsLost );
        expect( result.landed ).to.be.at.most( result.produced );

        const lines = adapterLines( result );
        expect( lines.map( ( l ) => l.level ) ).to.deep.equal( [ 'warn', 'warn', 'warn', 'warn' ] );
        expect( lines[ 0 ].text ).to.include( 'delivery degraded, 1 flush failed [DELIVERY_HEALTH]' );
        expect( lines[ 1 ].text ).to.include( 'delivery paused' );
        expect( lines[ 2 ].text ).to.include( 'delivery resumed' );
        expect( lines[ 3 ].text ).to.include( `${rowsLost} row(s) reported lost meanwhile [DELIVERY_HEALTH]` );
    } );

    it( 'never returns at plant rate: rows held under the ceiling, memory flat, shutdown reports the exact drop', async function () {
        const opts = {
            flowName: 'longOutageNeverPlant',
            tablePrefix: `${RUN_PREFIX}_never_plant`,
            messageCount: 600,
            intervalMs: 50,
            flushRows: 2000,
            bufferCeilingRows: 2000,
            retryTimeout: 1000,
            requestTimeout: 1000,
            outageMs: 15000,
            returns: false
        };
        const result = await runLongOutage( opts );

        console.log( '\n  [long outage — never returns, plant rate]:' );
        console.log( `    samples:              ${result.samples.length}` );
        console.log( `    delivery failures:    ${result.deliveryFailures.length}` );
        console.log( `    held before shutdown: ${result.heldBeforeShutdown}` );
        console.log( `    dropped at shutdown:  ${result.shutdownError ? result.shutdownError.dropped.count : 'no rejection'}` );
        console.log( `    rows landed:          ${result.landed} (after the cut: ${result.landedAfterCut})` );

        expect( result.baseline.status ).to.equal( 'green' );
        const firstPaused = assertPauseHeld( result.samples );
        expect( result.deliveryFailures ).to.have.lengthOf( 1 );
        expect( result.deliveryFailures[ 0 ].ctx.abandoned ).to.equal( false );

        // The buffer only grows while paused, and never past the ceiling.
        const held = result.samples.slice( firstPaused ).map( ( s ) => s.health.bufferedRows );
        held.forEach( ( rows, i ) => {
            expect( rows ).to.be.at.most( opts.bufferCeilingRows );
            if ( i > 0 ) {
                expect( rows ).to.be.at.least( held[ i - 1 ] );
            }
        } );
        expect( held[ held.length - 1 ], 'rows were held' ).to.be.greaterThan( 0 );
        expect( Math.max( ...result.samples.map( ( s ) => s.health.pressure ) ) ).to.be.lessThan( 1 );

        assertMemoryFlat( result.samples, 'plant rate' );
        assertShutdownIntoDeadEndpoint( result, opts.bufferCeilingRows );

        const lines = adapterLines( result );
        expect( lines[ 0 ].text ).to.include( 'delivery degraded, 1 flush failed [DELIVERY_HEALTH]' );
        expect( lines[ 1 ].text ).to.include( 'delivery paused' );
        expect( lines.some( ( l ) => l.text.includes( 'delivery resumed' ) ) ).to.equal( false );
        expect( lines.some( ( l ) => l.text.includes( 'delivery restored' ) ) ).to.equal( false );
    } );

    it( 'never returns at a sustained rate: the ceiling holds, shedding is visible, memory flat', async function () {
        // One millisecond between rows is the harness floor, about a
        // thousand rows a second on a laptop. The ceiling of 500 fills
        // within the first second of the outage.
        const opts = {
            flowName: 'longOutageNeverSustained',
            tablePrefix: `${RUN_PREFIX}_never_sustained`,
            messageCount: 40000,
            intervalMs: 1,
            flushRows: 100,
            bufferCeilingRows: 500,
            retryTimeout: 1000,
            requestTimeout: 1000,
            outageMs: 10000,
            returns: false
        };
        const result = await runLongOutage( opts );

        console.log( '\n  [long outage — never returns, sustained rate]:' );
        console.log( `    samples:              ${result.samples.length}` );
        console.log( `    produced:             ${result.produced}` );
        console.log( `    delivery failures:    ${result.deliveryFailures.length}` );
        console.log( `    held before shutdown: ${result.heldBeforeShutdown}` );
        console.log( `    dropped at shutdown:  ${result.shutdownError ? result.shutdownError.dropped.count : 'no rejection'}` );
        console.log( `    rows landed:          ${result.landed} (after the cut: ${result.landedAfterCut})` );

        expect( result.baseline.status ).to.equal( 'green' );
        assertPauseHeld( result.samples );
        expect( result.deliveryFailures ).to.have.lengthOf( 1 );
        expect( result.deliveryFailures[ 0 ].ctx.abandoned ).to.equal( false );

        // The ceiling holds, and once reached pressure stays at 1.
        result.samples.forEach( ( s ) => {
            expect( s.health.bufferedRows ).to.be.at.most( opts.bufferCeilingRows );
        } );
        const firstFull = result.samples.findIndex( ( s ) => s.health.pressure >= 1 );
        expect( firstFull, 'the ceiling was reached' ).to.be.at.least( 0 );
        expect( firstFull, 'reached early in the outage' ).to.be.lessThan( result.samples.length / 3 );
        result.samples.slice( firstFull ).forEach( ( s ) => {
            expect( s.health.pressure ).to.equal( 1 );
            expect( s.health.bufferedRows ).to.equal( opts.bufferCeilingRows );
        } );

        assertMemoryFlat( result.samples, 'sustained rate' );
        assertShutdownIntoDeadEndpoint( result, opts.bufferCeilingRows );

        const lines = adapterLines( result );
        expect( lines[ 0 ].text ).to.include( 'delivery degraded, 1 flush failed [DELIVERY_HEALTH]' );
        expect( lines[ 1 ].text ).to.include( 'delivery paused' );
        const shedding = lines.filter( ( l ) => l.text.includes( 'shedding began' ) );
        expect( shedding, 'the shedding edge once' ).to.have.lengthOf( 1 );
        expect( shedding[ 0 ].text ).to.include( `ceiling of ${opts.bufferCeilingRows} rows [STORAGE_FULL]` );
        expect( lines.some( ( l ) => l.text.includes( 'delivery resumed' ) ) ).to.equal( false );
    } );
} );

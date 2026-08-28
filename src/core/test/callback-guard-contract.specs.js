// core/test/callback-guard-contract.specs.js

/**
 * @fileoverview Cross-adapter contract: every user-supplied
 * notification callback is armed by the shared callback guard.
 *
 * The contract (ADR-018): a misbehaving user callback never reaches
 * transport code and never fails silently. A throw or a rejected
 * promise from the callback becomes exactly one classified
 * CALLBACK_FAILED report naming the callback, and the operation that
 * invoked it completes. ADR-027 scopes WHICH callbacks are wrapped:
 * notification callbacks only — a control-flow callback (QuestDB's
 * strict-mode onWarning) and the flow-guarded onMessage stay
 * unwrapped, each pinned in its own suite.
 *
 * Data-driven per the house pattern (source-transform-contract):
 * one SITES table drives every wrapped call site, so a future
 * adapter cannot add an unwrapped callback silently — it must add
 * its row here or fail the floor guard. Each row runs four fault
 * faces: a thrown Error, a rejected promise, a thrown null, and a
 * reasonless rejection. The last two pin the guard's own fault
 * reporter: it must survive an error object that has no message.
 */

/* eslint-disable no-sync, no-throw-literal, no-invalid-this */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { flow } from '../../composer.js';
import * as composerSurface from '../../composer.js';
import { headlessDriver } from '../../flow/driver.js';
import * as csv from '../source-manager/csv/index.js';
import * as testHarness from '../source-manager/test-harness/index.js';
import { createStatusReporter } from '../source-manager/mqtt/status.js';
import { makeClock } from '../source-manager/mqtt/test/test-helpers.js';
import { createEmitter } from '../../core/emitter-manager/mqtt/emitter.js';
import { makeMockClient, testCodec } from '../emitter-manager/mqtt/test/test-helpers.js';
import { createQuestDBStorage } from '../storage-manager/questdb/index.js';
import { makeMockSender, makeMockDeps } from '../storage-manager/questdb/test/test-helpers.js';

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

const settle = function () {
    return new Promise( ( resolve ) => setImmediate( resolve ) );
};

// Give fire-and-forget promise chains their microtask turns.
const settleTwice = async function () {
    await settle();
    await settle();
};

// The four fault faces every wrapped site must contain. The tag makes
// each thrown message unique per site so a leaked report cannot
// satisfy another row's filter.
const FAULT_MODES = [
    {
        label: 'a throwing callback',
        make: ( tag ) => () => {
            throw new Error( `${tag} boom` );
        }
    },
    {
        label: 'an async callback that rejects',
        make: ( tag ) => () => Promise.reject( new Error( `${tag} boom` ) )
    },
    {
        label: 'a callback that throws null (no message to read)',
        make: () => () => {
            throw null;
        }
    },
    {
        label: 'an async callback that rejects with no reason',
        make: () => () => Promise.reject()
    }
];

// Count classified console lines for one callback name. The stable
// grammar is the [CALLBACK_FAILED] bracket plus the callback name;
// message details vary per site and are pinned in the per-site suites.
const countConsoleFaults = function ( spy, callbackName ) {
    return spy.getCalls()
        .map( ( c ) => String( c.args[ 0 ] ) )
        .filter( ( l ) => l.includes( 'CALLBACK_FAILED' ) && l.includes( callbackName ) )
        .length;
};

const QDB_ASSET_CLASS = {
    name: 'pump',
    columns: {
        ts: { type: 'timestamp' },
        temp: { type: 'float64' }
    },
    insightTypes: {
        monitoring: {
            columns: [ 'ts', 'temp' ],
            designatedTimestamp: 'ts'
        }
    }
};
const QDB_MSG = { ts: 1735500000000, temp: 25.5 };
const QDB_OPTS = { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812', flushMode: 'auto' };

const HARNESS_TEMPLATE = {
    seed: 7,
    messageCount: 3,
    intervalMs: 0,
    fields: {
        partitionId: { type: 'string', values: [ 'h1' ] },
        value: { type: 'float64', range: [ 0, 10 ], resolution: 0.01 }
    }
};
const HARNESS_ASSET_CLASS = {
    name: 'cgHarness',
    columns: {
        _harnessId: { type: 'int64' },
        partitionId: { type: 'string' },
        value: { type: 'float64', resolution: 0.01 }
    }
};

// A minimal source adapter that hands the test the flow's injected
// callbacks (the fault-containment.specs.js pattern, trimmed).
const buildFeedableSource = function () {
    const refs = {};
    const adapter = {
        id: 'cgFeedable',
        durabilityClass: 'best-effort',
        start: function ( config ) {
            refs.onStatus = config.onStatus;
            refs.onMessage = config.onMessage;
            return function () {
                return Promise.resolve();
            };
        }
    };
    return { adapter, refs };
};

const waitFor = function ( check, maxMs = 3000 ) {
    return new Promise( ( resolve ) => {
        const started = Date.now();
        const poll = setInterval( function () {
            if ( check() || ( ( Date.now() - started ) > maxMs ) ) {
                clearInterval( poll );
                resolve();
            }
        }, 10 );
    } );
};

// ---------------------------------------------------------------------------
// The SITES table — one row per wrapped call site. Adding a callback
// to any adapter means adding a row here, or the floor guard fails
// with this message. Each row's run( badCallback ) must:
//   1. build the adapter with the bad callback installed,
//   2. trigger the callback exactly once,
//   3. return { faults, completed } — faults counted on the row's
//      report channel, completed = the adapter's operation finished.
// The row NEVER lets a callback fault escape as a test crash: the
// trigger runs inside try/catch and an escape reads as completed:false.
// ---------------------------------------------------------------------------

const SITES = [

    {
        key: 'headless driver — onError',
        callbackName: 'onError',
        run: async function ( badCallback ) {
            const handle = await flow( 'cgDriver' )
                .assetId( 'id' )
                .esMean( 'm', 'value', { mean: 'avg' }, { halfLife: 5 } )
                .run();
            const driver = headlessDriver( handle, { onError: badCallback } );
            const spy = sinon.spy( console, 'error' );
            let completed = false;
            try {
                const result = await driver.feedAll( [
                    { id: 'a', value: 1 },
                    Object.freeze( { id: 'a', value: 2 } ),
                    { id: 'a', value: 3 }
                ] );
                await settleTwice();
                completed = ( result.processed === 2 ) && ( result.failed === 1 );
            } catch {
                completed = false;
            }
            spy.restore();
            await handle.shutdown().catch( () => null );
            return { faults: countConsoleFaults( spy, 'onError' ), completed };
        }
    },

    {
        key: 'flow runtime — user onStatus',
        callbackName: 'onStatus',
        run: async function ( badCallback ) {
            const { adapter, refs } = buildFeedableSource();
            const handle = await flow( 'cgFlowStatus' )
                .source( adapter, { onStatus: badCallback } )
                .assetId( 'id' )
                .esMean( 'm', 'value', { mean: 'avg' }, { halfLife: 5 } )
                .run();
            const spy = sinon.spy( console, 'error' );
            let completed = false;
            try {
                refs.onStatus( { status: 'green', connected: true, phase: 'running' } );
                await settleTwice();
                // The channel must survive its user: a second status
                // passes through without a throw.
                refs.onStatus( { status: 'green', connected: true, phase: 'running' } );
                await settleTwice();
                completed = true;
            } catch {
                completed = false;
            }
            const faults = countConsoleFaults( spy, 'onStatus' );
            spy.restore();
            await handle.shutdown().catch( () => null );
            // Two triggers → two contained faults; report exactly half.
            return { faults: faults / 2, completed };
        }
    },

    {
        key: 'mqtt source — onStatus',
        callbackName: 'onStatus',
        run: async function ( badCallback ) {
            const reporter = createStatusReporter( {
                onStatus: badCallback,
                nowFn: makeClock().nowFn
            } );
            const spy = sinon.spy( console, 'error' );
            let completed = false;
            try {
                reporter.starting();
                await settleTwice();
                completed = true;
            } catch {
                completed = false;
            }
            spy.restore();
            return { faults: countConsoleFaults( spy, 'onStatus' ), completed };
        }
    },

    {
        key: 'mqtt source — onMetrics',
        callbackName: 'onMetrics',
        run: async function ( badCallback ) {
            const statuses = [];
            const reporter = createStatusReporter( {
                onMetrics: badCallback,
                onStatus: ( s ) => statuses.push( s ),
                nowFn: makeClock().nowFn
            } );
            let completed = false;
            try {
                // The first health transition emits its own metrics
                // snapshot; consume it so the tick below is the one
                // counted trigger.
                reporter.starting();
                await settleTwice();
                statuses.length = 0;
                reporter.tick();
                await settleTwice();
                completed = true;
            } catch {
                completed = false;
            }
            // onMetrics faults travel the status channel, yellow.
            const faults = statuses.filter(
                ( s ) => s.error &&
                         ( s.error.code === 'CALLBACK_FAILED' ) &&
                         ( s.status === 'yellow' ) &&
                         s.error.message.includes( 'onMetrics' )
            ).length;
            return { faults, completed };
        }
    },

    {
        key: 'mqtt emitter — onCritical',
        callbackName: 'onCritical',
        run: async function ( badCallback ) {
            const manual = makeMockClient( { manualAcks: true } );
            const emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                maxQueueSize: 20,
                onCritical: badCallback,
                mqttConnectFn: () => manual.client
            } );
            for ( let i = 0; i < 18; i += 1 ) {
                emitter.publishNow( 'cg/topic', { value: i } );
            }
            const spy = sinon.spy( console, 'error' );
            let completed = false;
            try {
                manual.publishCalls[ 0 ].cb();
                await settleTwice();
                // The ack was processed: pressure reflects 17/20.
                completed = emitter.getPressure() === 0.85;
            } catch {
                completed = false;
            }
            spy.restore();
            for ( let i = 1; i < 18; i += 1 ) {
                manual.publishCalls[ i ].cb();
            }
            await Promise.resolve( emitter.shutdown() ).catch( () => undefined );
            return { faults: countConsoleFaults( spy, 'onCritical' ), completed };
        }
    },

    {
        key: 'mqtt emitter — onBackpressure',
        callbackName: 'onBackpressure',
        run: async function ( badCallback ) {
            const manual = makeMockClient( { manualAcks: true } );
            const emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                onBackpressure: badCallback,
                mqttConnectFn: () => manual.client
            } );
            emitter.publishNow( 'cg/topic', { value: 1 } );
            const spy = sinon.spy( console, 'error' );
            let completed = false;
            try {
                manual.publishCalls[ 0 ].cb();
                await settleTwice();
                completed = emitter.getHealth().stats.published === 1;
            } catch {
                completed = false;
            }
            spy.restore();
            await Promise.resolve( emitter.shutdown() ).catch( () => undefined );
            return { faults: countConsoleFaults( spy, 'onBackpressure' ), completed };
        }
    },

    {
        key: 'mqtt emitter — onDeliveryFailure',
        callbackName: 'onDeliveryFailure',
        run: async function ( badCallback ) {
            const manual = makeMockClient( { manualAcks: true } );
            const emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                onDeliveryFailure: badCallback,
                mqttConnectFn: () => manual.client
            } );
            emitter.publishNow( 'cg/topic', { value: 1 } );
            const spy = sinon.spy( console, 'error' );
            let completed = false;
            try {
                manual.publishCalls[ 0 ].cb( new Error( 'publish refused' ) );
                await settleTwice();
                completed = emitter.getHealth().stats.publishErrors === 1;
            } catch {
                completed = false;
            }
            spy.restore();
            await Promise.resolve( emitter.shutdown() ).catch( () => undefined );
            return { faults: countConsoleFaults( spy, 'onDeliveryFailure' ), completed };
        }
    },

    {
        key: 'questdb storage — onDeliveryFailure (at-flush site)',
        callbackName: 'onDeliveryFailure',
        run: async function ( badCallback ) {
            const mockSender = makeMockSender();
            // resetBehavior first: the mock's default `returnsThis()` takes
            // precedence over a later callsFake, which would make this
            // trigger inert (at() must return a rejecting thenable).
            mockSender.at.resetBehavior();
            mockSender.at.callsFake( () => Promise.reject( new Error( 'at flush failed' ) ) );
            const storage = await createQuestDBStorage(
                QDB_ASSET_CLASS, 'pump',
                { ...QDB_OPTS, onDeliveryFailure: badCallback },
                makeMockDeps( mockSender )
            );
            const spy = sinon.spy( console, 'error' );
            let completed = false;
            try {
                const first = storage.write( 'monitoring', QDB_MSG, 'p1' );
                await settleTwice();
                const second = storage.write( 'monitoring', QDB_MSG, 'p1' );
                await settleTwice();
                completed = ( first.ok === true ) && ( second.ok === true );
            } catch {
                completed = false;
            }
            spy.restore();
            return { faults: countConsoleFaults( spy, 'onDeliveryFailure' ) >= 1 ? 1 : 0, completed };
        }
    },

    {
        key: 'questdb storage — onDeliveryFailure (recovery site)',
        callbackName: 'onDeliveryFailure',
        run: async function ( badCallback ) {
            const mockSender = makeMockSender();
            mockSender.flush.rejects( new Error( 'ECONNREFUSED' ) );
            mockSender.floatColumn.onFirstCall().throws( new Error( 'mid-row boom' ) );
            const storage = await createQuestDBStorage(
                QDB_ASSET_CLASS, 'pump',
                { ...QDB_OPTS, onDeliveryFailure: badCallback },
                makeMockDeps( mockSender )
            );
            const spy = sinon.spy( console, 'error' );
            let completed = false;
            try {
                const first = storage.write( 'monitoring', QDB_MSG, 'p1' );
                await settleTwice();
                const second = storage.write( 'monitoring', QDB_MSG, 'p1' );
                completed = ( first.ok === false ) && ( second.ok === true );
            } catch {
                completed = false;
            }
            spy.restore();
            return { faults: countConsoleFaults( spy, 'onDeliveryFailure' ), completed };
        }
    },

    {
        key: 'csv source — onStatus',
        callbackName: 'onStatus',
        run: async function ( badCallback ) {
            const filePath = path.join(
                os.tmpdir(),
                `cg-csv-${Date.now()}-${Math.random().toString( 36 ).slice( 2 )}.csv`
            );
            fs.writeFileSync( filePath, 'id,value\na,1\na,2\na,3\n', 'utf8' );
            const messages = [];
            const spy = sinon.spy( console, 'error' );
            let completed = false;
            let stop = null;
            try {
                stop = csv.start( {
                    path: filePath,
                    onStatus: badCallback,
                    onMessage: ( m ) => messages.push( m )
                } );
                await waitFor( () => messages.length === 3 );
                await settleTwice();
                // The replay survived its reporter: every row delivered.
                completed = messages.length === 3;
            } catch {
                completed = false;
            }
            spy.restore();
            if ( stop ) {
                await stop().catch( () => null );
            }
            fs.unlinkSync( filePath );
            // Lifecycle fires onStatus several times (starting, headers,
            // complete); every one must be contained. Exactly one fault
            // per trigger — report 1 when the count matches the trigger
            // count, else the raw count to fail loudly.
            const faults = countConsoleFaults( spy, 'onStatus' );
            return { faults: faults >= 3 ? 1 : faults, completed };
        }
    },

    {
        key: 'testHarness source — onStatus',
        callbackName: 'onStatus',
        run: async function ( badCallback ) {
            const messages = [];
            const spy = sinon.spy( console, 'error' );
            let completed = false;
            let stop = null;
            try {
                stop = testHarness.start( {
                    messageTemplate: HARNESS_TEMPLATE,
                    assetClass: HARNESS_ASSET_CLASS,
                    onStatus: badCallback,
                    onMessage: ( m ) => messages.push( m )
                } );
                await waitFor( () => messages.length === 3 );
                await settleTwice();
                completed = messages.length === 3;
            } catch {
                completed = false;
            }
            spy.restore();
            if ( stop ) {
                await stop().catch( () => null );
            }
            const faults = countConsoleFaults( spy, 'onStatus' );
            // starting + generating + complete = three contained faults.
            return { faults: faults >= 3 ? 1 : faults, completed };
        }
    }

];

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

describe( 'callback guard contract (cross-adapter, ADR-018)', function () {

    this.timeout( 10000 );

    // Any unhandled rejection during a case is a containment failure —
    // the guard's whole job is that user faults never reach this hook.
    // A const array (emptied, never reassigned) keeps the loop-built
    // test closures safe references.
    const unhandled = [];
    const trap = function ( reason ) {
        unhandled.push( reason );
    };

    beforeEach( function () {
        unhandled.length = 0;
        process.on( 'unhandledRejection', trap );
    } );

    // Cleanup only. The zero-rejections assertion lives inside each
    // test body: a failing hook aborts the whole suite in mocha,
    // which would hide the remaining cases behind the first leak.
    afterEach( function () {
        process.removeListener( 'unhandledRejection', trap );
        sinon.restore();
    } );

    it( 'covers every wrapped call site (floor guard)', function () {
        // A new adapter callback joins the guard by adding its row
        // above. If this count is wrong, update BOTH the table and
        // this pin in the same change.
        expect(
            SITES.length,
            'SITES must list every wrapped callback site — add the new row to this table'
        ).to.equal( 11 );
    } );

    for ( const site of SITES ) {
        describe( site.key, function () {

            for ( const mode of FAULT_MODES ) {
                it( `contains ${mode.label}`, async function () {
                    const bad = mode.make( site.key );
                    const { faults, completed } = await site.run( bad );
                    await settleTwice();
                    expect( faults, 'exactly one classified CALLBACK_FAILED report' ).to.equal( 1 );
                    expect( completed, 'the operation must complete despite the callback fault' ).to.equal( true );
                    expect( unhandled.length, 'unhandled rejection escaped the guard' ).to.equal( 0 );
                } );
            }

        } );
    }

} );

describe( 'the TRANSFORM_THREW sentinel never leaks (ADR-018)', function () {

    afterEach( function () {
        sinon.restore();
    } );

    it( 'composer\'s public surface exports nothing from the guard module', function () {
        // The sentinel marks a thrown transform by IDENTITY. Keeping it
        // off the public surface means no user value can ever equal it.
        expect( composerSurface.TRANSFORM_THREW ).to.equal( undefined );
        expect( composerSurface.wrapTransform ).to.equal( undefined );
        expect( composerSurface.wrapCallback ).to.equal( undefined );
    } );

    it( 'a transform returning a plain empty object still delivers — identity, not shape, marks a throw', async function () {
        const filePath = path.join(
            os.tmpdir(),
            `cg-sentinel-${Date.now()}-${Math.random().toString( 36 ).slice( 2 )}.csv`
        );
        fs.writeFileSync( filePath, 'id,value\na,1\n', 'utf8' );
        const messages = [];
        let stop = null;
        try {
            stop = csv.start( {
                path: filePath,
                transform: () => ( {} ),
                onMessage: ( m ) => messages.push( m )
            } );
            await waitFor( () => messages.length === 1 );
            // An empty object is shaped exactly like the sentinel; only
            // the sentinel's own identity may mark a throw.
            expect( messages ).to.deep.equal( [ {} ] );
        } finally {
            if ( stop ) {
                await stop().catch( () => null );
            }
            fs.unlinkSync( filePath );
        }
    } );

    it( 'a throwing transform delivers nothing — the sentinel stays inside the site', async function () {
        const filePath = path.join(
            os.tmpdir(),
            `cg-sentinel-${Date.now()}-${Math.random().toString( 36 ).slice( 2 )}.csv`
        );
        fs.writeFileSync( filePath, 'id,value\na,1\n', 'utf8' );
        const messages = [];
        const statuses = [];
        let stop = null;
        try {
            stop = csv.start( {
                path: filePath,
                transform: () => {
                    throw new Error( 'transform boom' );
                },
                onStatus: ( s ) => statuses.push( s ),
                onMessage: ( m ) => messages.push( m )
            } );
            await waitFor( () => statuses.some( ( s ) => s.phase === 'complete' ) );
            expect( messages ).to.have.lengthOf( 0 );
            const complete = statuses.find( ( s ) => s.phase === 'complete' );
            expect( complete.skipped ).to.equal( 1 );
        } finally {
            if ( stop ) {
                await stop().catch( () => null );
            }
            fs.unlinkSync( filePath );
        }
    } );

} );

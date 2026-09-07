// core/storage-manager/questdb/test/http-error-responses.specs.js

/**
 * @fileoverview The server answers a flush with an HTTP error
 * (ADR-029). Unit tier.
 *
 * A server that is up but refuses the request is the third outage
 * shape, after a closed port and a black hole. The client rejects the
 * flush with `HTTP request failed, statusCode=N, error=<body>`. For a
 * retryable code (500, 503, 504, 507, 509, 523, 524, 529 and 599) it
 * retries inside its retry budget first; for every other code it
 * rejects at once. Either way composer sees one rejection per flush.
 *
 * What composer does is the same for every code, and that is the
 * point of this spec. The batch is reported lost with the probe's
 * finding. The probe is a TCP connect, and a server that answers
 * accepts connections, so the probe passes and delivery is NOT paused.
 * The next flush goes out as usual. The health ladder counts the
 * failures: yellow after one, red after two in a row, green again at
 * the next success with one restored line.
 *
 * The cases here drive a mock sender whose `flush()` rejects with the
 * client's message shape, and a scripted probe that answers. The live
 * leg against a real HTTP responder, where the client's own retry
 * timing is measured, is `slow-questdb-http-errors.specs.js`.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createQuestDBStorage } from '../index.js';
import {
    makeMockSender,
    makeMockDeps,
    ILP_ADDRESS,
    probeOutcomeFor,
    makeScriptedProbe
} from './test-helpers.js';

const TEST_ASSET_CLASS = {
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

const GOOD_MSG = { ts: 1735500000000, temp: 25.5 };
const ADDRESSES = { ilpUrl: '127.0.0.1:9000', pgUrl: '127.0.0.1:8812' };
const NOW = 1735500000000;

/**
 * The client's rejection shapes, one per error class it can return.
 * `retried` says whether the client retries that code before
 * rejecting; composer's response does not depend on it.
 */
const ERROR_CLASSES = [
    { status: 400, body: 'failed to parse line protocol', retried: false },
    { status: 401, body: 'Unauthorized', retried: false },
    { status: 403, body: 'Forbidden', retried: false },
    { status: 404, body: 'Not Found', retried: false },
    { status: 500, body: 'Internal Server Error', retried: true },
    { status: 503, body: 'Service Unavailable', retried: true },
    { status: 524, body: 'A Timeout Occurred', retried: true }
];

const clientRejection = function ( status, body ) {
    return new Error( `HTTP request failed, statusCode=${status}, error=${body}` );
};

/** Writes `count` good rows. */
const writeRows = function ( storage, count ) {
    for ( let i = 0; i < count; i += 1 ) {
        storage.write( 'monitoring', GOOD_MSG, 'p1' );
    }
}; // writeRows()

/** The lines a console spy captured that carry the given token. */
const linesWith = function ( spy, token ) {
    return spy.getCalls()
        .map( ( call ) => String( call.args[ 0 ] ) )
        .filter( ( line ) => line.includes( token ) );
}; // linesWith()

describe( 'QuestDB flush answered with an HTTP error (ADR-029)', function () {

    let mockSender;
    let deps;
    let probe;
    let clock;

    const makeStorage = ( options = {} ) => createQuestDBStorage(
        TEST_ASSET_CLASS,
        'pump',
        { ...ADDRESSES, flushRows: 2, flushIntervalMs: 1000, ...options },
        deps
    );

    beforeEach( function () {
        clock = sinon.useFakeTimers( { now: NOW } );
        mockSender = makeMockSender();
        probe = makeScriptedProbe();
        deps = makeMockDeps( mockSender );
        deps.probeFn = probe.probeFn;
    } );

    afterEach( function () {
        clock.restore();
        sinon.restore();
    } );

    describe( 'one response per error class', function () {

        ERROR_CLASSES.forEach( ( errorClass ) => {
            const label = `${errorClass.status}${errorClass.retried ? ' (retried by the client first)' : ''}`;

            it( `${label}: the batch is reported with a passing probe, no pause, and delivery goes on`, async function () {
                const onDeliveryFailure = sinon.stub();
                mockSender.flush.onFirstCall().rejects( clientRejection( errorClass.status, errorClass.body ) );
                const storage = await makeStorage( { onDeliveryFailure } );
                probe.setResult( 'answers' );

                writeRows( storage, 2 );
                await clock.tickAsync( 0 );

                expect( onDeliveryFailure.callCount ).to.equal( 1 );
                const [ err, ctx ] = onDeliveryFailure.firstCall.args;
                expect( err.message ).to.equal( `HTTP request failed, statusCode=${errorClass.status}, error=${errorClass.body}` );
                expect( ctx ).to.deep.equal( {
                    trigger: 'rows',
                    rowsLost: 2,
                    abandoned: false,
                    probe: probeOutcomeFor( ILP_ADDRESS, 'answers' )
                } );

                const health = storage.getHealth();
                expect( health.status ).to.equal( 'yellow' );
                expect( health.connected ).to.equal( true );
                expect( health.pausedSince ).to.equal( null );
                expect( health.consecutiveFlushFailures ).to.equal( 1 );
                expect( health.abandonedFlushes ).to.equal( 0 );
                expect( health.lastFlushError.abandoned ).to.equal( false );

                // The next batch goes out at once: nothing is held back.
                writeRows( storage, 2 );
                await clock.tickAsync( 0 );
                expect( mockSender.flush.callCount, 'delivery goes on' ).to.equal( 2 );
                expect( onDeliveryFailure.callCount, 'the second flush succeeded' ).to.equal( 1 );
                expect( storage.getHealth().status ).to.equal( 'green' );

                await storage.shutdown();
            } );
        } );

        it( 'with no handler, the console line carries the status and the probe finding', async function () {
            const errorSpy = sinon.spy( console, 'error' );
            mockSender.flush.onFirstCall().rejects( clientRejection( 500, 'Internal Server Error' ) );
            const storage = await makeStorage();
            probe.setResult( 'answers' );

            writeRows( storage, 2 );
            await clock.tickAsync( 0 );

            const lines = linesWith( errorSpy, '[DELIVERY_FAILED]' );
            expect( lines ).to.have.lengthOf( 1 );
            expect( lines[ 0 ] ).to.equal(
                'winkComposer/questdb: flush failed, 2 row(s) lost [DELIVERY_FAILED]: ' +
                'HTTP request failed, statusCode=500, error=Internal Server Error; probe: 127.0.0.1:9000 answers'
            );

            await storage.shutdown();
        } );
    } );

    describe( 'the ladder over repeated error answers', function () {

        it( 'yellow after one, red after two in a row, green with one restored line at the next success', async function () {
            const warnSpy = sinon.spy( console, 'warn' );
            const errorSpy = sinon.spy( console, 'error' );
            const onDeliveryFailure = sinon.stub();
            mockSender.flush.onFirstCall().rejects( clientRejection( 503, 'Service Unavailable' ) );
            mockSender.flush.onSecondCall().rejects( clientRejection( 503, 'Service Unavailable' ) );
            const storage = await makeStorage( { onDeliveryFailure } );
            probe.setResult( 'answers' );

            writeRows( storage, 2 );
            await clock.tickAsync( 0 );
            expect( storage.getHealth().status ).to.equal( 'yellow' );
            expect( linesWith( warnSpy, 'delivery degraded, 1 flush failed [DELIVERY_HEALTH]' ) ).to.have.lengthOf( 1 );

            writeRows( storage, 2 );
            await clock.tickAsync( 0 );
            const red = storage.getHealth();
            expect( red.status ).to.equal( 'red' );
            expect( red.connected ).to.equal( false );
            expect( red.pausedSince, 'red by the ladder, not by a pause' ).to.equal( null );
            expect( red.consecutiveFlushFailures ).to.equal( 2 );
            expect( linesWith( errorSpy, 'delivery red after 2 failed flush(es) [DELIVERY_HEALTH]' ) ).to.have.lengthOf( 1 );

            // Still not paused: the third batch goes out and lands.
            await clock.tickAsync( 1 );
            writeRows( storage, 2 );
            await clock.tickAsync( 0 );
            const green = storage.getHealth();
            expect( mockSender.flush.callCount ).to.equal( 3 );
            expect( green.status ).to.equal( 'green' );
            expect( green.connected ).to.equal( true );
            expect( green.consecutiveFlushFailures ).to.equal( 0 );
            const restored = linesWith( warnSpy, 'delivery restored' );
            expect( restored ).to.have.lengthOf( 1 );
            expect( restored[ 0 ] ).to.include( '4 row(s) reported lost meanwhile [DELIVERY_HEALTH]' );

            expect( onDeliveryFailure.callCount ).to.equal( 2 );
            expect( probe.engineCalls(), 'one probe per failed flush' ).to.equal( 2 );
            expect( linesWith( warnSpy, '[CIRCUIT_OPEN]' ), 'never paused' ).to.have.lengthOf( 0 );

            await storage.shutdown();
        } );
    } );
} );

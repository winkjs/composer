// core/test/source-transform-contract.specs.js

/**
 * @fileoverview Cross-source contract test for the `transform` hook
 * (uniform across sources since 2026-07-11).
 *
 * Both sources that accept a user `transform` (CSV and MQTT; the
 * testHarness generates its own messages and has none) must give it
 * the same meaning:
 *
 * 1. `transform( msg )` runs as the last step before `onMessage`;
 *    whatever it returns is what the pipeline receives.
 * 2. Returning `null` or `undefined` drops the message. ONLY those two
 *    values mean drop — any other return, however falsy, is delivered.
 * 3. A throwing transform skips that one message, reports it as a
 *    classified `CALLBACK_FAILED` (yellow, one report per message,
 *    console.error fallback when no `onStatus` is supplied), and the
 *    stream continues. One bad message costs only itself (ADR-018);
 *    user code is never reported as a transport failure.
 * 4. Dropped and throw-skipped messages are counted: they land in the
 *    source's `skipped` accounting (CSV completion payload, MQTT
 *    metrics counters), so delivered + skipped covers every message
 *    that arrived.
 *
 * The suite is data-driven over both sources with shared fixtures so
 * the semantics cannot drift apart again — the pattern of
 * src/nodes/test/field-keyed-contract.specs.js. A future source that
 * adds `transform` joins the SOURCES table below.
 */

/* eslint-disable no-sync, no-underscore-dangle */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sinon from 'sinon';

import { start as csvStart } from '../source-manager/csv/start.js';
import { createMQTTSourceClient } from '../source-manager/mqtt/client.js';
import { createMockClient } from '../source-manager/mqtt/test/test-helpers.js';

// ============================================================================
// SHARED FIXTURES
// ============================================================================

// Three messages; the shared transforms key on `v === 2` so exactly the
// middle message is affected and "the stream continues" is observable.
const MESSAGES = [
    { id: 'a', v: 1 },
    { id: 'a', v: 2 },
    { id: 'a', v: 3 }
];

const tagEveryMessage = function ( msg ) {
    msg.tagged = true;
    return msg;
};

const dropSecondWithNull = function ( msg ) {
    return ( msg.v === 2 ) ? null : msg;
};

const dropSecondWithUndefined = function ( msg ) {
    return ( msg.v === 2 ) ? undefined : msg;
};

const zeroForSecond = function ( msg ) {
    return ( msg.v === 2 ) ? 0 : msg;
};

const throwOnSecond = function ( msg ) {
    if ( msg.v === 2 ) {
        throw new Error( 'transform boom' );
    }
    return msg;
};

// ============================================================================
// PER-SOURCE DRIVERS — normalize both sources to one observation shape
// ============================================================================

const tempFiles = [];

const createTempCsv = function () {
    const lines = [ 'id,v' ];
    MESSAGES.forEach( ( m ) => lines.push( `${m.id},${m.v}` ) );
    const filePath = path.join(
        os.tmpdir(),
        `transform-contract-${Date.now()}-${Math.random().toString( 36 ).slice( 2 )}.csv`
    );
    fs.writeFileSync( filePath, `${lines.join( '\n' )}\n`, 'utf8' );
    tempFiles.push( filePath );
    return filePath;
};

/**
 * Drive the CSV source through MESSAGES with the given transform.
 * Resolves on `phase: 'complete'` OR `phase: 'errored'` (the errored
 * leg keeps a broken build from hanging the suite; assertions then
 * name the wrong phase). Set `withStatus: false` to exercise the
 * console-fallback path — completion is then observed via onShutdown.
 *
 * @param {Function} transform - The transform under test
 * @param {Object} [options] - { withStatus = true }
 * @returns {Promise<Object>} { delivered, statuses, completion }
 */
const runCsvCase = function ( transform, { withStatus = true } = {} ) {
    return new Promise( ( resolve ) => {
        const delivered = [];
        const statuses = [];
        let completion = null;

        const config = {
            path: createTempCsv(),
            transform,
            onMessage: ( msg ) => {
                delivered.push( msg );
            }
        };
        if ( withStatus ) {
            config.onStatus = ( s ) => {
                statuses.push( s );
                if ( s.phase === 'complete' ) {
                    completion = s;
                    resolve( { delivered, statuses, completion } );
                }
                if ( s.phase === 'errored' ) {
                    resolve( { delivered, statuses, completion } );
                }
            };
        } else {
            config.onShutdown = () => {
                resolve( { delivered, statuses, completion } );
            };
        }
        csvStart( config );
    } );
};

/**
 * Drive the MQTT source through MESSAGES with the given transform,
 * against the stubbed mqtt.js client (no broker). Delivery is
 * synchronous inside the message handler, so observations are ready
 * as soon as the emits return.
 *
 * @param {Function} transform - The transform under test
 * @param {Object} [options] - { withStatus = true }
 * @returns {Promise<Object>} { delivered, statuses, metrics }
 */
const runMqttCase = async function ( transform, { withStatus = true } = {} ) {
    const delivered = [];
    const statuses = [];
    const mockClient = createMockClient();

    const config = {
        brokerUrl: 'mqtt://localhost',
        topics: 'contract/test',
        transform,
        onMessage: ( msg ) => {
            delivered.push( msg );
        },
        mqttConnectFn: () => mockClient
    };
    if ( withStatus ) {
        config.onStatus = ( s ) => {
            statuses.push( s );
        };
    }
    const stopFn = createMQTTSourceClient( config );

    MESSAGES.forEach( ( m ) => {
        mockClient._emit( 'message', 'contract/test', Buffer.from( JSON.stringify( m ) ), {} );
    } );

    const metrics = stopFn._metrics();
    await stopFn( { timeout: 50 } );
    return { delivered, statuses, metrics };
};

const SOURCES = [
    { name: 'csv', run: runCsvCase },
    { name: 'mqtt', run: runMqttCase }
];

// ============================================================================
// THE SHARED CONTRACT — identical expectations against both sources
// ============================================================================

describe( 'source transform contract (cross-source)', function () {
    afterEach( function () {
        sinon.restore();
        while ( tempFiles.length > 0 ) {
            try {
                fs.unlinkSync( tempFiles.pop() );
            } catch {
                // Ignore cleanup errors
            }
        }
    } );

    SOURCES.forEach( ( source ) => {
        describe( `${source.name} source`, function () {
            it( 'delivers what the transform returns', async function () {
                const { delivered } = await source.run( tagEveryMessage );

                expect( delivered.map( ( m ) => m.v ) ).to.deep.equal( [ 1, 2, 3 ] );
                expect( delivered.every( ( m ) => m.tagged === true ) ).to.equal( true );
            } );

            it( 'drops on null and continues with later messages', async function () {
                const { delivered, statuses } = await source.run( dropSecondWithNull );

                expect( delivered.map( ( m ) => m.v ) ).to.deep.equal( [ 1, 3 ] );
                // An intentional drop is not an error — nothing classified.
                expect( statuses.filter( ( s ) => s.error ) ).to.deep.equal( [] );
            } );

            it( 'drops on undefined and continues with later messages', async function () {
                const { delivered } = await source.run( dropSecondWithUndefined );

                expect( delivered.map( ( m ) => m.v ) ).to.deep.equal( [ 1, 3 ] );
            } );

            it( 'delivers a falsy non-nullish return — only null/undefined mean drop', async function () {
                const { delivered } = await source.run( zeroForSecond );

                expect( delivered.length ).to.equal( 3 );
                expect( delivered[ 0 ].v ).to.equal( 1 );
                expect( delivered[ 1 ] ).to.equal( 0 );
                expect( delivered[ 2 ].v ).to.equal( 3 );
            } );

            it( 'skips a throwing transform, classifies CALLBACK_FAILED, and continues', async function () {
                const { delivered, statuses } = await source.run( throwOnSecond );

                expect( delivered.map( ( m ) => m.v ) ).to.deep.equal( [ 1, 3 ] );

                const reports = statuses.filter( ( s ) => s.error && s.error.code === 'CALLBACK_FAILED' );
                expect( reports.length ).to.equal( 1 );
                expect( reports[ 0 ].status ).to.equal( 'yellow' );
                expect( reports[ 0 ].error.message ).to.include( 'transform boom' );

                // User code must never surface as a transport failure or
                // end the stream: no READ_ERROR, no terminal errored phase.
                expect( statuses.filter( ( s ) => s.error && s.error.code !== 'CALLBACK_FAILED' ) ).to.deep.equal( [] );
                expect( statuses.filter( ( s ) => s.phase === 'errored' ) ).to.deep.equal( [] );
            } );

            it( 'reports a transform throw via console.error when no onStatus is supplied', async function () {
                const errorSpy = sinon.spy( console, 'error' );

                const { delivered } = await source.run( throwOnSecond, { withStatus: false } );

                expect( delivered.map( ( m ) => m.v ) ).to.deep.equal( [ 1, 3 ] );
                const classified = errorSpy.getCalls().filter( ( c ) => String( c.args[ 0 ] ).includes( 'CALLBACK_FAILED' ) );
                expect( classified.length ).to.equal( 1 );
                expect( String( classified[ 0 ].args[ 0 ] ) ).to.include( 'transform boom' );
            } );
        } );
    } );

    // ── Accounting: delivered + skipped covers every arrival ────────────

    describe( 'csv completion accounting', function () {
        it( 'a transform-dropped row lands in skipped — count + skipped covers all data rows', async function () {
            const { completion } = await runCsvCase( dropSecondWithNull );

            expect( completion.count ).to.equal( 2 );
            expect( completion.skipped ).to.equal( 1 );
        } );

        it( 'a throw-skipped row lands in skipped and the file still completes', async function () {
            const { completion } = await runCsvCase( throwOnSecond );

            expect( completion ).to.not.equal( null );
            expect( completion.count ).to.equal( 2 );
            expect( completion.skipped ).to.equal( 1 );
        } );
    } );

    describe( 'mqtt counter accounting', function () {
        it( 'a transform-dropped message lands in skipped', async function () {
            const { metrics } = await runMqttCase( dropSecondWithNull );

            expect( metrics.delivered ).to.equal( 2 );
            expect( metrics.skipped ).to.equal( 1 );
        } );

        it( 'a throw-skipped message lands in skipped', async function () {
            const { metrics } = await runMqttCase( throwOnSecond );

            expect( metrics.delivered ).to.equal( 2 );
            expect( metrics.skipped ).to.equal( 1 );
        } );
    } );
} );

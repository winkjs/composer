// core/emitter-manager/mqtt/test/connection-lines.specs.js

/**
 * @fileoverview MQTT emitter — the connection lines an operator reads.
 *
 * Before this change the link edges printed only with `debug: true`,
 * and a broker outage left nothing in a production log. Now two
 * layers print through the logger facade, whether or not debug is on.
 *
 * Edge lines carry the token `DELIVERY_HEALTH` and print once per
 * change of link state. Going offline prints at error with the
 * in-flight count. The next connack prints at warn with the outage
 * length and the in-flight count. Nothing prints while a state
 * persists, however long the outage lasts.
 *
 * Attempt lines carry the token `CONNECT_FAILED` and print at warn
 * from the client's `error` event, which names the reason an edge
 * line cannot (a refused connect, a connack timeout). The shared line
 * bound keeps two per episode in full, then one summary a minute.
 *
 * The clock is fake, so every "after N s" has a value the spec can
 * name. Every case was written before connection.js changed and run
 * red against the debug-only handlers.
 *
 * @see ADR-018 (the two-party rule)
 * @see ADR-028 (the message grammar)
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { createEmitter } from '../emitter.js';
import { makeMockClient, testCodec } from './test-helpers.js';

/** A fixed wall clock, so every duration has a value the spec can name. */
const NOW = 1735500000000;

const OFFLINE_LINE = 'winkComposer/mqttEmitter: broker offline, 0 message(s) in flight [DELIVERY_HEALTH]';
const REFUSED = 'connect ECONNREFUSED 127.0.0.1:1883';
const ATTEMPT_LINE = `winkComposer/mqttEmitter: connection attempt failed [CONNECT_FAILED]: ${REFUSED}`;

const restoredLine = function ( seconds, inFlight = 0 ) {
    return `winkComposer/mqttEmitter: broker connection restored after ${seconds} s, ${inFlight} message(s) in flight [DELIVERY_HEALTH]`;
}; // restoredLine()

const summaryLine = function ( count, seconds ) {
    return `${ATTEMPT_LINE}; ${count} more attempt(s) failed in the last ${seconds} s`;
}; // summaryLine()

describe( 'mqtt emitter — connection lines', function () {

    let clock;
    let mock;
    let emitter;
    let warnSpy;
    let errorSpy;
    let logSpy;

    const lines = function ( spy ) {
        return spy.getCalls().map( ( c ) => String( c.args[ 0 ] ) );
    }; // lines()

    const makeEmitter = function ( extra = {} ) {
        return createEmitter( {
            brokerUrl: 'mqtt://127.0.0.1',
            connectGraceMs: 0,
            codec: testCodec,
            mqttConnectFn: () => mock.client,
            ...extra
        } );
    }; // makeEmitter()

    beforeEach( function () {
        // Only the two clocks are fake, the wall clock and the
        // stopwatch. The mock's acks and the drain's timers stay real,
        // so shutdown in afterEach runs unchanged.
        clock = sinon.useFakeTimers( { now: NOW, toFake: [ 'Date', 'performance' ] } );
        mock = makeMockClient();
        warnSpy = sinon.stub( console, 'warn' );
        errorSpy = sinon.stub( console, 'error' );
        logSpy = sinon.stub( console, 'log' );
    } );

    afterEach( async function () {
        if ( emitter ) {
            await emitter.shutdown( { timeout: 50 } ).catch( () => undefined );
            emitter = null;
        }
        sinon.restore();
        clock.restore();
    } );

    it( 'prints one offline line at error and one restored line at warn, nothing in between', async function () {
        emitter = await makeEmitter();
        mock.eventHandlers.connect();

        mock.eventHandlers.offline();
        expect( lines( errorSpy ) ).to.deep.equal( [ OFFLINE_LINE ] );
        expect( warnSpy.callCount ).to.equal( 0 );

        // The library fires 'offline' once per outage. A repeat is not
        // a change of state, so it prints nothing.
        clock.tick( 10000 );
        mock.eventHandlers.offline();
        expect( errorSpy.callCount ).to.equal( 1 );

        clock.tick( 20000 );
        mock.eventHandlers.connect();
        expect( lines( warnSpy ) ).to.deep.equal( [ restoredLine( 30 ) ] );
        expect( errorSpy.callCount ).to.equal( 1 );

        // A steady link prints nothing.
        mock.eventHandlers.connect();
        expect( warnSpy.callCount ).to.equal( 1 );
        expect( logSpy.callCount ).to.equal( 0 );
    } );

    it( 'a never-connected client prints offline on its first failure and restored on its first connack', async function () {
        emitter = await makeEmitter();

        mock.eventHandlers.offline();
        expect( lines( errorSpy ) ).to.deep.equal( [ OFFLINE_LINE ] );

        clock.tick( 5000 );
        mock.eventHandlers.connect();
        expect( lines( warnSpy ) ).to.deep.equal( [ restoredLine( 5 ) ] );
        expect( emitter.getHealth().stats.reconnects ).to.equal( 0 );
    } );

    it( 'the restored line measures the outage on the stopwatch, not the wall clock', async function () {
        emitter = await makeEmitter();
        mock.eventHandlers.connect();
        mock.eventHandlers.offline();

        // The wall clock jumps an hour during the outage while the
        // stopwatch advances 5 s. The line reads 5 s.
        clock.setSystemTime( NOW + ( 3600 * 1000 ) );
        clock.tick( 5000 );
        mock.eventHandlers.connect();

        expect( lines( warnSpy ) ).to.deep.equal( [ restoredLine( 5 ) ] );
    } );

    it( 'bounds the attempt lines: two in full, then one summary a minute', async function () {
        emitter = await makeEmitter();
        mock.eventHandlers.connect();
        mock.eventHandlers.offline();

        // 36 failed attempts, one every 5 s, over 3 minutes.
        for ( let i = 0; i < 36; i += 1 ) {
            mock.eventHandlers.error( new Error( REFUSED ) );
            clock.tick( 5000 );
        }
        mock.eventHandlers.connect();

        // The first two print in full at 0 s and 5 s. A summary prints
        // at the first failure a minute after the last printed line.
        // That is at 65 s and at 125 s, each covering twelve failures.
        // The ten failures after 125 s wait for the next episode.
        expect( lines( warnSpy ) ).to.deep.equal( [
            ATTEMPT_LINE,
            ATTEMPT_LINE,
            summaryLine( 12, 60 ),
            summaryLine( 12, 60 ),
            restoredLine( 180 )
        ] );
        expect( lines( errorSpy ) ).to.deep.equal( [ OFFLINE_LINE ] );
        expect( emitter.getHealth().stats.errors ).to.equal( 36 );
    } );

    it( 'a second outage after a quiet minute closes the old attempt episode and starts a new one', async function () {
        emitter = await makeEmitter();
        mock.eventHandlers.connect();

        // First outage: three failures, the third counted, not printed.
        mock.eventHandlers.offline();
        mock.eventHandlers.error( new Error( REFUSED ) );
        clock.tick( 5000 );
        mock.eventHandlers.error( new Error( REFUSED ) );
        clock.tick( 5000 );
        mock.eventHandlers.error( new Error( REFUSED ) );
        mock.eventHandlers.connect();

        // A quiet 70 s, then a second outage. The counted failure is
        // summarized before the new episode's first full line.
        clock.tick( 70000 );
        mock.eventHandlers.offline();
        mock.eventHandlers.error( new Error( REFUSED ) );

        expect( lines( warnSpy ) ).to.deep.equal( [
            ATTEMPT_LINE,
            ATTEMPT_LINE,
            restoredLine( 10 ),
            summaryLine( 1, 75 ),
            ATTEMPT_LINE
        ] );
        expect( lines( errorSpy ) ).to.deep.equal( [ OFFLINE_LINE, OFFLINE_LINE ] );
    } );

    it( 'the in-flight count on both edge lines is the live unacked counter', async function () {
        mock = makeMockClient( { manualAcks: true } );
        emitter = await makeEmitter();
        mock.eventHandlers.connect();
        for ( let i = 0; i < 3; i += 1 ) {
            emitter.publishNow( 'test/topic', { value: i } );
        }

        mock.eventHandlers.offline();
        expect( lines( errorSpy ) ).to.deep.equal( [
            'winkComposer/mqttEmitter: broker offline, 3 message(s) in flight [DELIVERY_HEALTH]'
        ] );

        mock.publishCalls[ 0 ].cb();
        clock.tick( 1000 );
        mock.eventHandlers.connect();
        expect( lines( warnSpy ) ).to.deep.equal( [ restoredLine( 1, 2 ) ] );

        mock.publishCalls[ 1 ].cb();
        mock.publishCalls[ 2 ].cb();
    } );

    it( 'keeps the three debug lines beside the new ones when debug is on', async function () {
        emitter = await makeEmitter( { debug: true } );

        mock.eventHandlers.connect();
        mock.eventHandlers.offline();
        mock.eventHandlers.error( new Error( REFUSED ) );

        expect( lines( logSpy ) ).to.deep.equal( [
            'winkComposer/mqttEmitter: Connected to mqtt://127.0.0.1',
            'winkComposer/mqttEmitter: Offline - 0 messages in flight'
        ] );
        expect( lines( errorSpy ) ).to.deep.equal( [
            OFFLINE_LINE,
            `winkComposer/mqttEmitter: client error: ${REFUSED}`
        ] );
        expect( lines( warnSpy ) ).to.deep.equal( [ ATTEMPT_LINE ] );
    } );

} );

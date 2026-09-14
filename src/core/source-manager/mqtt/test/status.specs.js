// core/source-manager/mqtt/test/status.specs.js

/**
 * @fileoverview Tests for the MQTT source's status reporter — factory
 * validation, lifecycle transitions, emission de-duplication, the
 * per-record DECODE_ERROR report, and the lines printed through the
 * logger facade.
 *
 * The reporter is the pure state machine behind the source's
 * structured onStatus / onMetrics signals: client.js maps mqtt.js
 * events onto reporter calls 1:1, so these tests drive the reporter
 * directly with an injected clock — no fake MQTT client, no real
 * timers. Health-rule boundaries live in status-health.specs.js;
 * counters and metrics cadence in status-metrics.specs.js; broken
 * user callbacks in status-callbacks.specs.js; the clock source of
 * the time rules in clock-source.specs.js.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createStatusReporter } from '../status.js';
import { DISCONNECT_RED_MS } from '../constants.js';
import { makeClock } from './test-helpers.js';

// Builds a reporter wired to capture every status payload, with an
// injected clock. Tests destructure what they need.
const collect = function ( options = {} ) {
    const clock = makeClock();
    const statuses = [];
    const reporter = createStatusReporter( {
        onStatus: ( s ) => statuses.push( s ),
        nowFn: clock.nowFn,
        ...options
    } );

    return { clock, statuses, reporter };
};

describe( 'MQTT Source Status Reporter — factory validation', function () {

    it( 'throws classified INVALID_CONFIG on non-object options', function () {
        try {
            createStatusReporter( 'not-an-object' );
            expect.fail( 'should have thrown' );
        } catch ( err ) {
            expect( err.code ).to.equal( 'INVALID_CONFIG' );
            expect( err.message ).to.contain( 'status reporter options must be an object' );
        }
    } );

    it( 'throws INVALID_CONFIG when onStatus is not a function', function () {
        try {
            createStatusReporter( { onStatus: 'log-it' } );
            expect.fail( 'should have thrown' );
        } catch ( err ) {
            expect( err.code ).to.equal( 'INVALID_CONFIG' );
            expect( err.message ).to.contain( 'onStatus must be a function' );
        }
    } );

    it( 'throws INVALID_CONFIG when onMetrics is not a function', function () {
        try {
            createStatusReporter( { onMetrics: true } );
            expect.fail( 'should have thrown' );
        } catch ( err ) {
            expect( err.code ).to.equal( 'INVALID_CONFIG' );
            expect( err.message ).to.contain( 'onMetrics must be a function' );
        }
    } );

    it( 'throws INVALID_CONFIG on bad expectedQuietPeriodMs (zero, negative, fractional, string)', function () {
        for ( const bad of [ 0, -5, 1.5, '5000' ] ) {
            try {
                createStatusReporter( { expectedQuietPeriodMs: bad } );
                expect.fail( `should have thrown for ${bad}` );
            } catch ( err ) {
                expect( err.code, `code for ${bad}` ).to.equal( 'INVALID_CONFIG' );
                expect( err.message ).to.contain( 'expectedQuietPeriodMs must be a positive integer' );
            }
        }
    } );

    it( 'throws INVALID_CONFIG when nowFn is not a function', function () {
        try {
            createStatusReporter( { nowFn: 12345 } );
            expect.fail( 'should have thrown' );
        } catch ( err ) {
            expect( err.code ).to.equal( 'INVALID_CONFIG' );
            expect( err.message ).to.contain( 'nowFn must be a function' );
        }
    } );

    it( 'throws INVALID_CONFIG when dedupSizeFn is not a function', function () {
        try {
            createStatusReporter( { dedupSizeFn: {} } );
            expect.fail( 'should have thrown' );
        } catch ( err ) {
            expect( err.code ).to.equal( 'INVALID_CONFIG' );
            expect( err.message ).to.contain( 'dedupSizeFn must be a function' );
        }
    } );

    it( 'accepts an empty options object (all callbacks optional)', function () {
        expect( () => createStatusReporter( {} ) ).to.not.throw();
    } );

    it( 'accepts no arguments at all', function () {
        expect( () => createStatusReporter() ).to.not.throw();
    } );

} );

describe( 'MQTT Source Status Reporter — lifecycle transitions', function () {

    it( 'starting() emits green phase starting', function () {
        const { statuses, reporter } = collect();

        reporter.starting();

        expect( statuses ).to.have.length( 1 );
        expect( statuses[ 0 ] ).to.deep.equal( {
            status: 'green',
            connected: false,
            phase: 'starting',
            msSinceLastMsg: 0
        } );
    } );

    it( 'subscribed() after connected() emits green phase running', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();

        expect( statuses ).to.have.length( 2 );
        expect( statuses[ 1 ] ).to.deep.equal( {
            status: 'green',
            connected: true,
            phase: 'running',
            msSinceLastMsg: 0
        } );
    } );

    it( 'offline() emits yellow phase offline with connected false', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        reporter.offline();

        expect( statuses[ 2 ] ).to.deep.equal( {
            status: 'yellow',
            connected: false,
            phase: 'offline',
            msSinceLastMsg: 0
        } );
    } );

    it( 'repeated offline() events emit exactly one status (no flood)', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        reporter.offline();
        reporter.offline();
        reporter.offline();

        const offlines = statuses.filter( ( s ) => s.phase === 'offline' );
        expect( offlines ).to.have.length( 1 );
    } );

    it( 'reconnecting() emits yellow phase reconnecting, once per streak', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        reporter.offline();
        reporter.reconnecting();
        reporter.reconnecting();

        const reconnects = statuses.filter( ( s ) => s.phase === 'reconnecting' );
        expect( reconnects ).to.have.length( 1 );
        expect( reconnects[ 0 ] ).to.deep.equal( {
            status: 'yellow',
            connected: false,
            phase: 'reconnecting',
            msSinceLastMsg: 0
        } );
    } );

    it( 'a full outage cycle emits phases in order: starting, running, offline, reconnecting, running', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        reporter.offline();
        reporter.reconnecting();
        reporter.connected();
        reporter.subscribed();

        expect( statuses.map( ( s ) => s.phase ) ).to.deep.equal(
            [ 'starting', 'running', 'offline', 'reconnecting', 'running' ]
        );
    } );

    it( 'subscribeFailed() emits red SUBSCRIBE_FAILED while still alive (phase unchanged)', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribeFailed( new Error( 'not authorised to topic' ) );

        expect( statuses[ 1 ] ).to.deep.equal( {
            status: 'red',
            connected: true,
            phase: 'starting',
            msSinceLastMsg: 0,
            error: {
                code: 'SUBSCRIBE_FAILED',
                message: 'not authorised to topic'
            }
        } );
    } );

    it( 'a later successful subscribe heals the SUBSCRIBE_FAILED red', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribeFailed( new Error( 'not authorised to topic' ) );
        reporter.subscribed();

        const last = statuses[ statuses.length - 1 ];
        expect( last.status ).to.equal( 'green' );
        expect( last.phase ).to.equal( 'running' );
        expect( 'error' in last ).to.equal( false );
    } );

    it( 'connectError() during reconnecting attaches CONNECT_FAILED to the transient yellow', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        reporter.offline();
        reporter.reconnecting();
        reporter.connectError( new Error( 'connect ECONNREFUSED 127.0.0.1:1883' ) );

        const last = statuses[ statuses.length - 1 ];
        expect( last ).to.deep.equal( {
            status: 'yellow',
            connected: false,
            phase: 'reconnecting',
            msSinceLastMsg: 0,
            error: {
                code: 'CONNECT_FAILED',
                message: 'connect ECONNREFUSED 127.0.0.1:1883'
            }
        } );
    } );

    it( 'repeated identical connect errors during one retry streak emit once', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.offline();
        reporter.reconnecting();
        reporter.connectError( new Error( 'connect ECONNREFUSED' ) );
        reporter.connectError( new Error( 'connect ECONNREFUSED' ) );
        reporter.connectError( new Error( 'connect ECONNREFUSED' ) );

        const withError = statuses.filter( ( s ) => s.error && s.error.code === 'CONNECT_FAILED' );
        expect( withError ).to.have.length( 1 );
    } );

    it( 'connectError() while running turns yellow; the next decoded message heals it', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        reporter.connectError( new Error( 'unexpected protocol error' ) );

        const yellow = statuses[ statuses.length - 1 ];
        expect( yellow.status ).to.equal( 'yellow' );
        expect( yellow.phase ).to.equal( 'running' );
        expect( yellow.error.code ).to.equal( 'CONNECT_FAILED' );

        reporter.decodeOk();

        const healed = statuses[ statuses.length - 1 ];
        expect( healed.status ).to.equal( 'green' );
        expect( healed.phase ).to.equal( 'running' );
    } );

    it( 'stopped() emits green phase stopped with connected false', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        reporter.stopped();

        expect( statuses[ statuses.length - 1 ] ).to.deep.equal( {
            status: 'green',
            connected: false,
            phase: 'stopped',
            msSinceLastMsg: 0
        } );
    } );

    it( 'stopForced() emits yellow phase stopped with the note; a later stopped() adds nothing', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        reporter.stopForced( 5000 );
        reporter.stopped();

        const stops = statuses.filter( ( s ) => s.phase === 'stopped' );
        expect( stops ).to.have.length( 1 );
        expect( stops[ 0 ] ).to.deep.equal( {
            status: 'yellow',
            connected: false,
            phase: 'stopped',
            msSinceLastMsg: 0,
            note: 'Stop took longer than 5000ms — forced.'
        } );
    } );

} );

describe( 'MQTT Source Status Reporter — per-record DECODE_ERROR reports', function () {

    it( 'every decodeFailed() emits its own yellow report — never de-duplicated (ADR-018)', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        reporter.decodeFailed( 'topic \'plant/a\': Unexpected token x in JSON — message skipped' );
        reporter.decodeFailed( 'topic \'plant/a\': Unexpected token y in JSON — message skipped' );

        // The ratio-flip emission (a health transition, tested in
        // status-health.specs.js) also carries DECODE_ERROR — filter
        // it out to isolate the two per-record reports.
        const reports = statuses.filter(
            ( s ) => s.error &&
                     s.error.code === 'DECODE_ERROR' &&
                     !( /decode-error ratio/ ).test( s.error.message )
        );
        expect( reports ).to.have.length( 2 );
        expect( reports[ 0 ].status ).to.equal( 'yellow' );
        expect( reports[ 0 ].connected ).to.equal( true );
        expect( reports[ 0 ].phase ).to.equal( 'running' );
        expect( reports[ 0 ].error.message ).to.contain( 'Unexpected token x' );
        expect( reports[ 1 ].error.message ).to.contain( 'Unexpected token y' );
    } );

} );

describe( 'MQTT Source Status Reporter — the facade lines (ADR-028)', function () {

    // Every health edge and every per-record fault prints through the
    // logger facade, with or without an onStatus handler. Inside a
    // flow the runtime's own onStatus wrapper forwards only red
    // payloads when the user gave no handler, so a yellow edge that
    // only reached the payload channel used to vanish. The line is the
    // guaranteed audience; the payload additionally reaches a handler.

    let warnSpy;
    let errorSpy;

    const linesOf = function ( spy, marker ) {
        return spy.getCalls()
            .map( ( c ) => String( c.args[ 0 ] ) )
            .filter( ( line ) => line.includes( marker ) );
    };

    // Prime the ring so up to five per-record failures stay under the
    // 1 % ratio flip, which is a health edge with its own line.
    const primeRing = function ( reporter ) {
        for ( let i = 0; i < 600; i += 1 ) {
            reporter.decodeOk();
        }
    };

    const runningReporter = function ( options = {} ) {
        const clock = makeClock();
        const reporter = createStatusReporter( { nowFn: clock.nowFn, ...options } );
        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        return { clock, reporter };
    };

    beforeEach( function () {
        warnSpy = sinon.spy( console, 'warn' );
        errorSpy = sinon.spy( console, 'error' );
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'a per-record decode failure prints one warn line, with no handler', function () {
        const { reporter } = runningReporter();
        primeRing( reporter );

        reporter.decodeFailed( 'bad payload' );

        const lines = linesOf( warnSpy, 'DECODE_ERROR' );
        expect( lines ).to.have.length( 1 );
        expect( lines[ 0 ] ).to.equal( 'winkComposer/mqttSource: decode failed [DECODE_ERROR]: bad payload' );
        expect( linesOf( errorSpy, 'DECODE_ERROR' ) ).to.have.length( 0 );
    } );

    it( 'a per-record decode failure prints the same line when an onStatus handler is listening, and the payload reaches the handler too', function () {
        const statuses = [];
        const { reporter } = runningReporter( { onStatus: ( s ) => statuses.push( s ) } );
        primeRing( reporter );

        reporter.decodeFailed( 'bad payload' );

        expect( linesOf( warnSpy, 'DECODE_ERROR' ) ).to.have.length( 1 );
        const reports = statuses.filter( ( s ) => s.error && s.error.code === 'DECODE_ERROR' );
        expect( reports ).to.have.length( 1 );
        expect( reports[ 0 ].error.message ).to.equal( 'bad payload' );
    } );

    it( 'per-record decode lines are bounded: two in full per episode, the rest counted, the payload still per record', function () {
        const statuses = [];
        const { reporter } = runningReporter( { onStatus: ( s ) => statuses.push( s ) } );
        primeRing( reporter );

        reporter.decodeFailed( 'bad payload 1' );
        reporter.decodeFailed( 'bad payload 2' );
        reporter.decodeFailed( 'bad payload 3' );
        reporter.decodeFailed( 'bad payload 4' );

        const lines = linesOf( warnSpy, 'DECODE_ERROR' );
        expect( lines ).to.have.length( 2 );
        expect( lines[ 1 ] ).to.contain( 'bad payload 2' );
        const reports = statuses.filter( ( s ) => s.error && s.error.code === 'DECODE_ERROR' );
        expect( reports ).to.have.length( 4 );
    } );

    it( 'a transform throw prints one warn line, bounded on its own count', function () {
        const { reporter } = runningReporter();

        reporter.transformFailed( 'topic \'a\': transform threw: boom — message skipped' );
        reporter.transformFailed( 'topic \'a\': transform threw: boom — message skipped' );
        reporter.transformFailed( 'topic \'a\': transform threw: boom — message skipped' );

        const lines = linesOf( warnSpy, 'CALLBACK_FAILED' );
        expect( lines ).to.have.length( 2 );
        expect( lines[ 0 ] ).to.equal( 'winkComposer/mqttSource: transform failed [CALLBACK_FAILED]: topic \'a\': transform threw: boom — message skipped' );
    } );

    it( 'after a quiet minute, the next decode failure prints the summary of the counted ones, then a full line', function () {
        // The line bound paces on the stopwatch; the reporter keeps
        // its own injected clock. Only the two clocks are faked, so
        // the timers stay real.
        const stopwatch = sinon.useFakeTimers( { toFake: [ 'Date', 'performance' ] } );
        const { reporter } = runningReporter();
        primeRing( reporter );

        reporter.decodeFailed( 'bad payload 1' );
        reporter.decodeFailed( 'bad payload 2' );
        reporter.decodeFailed( 'bad payload 3' );
        reporter.decodeFailed( 'bad payload 4' );
        stopwatch.tick( 60_000 );
        reporter.decodeFailed( 'bad payload 5' );

        const lines = linesOf( warnSpy, 'DECODE_ERROR' );
        expect( lines ).to.have.length( 4 );
        expect( lines[ 2 ] ).to.equal( 'winkComposer/mqttSource: decode failed [DECODE_ERROR]: bad payload 4; 2 more in the last 60 s' );
        expect( lines[ 3 ] ).to.equal( 'winkComposer/mqttSource: decode failed [DECODE_ERROR]: bad payload 5' );
    } );

    it( 'transform faults are summarised on their own count, apart from decode faults', function () {
        const stopwatch = sinon.useFakeTimers( { toFake: [ 'Date', 'performance' ] } );
        const { reporter } = runningReporter();
        primeRing( reporter );

        reporter.transformFailed( 'transform threw: boom 1' );
        reporter.transformFailed( 'transform threw: boom 2' );
        reporter.transformFailed( 'transform threw: boom 3' );
        reporter.decodeFailed( 'bad payload' );
        stopwatch.tick( 60_000 );
        reporter.transformFailed( 'transform threw: boom 4' );

        const lines = linesOf( warnSpy, 'CALLBACK_FAILED' );
        expect( lines ).to.have.length( 4 );
        expect( lines[ 2 ] ).to.equal( 'winkComposer/mqttSource: transform failed [CALLBACK_FAILED]: transform threw: boom 3; 1 more in the last 60 s' );
        expect( linesOf( warnSpy, 'DECODE_ERROR' ) ).to.have.length( 1 );
    } );

    it( 'a forced stop prints one warn line carrying the note', function () {
        const { reporter } = runningReporter();

        reporter.stopForced( 50 );

        expect( linesOf( warnSpy, 'source stopped' ) ).to.deep.equal( [
            'winkComposer/mqttSource: source stopped: Stop took longer than 50ms — forced.'
        ] );
        expect( errorSpy.called ).to.equal( false );
    } );

    it( 'green lifecycle transitions print nothing', function () {
        const { reporter } = runningReporter();
        reporter.stopped();

        expect( warnSpy.called ).to.equal( false );
        expect( errorSpy.called ).to.equal( false );
    } );

    it( 'a yellow edge prints once at warn, and a repeat of the same status and code prints nothing', function () {
        const { reporter } = runningReporter();

        reporter.offline();
        reporter.reconnecting();
        reporter.connectError( new Error( 'connect ECONNREFUSED' ) );
        reporter.connectError( new Error( 'connect ECONNREFUSED' ) );
        reporter.reconnecting();

        const lines = linesOf( warnSpy, 'source degraded' );
        expect( lines ).to.deep.equal( [
            'winkComposer/mqttSource: source degraded: offline',
            'winkComposer/mqttSource: source degraded [CONNECT_FAILED]: connect ECONNREFUSED'
        ] );
        expect( errorSpy.called ).to.equal( false );
    } );

    it( 'a red edge prints once at error; the return to green prints once at warn with the seconds since the first non-green edge', function () {
        const { clock, reporter } = runningReporter();

        reporter.offline();
        clock.advance( DISCONNECT_RED_MS + 1 );
        reporter.tick();
        reporter.tick();
        clock.advance( 4_999 );
        reporter.connected();
        reporter.subscribed();

        const errors = linesOf( errorSpy, 'source error' );
        expect( errors ).to.have.length( 1 );
        expect( errors[ 0 ] ).to.contain( 'winkComposer/mqttSource: source error [CONNECTION_LOST]: not connected for' );
        const recovered = linesOf( warnSpy, 'source recovered' );
        expect( recovered ).to.deep.equal( [
            'winkComposer/mqttSource: source recovered [CONNECTION_LOST]: cleared after 35 s'
        ] );
    } );

    it( 'a recovery from a yellow edge without a code names the phase that cleared', function () {
        const { clock, reporter } = runningReporter();

        reporter.offline();
        clock.advance( 2_600 );
        reporter.connected();
        reporter.subscribed();

        expect( linesOf( warnSpy, 'source recovered' ) ).to.deep.equal( [
            'winkComposer/mqttSource: source recovered: offline cleared after 3 s'
        ] );
    } );

    it( 'a stop after a degraded edge prints no recovery line', function () {
        const { reporter } = runningReporter();

        reporter.offline();
        reporter.stopped();

        expect( linesOf( warnSpy, 'source recovered' ) ).to.have.length( 0 );
    } );

    it( 'the edge lines print even when an onStatus handler is listening', function () {
        const statuses = [];
        const { reporter } = runningReporter( { onStatus: ( s ) => statuses.push( s ) } );

        reporter.subscribeFailed( new Error( 'not authorized' ) );

        expect( linesOf( errorSpy, 'source error' ) ).to.deep.equal( [
            'winkComposer/mqttSource: source error [SUBSCRIBE_FAILED]: not authorized'
        ] );
        expect( statuses[ statuses.length - 1 ].error.code ).to.equal( 'SUBSCRIBE_FAILED' );
    } );

} );


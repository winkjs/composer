// core/source-manager/mqtt/test/status.specs.js

/**
 * @fileoverview Tests for the MQTT source's status reporter — factory
 * validation, lifecycle transitions, emission de-duplication, the
 * per-record DECODE_ERROR report, and the no-handler console fallback.
 *
 * The reporter is the pure state machine behind the source's
 * structured onStatus / onMetrics signals: client.js maps mqtt.js
 * events onto reporter calls 1:1, so these tests drive the reporter
 * directly with an injected clock — no fake MQTT client, no real
 * timers. Health-rule boundaries live in status-health.specs.js;
 * counters and metrics cadence in status-metrics.specs.js.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createStatusReporter } from '../status.js';
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

describe( 'MQTT Source Status Reporter — no-handler console fallback', function () {

    afterEach( function () {
        sinon.restore();
    } );

    it( 'error-path payloads fall back to a classified console.error when no onStatus is supplied', function () {
        const errorSpy = sinon.spy( console, 'error' );
        const clock = makeClock();
        const reporter = createStatusReporter( { nowFn: clock.nowFn } );

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        // Prime the ring so this one failure stays under the 1 %
        // ratio flip (1 of 201) — isolates the per-record fallback.
        for ( let i = 0; i < 200; i += 1 ) {
            reporter.decodeOk();
        }
        reporter.decodeFailed( 'bad payload' );

        const lines = errorSpy.getCalls()
            .map( ( c ) => c.args[ 0 ] )
            .filter( ( line ) => typeof line === 'string' && line.includes( 'DECODE_ERROR' ) );
        expect( lines ).to.have.length( 1 );
        expect( lines[ 0 ] ).to.equal( 'winkComposer/mqttSource: source error [DECODE_ERROR]: bad payload' );
    } );

    it( 'lifecycle payloads stay quiet without an onStatus handler (no console noise)', function () {
        const errorSpy = sinon.spy( console, 'error' );
        const clock = makeClock();
        const reporter = createStatusReporter( { nowFn: clock.nowFn } );

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        reporter.offline();
        reporter.stopped();

        expect( errorSpy.called ).to.equal( false );
    } );

} );

describe( 'MQTT Source Status Reporter — broken user callbacks are contained (ADR-018)', function () {

    // The reporter runs the user's handlers from transitions and from
    // a 1 Hz timer tick. Before the shared callback guard, a throwing
    // onStatus escaped into whichever adapter path emitted the status,
    // and a throwing onMetrics was an uncaught exception from the
    // timer — a process death on an unattended box.

    const settle = function () {
        return new Promise( ( resolve ) => setImmediate( resolve ) );
    };

    const unhandled = [];
    const trap = function ( reason ) {
        unhandled.push( reason );
    };

    beforeEach( function () {
        unhandled.length = 0;
        process.on( 'unhandledRejection', trap );
    } );

    afterEach( function () {
        process.removeListener( 'unhandledRejection', trap );
        sinon.restore();
    } );

    const guardLines = function ( spy, name ) {
        return spy.getCalls()
            .map( ( c ) => String( c.args[ 0 ] ) )
            .filter( ( l ) => l.includes( 'CALLBACK_FAILED' ) && l.includes( name ) );
    };

    it( 'contains a throwing onStatus and keeps reporting', function () {
        const reporter = createStatusReporter( {
            nowFn: makeClock().nowFn,
            onStatus: function () {
                throw new Error( 'handler down' );
            }
        } );
        const errorSpy = sinon.spy( console, 'error' );
        expect( function () {
            reporter.starting();
        } ).to.not.throw();
        expect( function () {
            reporter.stopped();
        } ).to.not.throw();
        errorSpy.restore();
        // Two transitions (starting, stopped), one emission each, one
        // contained fault each — the reporter kept reporting.
        const lines = guardLines( errorSpy, 'onStatus' );
        expect( lines ).to.have.length( 2 );
        expect( lines[ 0 ] ).to.contain( 'handler down' );
    } );

    it( 'a throwing onStatus does not change emission counts (transition suppression intact)', function () {
        const reporter = createStatusReporter( {
            nowFn: makeClock().nowFn,
            onStatus: function () {
                throw new Error( 'handler down' );
            }
        } );
        reporter.starting();
        const errorSpy = sinon.spy( console, 'error' );
        reporter.offline();
        reporter.offline();
        reporter.offline();
        errorSpy.restore();
        // Three offline() events, one transition: exactly one emission,
        // so exactly one contained fault.
        expect( guardLines( errorSpy, 'onStatus' ) ).to.have.length( 1 );
    } );

    it( 'a throwing onMetrics becomes one yellow CALLBACK_FAILED per tick and the tick survives', function () {
        const statuses = [];
        const reporter = createStatusReporter( {
            nowFn: makeClock().nowFn,
            onStatus: ( s ) => statuses.push( s ),
            onMetrics: function () {
                throw new Error( 'metrics sink down' );
            }
        } );
        // Consume the initial health transition first — a transition
        // emits its own metrics snapshot, which would add one fault.
        reporter.starting();
        statuses.length = 0;
        expect( function () {
            reporter.tick();
            reporter.tick();
        } ).to.not.throw();
        const faults = statuses.filter(
            ( s ) => s.error && ( s.error.code === 'CALLBACK_FAILED' )
        );
        expect( faults ).to.have.length( 2 );
        expect( faults[ 0 ].status ).to.equal( 'yellow' );
        expect( faults[ 0 ].error.message ).to.contain( 'onMetrics' );
        expect( faults[ 0 ].error.message ).to.contain( 'metrics sink down' );
    } );

    it( 'a broken onMetrics prints the classified console line even when onStatus is listening (fresh-eyes find, 2026-08-28)', function () {
        // Inside a flow the runtime installs its own onStatus wrapper,
        // which forwards only red payloads when the user gave no
        // handler. The yellow fault payload alone can therefore vanish.
        // The console line is the guaranteed audience.
        const statuses = [];
        const reporter = createStatusReporter( {
            nowFn: makeClock().nowFn,
            onStatus: ( s ) => statuses.push( s ),
            onMetrics: function () {
                throw new Error( 'metrics sink down' );
            }
        } );
        reporter.starting();
        statuses.length = 0;
        const errorSpy = sinon.spy( console, 'error' );
        reporter.tick();
        errorSpy.restore();
        expect( guardLines( errorSpy, 'onMetrics' ) ).to.have.length( 1 );
        // The yellow payload still reaches the listening handler too.
        const faults = statuses.filter(
            ( s ) => s.error && ( s.error.code === 'CALLBACK_FAILED' )
        );
        expect( faults ).to.have.length( 1 );
        expect( faults[ 0 ].status ).to.equal( 'yellow' );
    } );

    it( 'both onMetrics and onStatus broken: each fault contained, each on its own line', function () {
        // The onMetrics fault report itself invokes the guarded
        // onStatus. This is the one site where one guard's report can
        // trip a second guard; both must contain.
        const reporter = createStatusReporter( {
            nowFn: makeClock().nowFn,
            onStatus: function () {
                throw new Error( 'status sink down' );
            },
            onMetrics: function () {
                throw new Error( 'metrics sink down' );
            }
        } );
        reporter.starting();
        const errorSpy = sinon.spy( console, 'error' );
        expect( function () {
            reporter.tick();
            reporter.tick();
        } ).to.not.throw();
        errorSpy.restore();
        expect( guardLines( errorSpy, 'onMetrics' ) ).to.have.length( 2 );
        expect( guardLines( errorSpy, 'onStatus' ) ).to.have.length( 2 );
        expect( unhandled.length ).to.equal( 0 );
    } );

    it( 'a broken onMetrics with no onStatus falls back to the classified console line', function () {
        const reporter = createStatusReporter( {
            nowFn: makeClock().nowFn,
            onMetrics: function () {
                throw new Error( 'metrics sink down' );
            }
        } );
        // Consume the initial transition's own metrics emission before
        // counting, as above.
        reporter.starting();
        const errorSpy = sinon.spy( console, 'error' );
        reporter.tick();
        errorSpy.restore();
        expect( guardLines( errorSpy, 'onMetrics' ) ).to.have.length( 1 );
    } );

    it( 'an async onStatus that rejects never becomes an unhandled rejection', async function () {
        const reporter = createStatusReporter( {
            nowFn: makeClock().nowFn,
            onStatus: () => Promise.reject( new Error( 'late handler down' ) )
        } );
        const errorSpy = sinon.spy( console, 'error' );
        reporter.starting();
        await settle();
        await settle();
        errorSpy.restore();
        expect( guardLines( errorSpy, 'onStatus' ) ).to.have.length( 1 );
        expect( unhandled.length ).to.equal( 0 );
    } );

} );

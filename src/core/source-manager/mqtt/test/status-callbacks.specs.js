// core/source-manager/mqtt/test/status-callbacks.specs.js

/**
 * @fileoverview MQTT source status reporter — a broken user callback
 * is contained (ADR-018, ADR-027).
 *
 * The reporter runs the user's `onStatus` and `onMetrics` from
 * transitions and from a 1 Hz timer tick. Before the shared callback
 * guard, a throwing `onStatus` escaped into whichever adapter path
 * emitted the status, and a throwing `onMetrics` was an uncaught
 * exception from the timer, a process death on an unattended box.
 * These cases drive the reporter directly with an injected clock.
 * Moved out of status.specs.js, which keeps the factory, lifecycle,
 * per-record, and facade-line concerns.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createStatusReporter } from '../status.js';
import { makeClock } from './test-helpers.js';

describe( 'MQTT Source Status Reporter — broken user callbacks are contained (ADR-018)', function () {

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
        // emits its own metrics snapshot, which adds one fault. That
        // fault spends the first of the two full lines the guard prints
        // per episode (ADR-029), so of the two ticks below only the
        // first is reported in full; the second is counted.
        reporter.starting();
        statuses.length = 0;
        expect( function () {
            reporter.tick();
            reporter.tick();
        } ).to.not.throw();
        const faults = statuses.filter(
            ( s ) => s.error && ( s.error.code === 'CALLBACK_FAILED' )
        );
        expect( faults ).to.have.length( 1 );
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
        const errorSpy = sinon.spy( console, 'error' );
        reporter.starting();
        expect( function () {
            reporter.tick();
            reporter.tick();
        } ).to.not.throw();
        errorSpy.restore();
        // Each guard prints the first two faults of an episode in full
        // and counts the rest (ADR-029). The starting transition alone
        // trips both guards, so two lines on each channel is the proof
        // that each fault was contained on its own channel.
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

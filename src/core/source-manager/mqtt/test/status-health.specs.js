// core/source-manager/mqtt/test/status-health.specs.js

/**
 * @fileoverview Boundary tests for the MQTT source's health rules:
 *
 * - RED    when not connected for MORE than 30 s (strictly greater),
 *          code CONNECTION_LOST; or on a subscribe failure.
 * - YELLOW when the decode-error ratio over the last 1,000 messages
 *          is MORE than 1 % (strictly greater), code DECODE_ERROR;
 *          or when no message has arrived for more than the
 *          configured expectedQuietPeriodMs, code
 *          QUIET_PERIOD_EXCEEDED; or while offline / reconnecting.
 * - GREEN  otherwise.
 *
 * Every time rule is pinned on BOTH sides of its boundary with an
 * injected clock — no real timers, no flakiness. The time rules fire
 * on tick() (the client's 1 Hz cadence) because a silent source
 * produces no events to evaluate on.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import { createStatusReporter } from '../status.js';
import { makeClock } from './test-helpers.js';

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

describe( 'MQTT Source Health — the 30 s disconnect rule (both boundary sides)', function () {

    it( 'holds at exactly 30,000 ms disconnected, flips red at 30,001 ms', function () {
        const { clock, statuses, reporter } = collect();

        reporter.starting();

        clock.advance( 30000 );
        reporter.tick();
        expect( statuses.filter( ( s ) => s.status === 'red' ) ).to.have.length( 0 );

        clock.advance( 1 );
        reporter.tick();

        const reds = statuses.filter( ( s ) => s.status === 'red' );
        expect( reds ).to.have.length( 1 );
        expect( reds[ 0 ] ).to.deep.equal( {
            status: 'red',
            connected: false,
            phase: 'starting',
            msSinceLastMsg: 30001,
            error: {
                code: 'CONNECTION_LOST',
                message: 'not connected for 30001ms (red threshold 30000ms)'
            }
        } );
    } );

    it( 'a mid-run outage escalates yellow offline → red CONNECTION_LOST after 30 s', function () {
        const { clock, statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        reporter.offline();

        clock.advance( 30000 );
        reporter.tick();
        expect( statuses[ statuses.length - 1 ].status ).to.equal( 'yellow' );

        clock.advance( 1 );
        reporter.tick();

        const last = statuses[ statuses.length - 1 ];
        expect( last.status ).to.equal( 'red' );
        expect( last.phase ).to.equal( 'offline' );
        expect( last.error.code ).to.equal( 'CONNECTION_LOST' );
    } );

    it( 'reconnection clears the red — green running re-emitted', function () {
        const { clock, statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        reporter.offline();
        clock.advance( 30001 );
        reporter.tick();

        reporter.connected();
        reporter.subscribed();

        const last = statuses[ statuses.length - 1 ];
        expect( last.status ).to.equal( 'green' );
        expect( last.phase ).to.equal( 'running' );
    } );

    it( 'the outage clock restarts on every fresh disconnect (not cumulative)', function () {
        const { clock, statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        reporter.offline();
        clock.advance( 10000 );
        reporter.connected();
        reporter.subscribed();
        reporter.offline();

        // Second outage is only 25,000 ms old — under the threshold,
        // even though total disconnected time exceeds 30,000 ms.
        clock.advance( 25000 );
        reporter.tick();
        expect( statuses.filter( ( s ) => s.status === 'red' ) ).to.have.length( 0 );

        clock.advance( 5001 );
        reporter.tick();
        expect( statuses.filter( ( s ) => s.status === 'red' ) ).to.have.length( 1 );
    } );

    it( 'a disconnect clears a pending subscribe failure — the outage owns the story', function () {
        const { clock, statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribeFailed( new Error( 'not authorised' ) );
        reporter.offline();

        clock.advance( 30001 );
        reporter.tick();

        const last = statuses[ statuses.length - 1 ];
        expect( last.error.code ).to.equal( 'CONNECTION_LOST' );
    } );

} );

describe( 'MQTT Source Health — the 1 % decode-error ratio rule (both boundary sides)', function () {

    it( 'holds at exactly 1 % over 1,000 messages, flips yellow when the ratio exceeds it', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();

        // 990 good then 10 bad = exactly 1 % of 1,000 — not yellow.
        for ( let i = 0; i < 990; i += 1 ) {
            reporter.decodeOk();
        }
        for ( let i = 0; i < 10; i += 1 ) {
            reporter.decodeFailed( 'bad record' );
        }
        const ratioFlips = ( arr ) => arr.filter(
            ( s ) => s.error && ( /decode-error ratio/ ).test( s.error.message )
        );
        expect( ratioFlips( statuses ) ).to.have.length( 0 );

        // One more bad record evicts a good one from the ring:
        // 11 of 1,000 → above 1 % → the health flips yellow once.
        reporter.decodeFailed( 'bad record' );

        const flips = ratioFlips( statuses );
        expect( flips ).to.have.length( 1 );
        expect( flips[ 0 ].status ).to.equal( 'yellow' );
        expect( flips[ 0 ].error.code ).to.equal( 'DECODE_ERROR' );
        expect( flips[ 0 ].error.message ).to.equal(
            'decode-error ratio above 1% over the last 1000 messages'
        );
    } );

    it( 'fires early on a young stream — 1 bad in 50 is 2 %', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();

        for ( let i = 0; i < 49; i += 1 ) {
            reporter.decodeOk();
        }
        reporter.decodeFailed( 'bad record' );

        const flips = statuses.filter(
            ( s ) => s.error && ( /decode-error ratio/ ).test( s.error.message )
        );
        expect( flips ).to.have.length( 1 );
        expect( flips[ 0 ].error.message ).to.equal(
            'decode-error ratio above 1% over the last 50 messages'
        );
    } );

    it( 'heals back to green as good messages dilute the ratio', function () {
        const { statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();

        for ( let i = 0; i < 49; i += 1 ) {
            reporter.decodeOk();
        }
        reporter.decodeFailed( 'bad record' );
        expect( statuses[ statuses.length - 1 ].status ).to.equal( 'yellow' );

        // 1 bad of 101 total → 100 <= 101 → back under the threshold.
        for ( let i = 0; i < 51; i += 1 ) {
            reporter.decodeOk();
        }

        const last = statuses[ statuses.length - 1 ];
        expect( last.status ).to.equal( 'green' );
        expect( last.phase ).to.equal( 'running' );
    } );

} );

describe( 'MQTT Source Health — the quiet-period rule (opt-in, both boundary sides)', function () {

    it( 'holds at exactly the configured quiet period, flips yellow one ms past it', function () {
        const { clock, statuses, reporter } = collect( { expectedQuietPeriodMs: 5000 } );

        reporter.starting();
        reporter.connected();
        reporter.subscribed();

        clock.advance( 5000 );
        reporter.tick();
        expect( statuses.filter( ( s ) => s.status === 'yellow' ) ).to.have.length( 0 );

        clock.advance( 1 );
        reporter.tick();

        const last = statuses[ statuses.length - 1 ];
        expect( last ).to.deep.equal( {
            status: 'yellow',
            connected: true,
            phase: 'running',
            msSinceLastMsg: 5001,
            error: {
                code: 'QUIET_PERIOD_EXCEEDED',
                message: 'no message received for 5001ms (expected quiet period 5000ms)'
            }
        } );
    } );

    it( 'any arriving packet heals the quiet yellow — even a duplicate', function () {
        const { clock, statuses, reporter } = collect( { expectedQuietPeriodMs: 5000 } );

        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        clock.advance( 5001 );
        reporter.tick();
        expect( statuses[ statuses.length - 1 ].status ).to.equal( 'yellow' );

        reporter.dupSkipped();

        const last = statuses[ statuses.length - 1 ];
        expect( last.status ).to.equal( 'green' );
        expect( last.phase ).to.equal( 'running' );
    } );

    it( 'without expectedQuietPeriodMs, silence never yellows (rule is opt-in)', function () {
        const { clock, statuses, reporter } = collect();

        reporter.starting();
        reporter.connected();
        reporter.subscribed();

        clock.advance( 10 * 24 * 60 * 60 * 1000 );  // ten silent days
        reporter.tick();

        expect( statuses.filter( ( s ) => s.status === 'yellow' ) ).to.have.length( 0 );
    } );

} );

describe( 'MQTT Source Health — rule precedence', function () {

    it( 'the decode-ratio yellow outranks the quiet yellow (one emission, code DECODE_ERROR)', function () {
        const { clock, statuses, reporter } = collect( { expectedQuietPeriodMs: 100 } );

        reporter.starting();
        reporter.connected();
        reporter.subscribed();

        for ( let i = 0; i < 9; i += 1 ) {
            reporter.decodeOk();
        }
        reporter.decodeFailed( 'bad record' );   // 1 of 10 → ratio yellow

        clock.advance( 200 );                    // quiet period also exceeded now
        reporter.tick();

        const yellows = statuses.filter( ( s ) => s.status === 'yellow' && s.error );
        for ( const y of yellows ) {
            expect( y.error.code ).to.equal( 'DECODE_ERROR' );
        }
        expect( statuses.some(
            ( s ) => s.error && s.error.code === 'QUIET_PERIOD_EXCEEDED'
        ) ).to.equal( false );
    } );

    it( 'a subscribe failure outranks every yellow (red wins)', function () {
        const { statuses, reporter } = collect( { expectedQuietPeriodMs: 100 } );

        reporter.starting();
        reporter.connected();
        reporter.decodeFailed( 'bad record' );   // 1 of 1 → ratio yellow
        reporter.subscribeFailed( new Error( 'not authorised' ) );

        const last = statuses[ statuses.length - 1 ];
        expect( last.status ).to.equal( 'red' );
        expect( last.error.code ).to.equal( 'SUBSCRIBE_FAILED' );
    } );

} );

// core/source-manager/mqtt/test/clock-source.specs.js

/**
 * @fileoverview MQTT source — the time rules read the stopwatch clock,
 * never the wall clock.
 *
 * The source measures three durations: how long the link has been
 * down, how long since the last packet, and how old a dedup entry is.
 * The wall clock can step when NTP corrects a board after boot or
 * after a long time without network. A forward step would fire the
 * 30 s red early and expire every dedup entry at once. A backward
 * step would delay both. So the default clock in both modules is the
 * stopwatch clock (ADR-018, long-running stability). Each case here
 * fakes the stopwatch, jumps the wall clock an hour, and shows that
 * only the stopwatch moves the rule. The specs that inject their own
 * `nowFn` are not affected by the default.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createStatusReporter } from '../status.js';
import { createDedupCache } from '../dedup.js';
import { DISCONNECT_RED_MS } from '../constants.js';

const ONE_HOUR_MS = 3_600_000;

// The wall clock jumps forward one hour; the stopwatch does not move.
const jumpWallClock = function () {
    const later = Date.now() + ONE_HOUR_MS;
    sinon.stub( Date, 'now' ).returns( later );
};

describe( 'MQTT Source — clock source of the time rules', function () {

    beforeEach( function () {
        // The edges below print through the facade; keep the run quiet.
        sinon.stub( console, 'warn' );
        sinon.stub( console, 'error' );
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'a wall-clock jump does not move the disconnect rule; the stopwatch does', function () {
        const stopwatch = sinon.useFakeTimers( { toFake: [ 'performance' ] } );
        const statuses = [];
        const reporter = createStatusReporter( { onStatus: ( s ) => statuses.push( s ) } );
        reporter.starting();
        reporter.connected();
        reporter.subscribed();
        reporter.offline();

        jumpWallClock();
        reporter.tick();
        const last = statuses[ statuses.length - 1 ];
        expect( last.status ).to.equal( 'yellow' );
        expect( last.phase ).to.equal( 'offline' );

        stopwatch.tick( DISCONNECT_RED_MS + 1 );
        reporter.tick();
        const red = statuses[ statuses.length - 1 ];
        expect( red.status ).to.equal( 'red' );
        expect( red.error.code ).to.equal( 'CONNECTION_LOST' );
    } );

    it( 'a wall-clock jump does not expire dedup entries; the stopwatch does', function () {
        const WINDOW_MS = 120_000;
        const stopwatch = sinon.useFakeTimers( { toFake: [ 'performance' ] } );
        const cache = createDedupCache( { windowMs: WINDOW_MS } );

        expect( cache.isDuplicate( 'id-1' ) ).to.equal( false );
        jumpWallClock();
        // Still held: the entry is no older on the stopwatch.
        expect( cache.isDuplicate( 'id-1' ) ).to.equal( true );
        expect( cache.size() ).to.equal( 1 );

        stopwatch.tick( WINDOW_MS );
        // Expired on the stopwatch: the id is admitted as new again.
        expect( cache.isDuplicate( 'id-1' ) ).to.equal( false );
    } );

} );

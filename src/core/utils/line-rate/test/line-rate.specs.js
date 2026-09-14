// core/utils/line-rate/test/line-rate.specs.js

/**
 * @fileoverview Unit specs for the shared line bound.
 *
 * A line bound decides how a repeating event reaches the log. The
 * first few events of an episode print in full. After them the events
 * are counted, and one summary line prints per interval with the count
 * since the last line. A quiet interval ends the episode, so the next
 * event prints in full again. The QuestDB adapter's default `onWarning`
 * and the shared callback guard both use it.
 *
 * The clock is fake, so every interval has a value the spec can name.
 * Every case here was written before the module and proven red.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createLineBound } from '../index.js';

/** A fixed wall clock, so every duration has a value the spec can name. */
const NOW = 1735500000000;

const INTERVAL_MS = 60000;

describe( 'line bound — the first lines in full, then one summary per interval', function () {

    let clock;
    let printFull;
    let printSummary;
    let report;

    beforeEach( function () {
        clock = sinon.useFakeTimers( { now: NOW } );
        printFull = sinon.spy();
        printSummary = sinon.spy();
        report = createLineBound( { fullLines: 2, intervalMs: INTERVAL_MS, printFull, printSummary } );
    } );

    afterEach( function () {
        clock.restore();
        sinon.restore();
    } );

    /** Reports `count` events, one per second, starting now. */
    const eventEverySecond = function ( count, a, b, c ) {
        for ( let i = 0; i < count; i += 1 ) {
            report( a, b, c );
            clock.tick( 1000 );
        }
    }; // eventEverySecond()

    it( 'the first two events print in full, with their arguments by identity', function () {
        const ctx = { key: 'x' };

        report( 'a', ctx, 3 );
        report( 'b', ctx, 4 );

        expect( printFull.callCount ).to.equal( 2 );
        expect( printFull.firstCall.args ).to.deep.equal( [ 'a', ctx, 3 ] );
        expect( printFull.firstCall.args[ 1 ] ).to.equal( ctx );
        expect( printFull.secondCall.args ).to.deep.equal( [ 'b', ctx, 4 ] );
        expect( printSummary.called ).to.equal( false );
    } );

    it( 'events inside the interval after the second line print nothing', function () {
        eventEverySecond( 60, 'v', 'p' );

        expect( printFull.callCount ).to.equal( 2 );
        expect( printSummary.called ).to.equal( false );
    } );

    it( 'the first event a full interval after the last line prints one summary with the count and the seconds', function () {
        // Full lines at 0 s and 1 s. Events at 2 s to 60 s are counted:
        // 59 of them. The event at 61 s is 60 s after the last line, so
        // it prints the summary and is the 60th counted.
        eventEverySecond( 61, 'v', 'p' );
        expect( printSummary.called ).to.equal( false );

        report( 'latest', 'p7' );

        expect( printSummary.calledOnce ).to.equal( true );
        expect( printSummary.firstCall.args ).to.deep.equal( [ 60, 60, 'latest', 'p7', undefined ] );
        expect( printFull.callCount ).to.equal( 2 );
    } );

    it( 'a summary resets the count, so the next interval carries only the events since', function () {
        eventEverySecond( 62, 'v', 'p' );
        expect( printSummary.callCount ).to.equal( 1 );

        // 59 more inside the next interval print nothing. The 60th, a
        // full interval after the summary, prints the next one.
        eventEverySecond( 59, 'v', 'p' );
        expect( printSummary.callCount ).to.equal( 1 );
        report( 'v', 'p' );

        expect( printSummary.callCount ).to.equal( 2 );
        expect( printSummary.secondCall.args[ 0 ] ).to.equal( 60 );
        expect( printSummary.secondCall.args[ 1 ] ).to.equal( 60 );
    } );

    it( 'a quiet interval ends the episode: the next event prints in full again', function () {
        report( 'v', 'p' );
        report( 'v', 'p' );
        clock.tick( INTERVAL_MS );

        report( 'again', 'p' );

        expect( printFull.callCount ).to.equal( 3 );
        expect( printFull.thirdCall.args ).to.deep.equal( [ 'again', 'p', undefined ] );
        expect( printSummary.called ).to.equal( false );
    } );

    it( 'a quiet interval with counted events prints their summary first, then the new event in full', function () {
        // Two in full, then three counted within 30 s. Then quiet for a
        // full interval. The next event closes the old episode with a
        // summary of the three, naming the last of them, and opens a new
        // one in full.
        report( 'v', 'p1' );
        report( 'v', 'p1' );
        clock.tick( 10000 );
        report( 'v', 'p2' );
        clock.tick( 10000 );
        report( 'v', 'p3' );
        clock.tick( 10000 );
        report( 'late', 'p4' );
        clock.tick( INTERVAL_MS );

        report( 'fresh', 'p5' );

        expect( printSummary.calledOnce ).to.equal( true );
        expect( printSummary.firstCall.args ).to.deep.equal( [ 3, 90, 'late', 'p4', undefined ] );
        expect( printFull.callCount ).to.equal( 3 );
        expect( printFull.thirdCall.args ).to.deep.equal( [ 'fresh', 'p5', undefined ] );
        expect( printSummary.firstCall.calledBefore( printFull.thirdCall ) ).to.equal( true );
    } );

    it( 'a step in the wall clock neither ends the episode nor prints a summary', function () {
        // Two in full, one counted. Then the wall clock jumps an hour
        // while the stopwatch stands still: NTP corrected the board, or
        // an operator set the time. The bound reads the stopwatch, so
        // the next event is still inside the interval: counted, not
        // printed, and no summary.
        report( 'v', 'p' );
        report( 'v', 'p' );
        report( 'v', 'p' );
        clock.setSystemTime( NOW + ( 3600 * 1000 ) );

        report( 'v', 'p' );

        expect( printFull.callCount ).to.equal( 2 );
        expect( printSummary.called ).to.equal( false );
    } );

    it( 'a quiet interval just short of the bound keeps the episode open', function () {
        report( 'v', 'p' );
        report( 'v', 'p' );
        clock.tick( INTERVAL_MS - 1 );

        report( 'v', 'p' );

        expect( printFull.callCount ).to.equal( 2 );
        expect( printSummary.called ).to.equal( false );
    } );

    it( 'a summary printer that throws costs that one line, and the cadence resumes from it', function () {
        // The bound clears its count and stamps the line before it
        // calls the printer, so a throw from the printer leaves nothing
        // behind. The throw reaches the caller once. The next interval
        // is counted from the failed line, as if it had printed.
        const throwingSummary = sinon.stub();
        throwingSummary.onFirstCall().throws( new Error( 'report channel down' ) );
        const bound = createLineBound( {
            fullLines: 2, intervalMs: INTERVAL_MS, printFull, printSummary: throwingSummary
        } );
        const everySecond = function ( count ) {
            for ( let i = 0; i < count; i += 1 ) {
                bound( 'v', 'p' );
                clock.tick( 1000 );
            }
        };

        // Full lines at 0 s and 1 s, 59 counted to 60 s. The event at
        // 61 s is the 60th counted and calls the printer, which throws.
        everySecond( 61 );
        expect( () => bound( 'v', 'p' ) ).to.throw( 'report channel down' );
        expect( throwingSummary.firstCall.args[ 0 ] ).to.equal( 60 );

        // Events at 62 s to 120 s are inside the next interval: nothing
        // prints. The event at 121 s is 60 s after the failed line and
        // carries exactly the 60 events since it.
        clock.tick( 1000 );
        everySecond( 59 );
        expect( throwingSummary.callCount ).to.equal( 1 );
        bound( 'v', 'p' );

        expect( throwingSummary.callCount ).to.equal( 2 );
        expect( throwingSummary.secondCall.args ).to.deep.equal( [ 60, 60, 'v', 'p', undefined ] );
        expect( printFull.callCount ).to.equal( 2 );
    } );

    it( 'a bound with one full line prints one, and counts from the second event on', function () {
        const one = createLineBound( { fullLines: 1, intervalMs: INTERVAL_MS, printFull, printSummary } );

        one( 'v', 'p' );
        one( 'v', 'p' );
        expect( printFull.callCount ).to.equal( 1 );
        expect( printSummary.called ).to.equal( false );

        // The quiet interval closes the episode: the one counted event
        // is summarized, then the fresh event prints in full.
        clock.tick( INTERVAL_MS );
        one( 'v', 'p' );

        expect( printSummary.calledOnce ).to.equal( true );
        expect( printSummary.firstCall.args[ 0 ] ).to.equal( 1 );
        expect( printFull.callCount ).to.equal( 2 );
    } );

} );

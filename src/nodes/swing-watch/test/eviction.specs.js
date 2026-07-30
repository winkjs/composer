import { describe, it } from 'mocha';
// @fileoverview
// Eviction exactly-once tests — the emission layer over window transits.
//
// The GUDHI golden truth validates the STATIC per-window persistence diagram;
// these specs validate the EMISSION STREAM, which the diagram cannot see.
// Every signal here is a broad swing (multi-sample limbs) driven through the
// full width of the window, because narrow features annihilate cleanly at
// the boundary and never trigger the re-emission mechanisms. Discovered
// 2026-07-20 when the first real-data run showed 46–78% duplicate events.
//
// The three suppression rules under test (update.js, Section 3):
//   (a) boundary-born pairs (birthIdx 0) never emit
//   (b) a pair inheriting its death vertex from a pair whose birth vertex
//       was just evicted is the same swing re-formed
//   (c) a birth vertex drives at most one emission while it lives (per-slot
//       accounted flag, cleared on overwrite)

import { expect } from 'chai';
import * as swingWatch from '../index.js';
import { makeSpec, feedSignal, collectEvents } from './test-helpers.js';

// Rising tail: n samples continuing from `from` in steps of `step`.
const tail = function ( from, step, n ) {
    return Array.from( { length: n }, ( _, i ) => from + ( step * ( i + 1 ) ) );
}; // tail()

// Two-V walk signal (W=60): descend 100→80, ascend to 98 (deep V), descend
// to 90, ascend to 100 (shallow V), then a slow monotone rise for three
// window widths. Intended: ONE dip completion — the shallow V (birth 90)
// pairs against the middle peak (98), persistence 8. The deep V is the
// elder and never completes; its shoulder walking out must stay silent.
const buildWalk = function () {
    const s = [];
    for ( let v = 100; v > 80; v -= 1 ) s.push( v );
    for ( let v = 80; v < 98; v += 1 ) s.push( v );
    for ( let v = 98; v > 90; v -= 1 ) s.push( v );
    for ( let v = 90; v < 100; v += 1 ) s.push( v );
    s.push( ...tail( 100, 0.01, 180 ) );
    return s;
}; // buildWalk()

// Rebirth signal (W=8, eps=0.5): deep min A=1, sub-threshold ripple (bump
// 1.3, ripple min 1.2), peak Q=9, deeper min C=0.5, rising tail. Intended:
// ONE dip completion — (A, Q) persistence 8 on the first full window. When
// A evicts, the pair re-forms around the ripple (1.2) inheriting Q; that
// rebirth must stay silent.
const REBIRTH_SIGNAL = [ 10, 1, 1.3, 1.2, 9, 0.5, ...tail( 0.5, 0.1, 10 ) ];

// Re-pair signal (W=8, eps=0.3): elder L=0.2, peak P=5, min m=1, peak R=9,
// min D=0.5, rising tail. First full window: TWO new pairs on one tick —
// (m, P) persistence 4 and (D, R) persistence 8.5. swingsThisTick accounts
// both; the completion detail slots carry the deeper (D, R). When L evicts,
// m re-pairs at R — already accounted, must stay silent.
const REPAIR_SIGNAL = [ 0.2, 5, 1, 9, 0.5, ...tail( 0.5, 0.1, 10 ) ];

// Elder-flip signal (W=8, eps=0.5): elder bottom 1 with an interior ripple
// (bump 3.7, ripple min 3.5), peak 9, min 3, rising tail. First full
// window: pair (3, 9) persistence 6. When the elder bottom evicts, the
// ripple 3.5 becomes the component birth, flips younger, and pairs (3.5, 9)
// persistence 5.5 — a previously subsumed swing revealed by truncation.
// Emitting it ONCE is intended behaviour.
const FLIP_SIGNAL = [ 10, 1, 3.7, 3.5, 9, 3, ...tail( 3, 0.05, 10 ) ];

const dipEvents = function ( msgs ) {
    return collectEvents( msgs ).filter( ( e ) => e.dipCompleted );
}; // dipEvents()

describe( 'swingWatch eviction exactly-once', function () {
    it( 'rule (a): stays silent while an evicted deep swing walks out', function () {
        const { msgs } = feedSignal( buildWalk(), { windowSize: 60, threshold: 2, direction: 'dips' } );
        const events = dipEvents( msgs );
        expect( events.length ).to.equal( 1 );
        expect( events[ 0 ].tick ).to.equal( 59 );
        expect( events[ 0 ].dipValue ).to.equal( 90 );
        expect( events[ 0 ].dipSize ).to.equal( 8 );
        // The unfixed node re-fired on ticks 90–95 as the shoulder walked out.
        for ( let t = 90; t <= 95; t += 1 ) {
            expect( msgs[ t ].me ).to.equal( false );
        }
    } );

    it( 'rule (b): suppresses the rebirth pair after its birth vertex evicts', function () {
        const { msgs } = feedSignal( REBIRTH_SIGNAL, { windowSize: 8, direction: 'dips' } );
        const events = dipEvents( msgs );
        expect( events.length ).to.equal( 1 );
        expect( events[ 0 ].tick ).to.equal( 7 );
        expect( events[ 0 ].dipValue ).to.equal( 1 );
        expect( events[ 0 ].dipSize ).to.equal( 8 );
        // The unfixed node emitted (1.2, 9) here — the same swing re-formed.
        expect( msgs[ 9 ].me ).to.equal( false );
    } );

    it( 'rule (c): a minimum accounted once never re-emits at a new death vertex', function () {
        const { msgs } = feedSignal( REPAIR_SIGNAL, { windowSize: 8, threshold: 0.3, direction: 'dips' } );
        const events = dipEvents( msgs );
        expect( events.length ).to.equal( 1 );
        expect( events[ 0 ].tick ).to.equal( 7 );
        // Both concurrent swings are accounted; detail carries the deeper.
        expect( msgs[ 7 ].pops ).to.equal( 2 );
        expect( events[ 0 ].dipValue ).to.equal( 0.5 );
        expect( events[ 0 ].dipSize ).to.equal( 8.5 );
        // The unfixed node re-emitted m (birth 1, persistence 8) here.
        expect( msgs[ 8 ].me ).to.equal( false );
    } );

    it( 'emits a truncation-revealed swing exactly once (elder flip)', function () {
        const { msgs } = feedSignal( FLIP_SIGNAL, { windowSize: 8, direction: 'dips' } );
        const events = dipEvents( msgs );
        expect( events.length ).to.equal( 2 );
        expect( events[ 0 ].tick ).to.equal( 7 );
        expect( events[ 0 ].dipValue ).to.equal( 3 );
        expect( events[ 0 ].dipSize ).to.equal( 6 );
        expect( events[ 1 ].tick ).to.equal( 9 );
        expect( events[ 1 ].dipValue ).to.be.closeTo( 3.5, 1e-12 );
        expect( events[ 1 ].dipSize ).to.be.closeTo( 5.5, 1e-12 );
    } );

    it( 'applies the same suppression on the max side (negated rebirth signal)', function () {
        const negated = REBIRTH_SIGNAL.map( ( v ) => -v );
        const { msgs } = feedSignal( negated, { windowSize: 8, direction: 'peaks' } );
        const events = collectEvents( msgs ).filter( ( e ) => e.peakCompleted );
        expect( events.length ).to.equal( 1 );
        expect( events[ 0 ].tick ).to.equal( 7 );
        expect( events[ 0 ].peakValue ).to.equal( -1 );
        expect( events[ 0 ].peakSize ).to.equal( 8 );
        expect( msgs[ 9 ].xe ).to.equal( false );
    } );

    it( 'a genuine second swing after a full window transit still emits (flag slots wrap)', function () {
        // Extend the walk signal with a second two-V structure far past the
        // first transit: descend 10 (deep, elder side), ascend 8 (middle
        // peak), descend 4 (shallow bottom), rise. Intended second emission:
        // birth = shallow bottom, persistence = middle peak − shallow bottom
        // = 4. By then the ring head has wrapped, exercising the slot
        // arithmetic in the accounted-flag mapping.
        const s = buildWalk();
        const last = s[ s.length - 1 ];
        for ( let k = 1; k <= 10; k += 1 ) s.push( last - k );          // → last−10
        for ( let k = 1; k <= 8; k += 1 ) s.push( ( last - 10 ) + k );  // → last−2
        for ( let k = 1; k <= 4; k += 1 ) s.push( ( last - 2 ) - k );   // → last−6
        s.push( ...tail( last - 6, 0.5, 20 ) );

        const { msgs } = feedSignal( s, { windowSize: 60, threshold: 2, direction: 'dips' } );
        const events = dipEvents( msgs );
        expect( events.length ).to.equal( 2 );
        expect( events[ 1 ].dipValue ).to.be.closeTo( last - 6, 1e-9 );
        expect( events[ 1 ].dipSize ).to.be.closeTo( 4, 1e-9 );
    } );

    it( 'reset clears the accounted flags — completions may fire afresh', function () {
        const spec  = makeSpec( { windowSize: 8, direction: 'dips' } );
        const state = swingWatch.init( spec );
        const pass = function () {
            let count = 0;
            for ( const v of REBIRTH_SIGNAL ) {
                const msg = { v };
                swingWatch.update( state, msg );
                swingWatch.publishTo( state, msg );
                if ( msg.me === true ) count += 1;
            }
            return count;
        };
        expect( pass() ).to.equal( 1 );
        swingWatch.reset( state );
        expect( pass() ).to.equal( 1 );
    } );

    it( 'recompute does not re-burst already-accounted completions', function () {
        const spec  = makeSpec( { windowSize: 60, threshold: 2, direction: 'dips' } );
        const state = swingWatch.init( spec );
        const signal = buildWalk();
        let count = 0;
        const feedOne = function ( v ) {
            const msg = { v };
            swingWatch.update( state, msg );
            swingWatch.publishTo( state, msg );
            if ( msg.me === true ) count += 1;
        };
        for ( let i = 0; i < 65; i += 1 ) feedOne( signal[ i ] );
        expect( count ).to.equal( 1 );
        // Recompute clears previous-tick pairs; the accounted flags survive,
        // so re-derived pairs must not fire again.
        swingWatch.recompute( state );
        for ( let i = 65; i < signal.length; i += 1 ) feedOne( signal[ i ] );
        expect( count ).to.equal( 1 );
    } );
} );

import { describe, it } from 'mocha';
// @fileoverview
// update.js tests — core algorithm, threshold, window behaviour.

import { expect } from 'chai';
import sinon from 'sinon';
import * as swingWatch from '../index.js';
import { makeSpec, feedSignal, collectEvents } from './test-helpers.js';

describe( 'swingWatch update', function () {
    // ── Hand-crafted signal [5, 1, 3, 2, 4, 0, 2] ──────────
    // Expected min pairs (topological): (2@3, 3@2, p=1) (1@1, 4@4, p=3)
    // Expected max pairs (topological): (3@2, 2@3, p=1) (4@4, 1@1, p=3) (2@6, 0@5, p=2)

    it( 'detects min and max pairs on the hand-crafted signal', function () {
        const { state, msgs } = feedSignal( [ 5, 1, 3, 2, 4, 0, 2 ] );
        // First event at tick 6 (window fills)
        expect( msgs[ 6 ].me ).to.equal( true );
        expect( msgs[ 6 ].xe ).to.equal( true );
        expect( state.minPairCount ).to.equal( 2 );
        expect( state.maxPairCount ).to.equal( 3 );
    } );

    it( 'emits the deepest min pair as the completion event', function () {
        const { msgs } = feedSignal( [ 5, 1, 3, 2, 4, 0, 2 ] );
        expect( msgs[ 6 ].mp ).to.equal( 3 );
        expect( msgs[ 6 ].mb ).to.equal( 1 );
    } );

    it( 'emits the deepest max pair as the completion event', function () {
        const { msgs } = feedSignal( [ 5, 1, 3, 2, 4, 0, 2 ] );
        expect( msgs[ 6 ].xp ).to.equal( 3 );
        expect( msgs[ 6 ].xb ).to.equal( 4 );
    } );

    it( 'reports correct swingsThisTick on first full window', function () {
        const { msgs } = feedSignal( [ 5, 1, 3, 2, 4, 0, 2 ] );
        // 2 min + 2 max accounted. The third max pair (birth 2 at index 6)
        // is born at the newest sample and stays provisional (emission
        // rule d) — stored in the diagram but not yet a certified event.
        expect( msgs[ 6 ].pops ).to.equal( 4 );
    } );

    // ── Threshold filtering ──────────────────────────────────

    it( 'filters pairs below threshold', function () {
        // With threshold 2, only pairs with p >= 2 should survive
        const { state } = feedSignal( [ 5, 1, 3, 2, 4, 0, 2 ], { threshold: 2 } );
        // Min: p=1 filtered, p=3 kept → 1 pair
        expect( state.minPairCount ).to.equal( 1 );
        // Max: p=1 filtered, p=3 and p=2 kept → 2 pairs
        expect( state.maxPairCount ).to.equal( 2 );
    } );

    it( 'emits nothing when threshold exceeds all persistence values', function () {
        const { msgs } = feedSignal( [ 5, 1, 3, 2, 4, 0, 2 ], { threshold: 100 } );
        expect( msgs[ 6 ].me ).to.equal( false );
        expect( msgs[ 6 ].xe ).to.equal( false );
    } );

    // ── Constant signal (no extrema) ─────────────────────────

    it( 'emits nothing on a constant signal', function () {
        const signal = new Array( 10 ).fill( 5 );
        const { msgs } = feedSignal( signal, { windowSize: 10, threshold: 0.001 } );
        const events = collectEvents( msgs );
        expect( events.length ).to.equal( 0 );
    } );

    // ── Monotonic signal (no interior extrema) ───────────────

    it( 'emits nothing on a monotonically increasing signal', function () {
        const signal = Array.from( { length: 10 }, ( _, i ) => i );
        const { msgs } = feedSignal( signal, { windowSize: 10, threshold: 0.001 } );
        const events = collectEvents( msgs );
        expect( events.length ).to.equal( 0 );
    } );

    it( 'emits nothing on a monotonically decreasing signal', function () {
        const signal = Array.from( { length: 10 }, ( _, i ) => 10 - i );
        const { msgs } = feedSignal( signal, { windowSize: 10, threshold: 0.001 } );
        const events = collectEvents( msgs );
        expect( events.length ).to.equal( 0 );
    } );

    // ── Direction option ─────────────────────────────────────

    it( 'detects only dips when direction is dips', function () {
        const { state, msgs } = feedSignal( [ 5, 1, 3, 2, 4, 0, 2 ], { direction: 'dips' } );
        expect( msgs[ 6 ].me ).to.equal( true );
        expect( msgs[ 6 ].xe ).to.equal( false );
        expect( state.maxPairCount ).to.equal( 0 );
    } );

    it( 'detects only peaks when direction is peaks', function () {
        const { state, msgs } = feedSignal( [ 5, 1, 3, 2, 4, 0, 2 ], { direction: 'peaks' } );
        expect( msgs[ 6 ].me ).to.equal( false );
        expect( msgs[ 6 ].xe ).to.equal( true );
        expect( state.minPairCount ).to.equal( 0 );
    } );

    // ── Sliding window (pair diffing) ────────────────────────

    it( 'does not re-emit pairs that persist across ticks', function () {
        // Signal: [10, 0, 10, 0, 10, 0, 10, 0, 10]  windowSize=5
        // Tick 4 (window [10,0,10,0,10]): the diagram holds 1 min pair and
        // 2 max pairs; one max pair is born at the newest sample and stays
        // provisional (emission rule d), so 2 pairs are accounted.
        // Ticks 5–8: each new sample confirms the extremum that arrived one
        // tick earlier (rule d defers by one tick), so the sides alternate
        // starting with the max side; persisting pairs never re-emit.
        const signal = [ 10, 0, 10, 0, 10, 0, 10, 0, 10 ];
        const { msgs } = feedSignal( signal, { windowSize: 5, threshold: 0.001 } );

        // Tick 4: initial full window emits its certified pairs.
        expect( msgs[ 4 ].me ).to.equal( true );
        expect( msgs[ 4 ].xe ).to.equal( true );
        expect( msgs[ 4 ].pops ).to.equal( 2 );

        // Ticks 5–8: alternating single-sided emissions — never both, always
        // exactly one newly confirmed pair per tick.
        expect( msgs[ 5 ].me ).to.equal( false );
        expect( msgs[ 5 ].xe ).to.equal( true );
        expect( msgs[ 5 ].pops ).to.equal( 1 );
        expect( msgs[ 6 ].me ).to.equal( true );
        expect( msgs[ 6 ].xe ).to.equal( false );
        expect( msgs[ 6 ].pops ).to.equal( 1 );
        expect( msgs[ 7 ].me ).to.equal( false );
        expect( msgs[ 7 ].xe ).to.equal( true );
        expect( msgs[ 7 ].pops ).to.equal( 1 );
        expect( msgs[ 8 ].me ).to.equal( true );
        expect( msgs[ 8 ].xe ).to.equal( false );
        expect( msgs[ 8 ].pops ).to.equal( 1 );
    } );

    // ── Warmup ───────────────────────────────────────────────

    it( 'does not emit during warmup', function () {
        const { msgs } = feedSignal( [ 5, 1, 3, 2, 4, 0, 2 ] );
        for ( let i = 0; i < 6; i += 1 ) {
            expect( msgs[ i ].me ).to.equal( undefined );
            expect( msgs[ i ].xe ).to.equal( undefined );
        }
    } );

    // ── birthLag correctness ─────────────────────────────────

    it( 'reports correct birthLag for minima', function () {
        const { msgs } = feedSignal( [ 5, 1, 3, 2, 4, 0, 2 ] );
        // Deepest min pair: birth at idx 1 (val 1), window has 7 samples.
        // Linearized: idx 1 is the second sample. birthLag = (W-1) - 1 = 5.
        expect( msgs[ 6 ].ml ).to.equal( 5 );
    } );

    // ── minAbsoluteThreshold floor ───────────────────────────

    it( 'applies minAbsoluteThreshold as a floor', function () {
        // Adaptive threshold resolves to 0.5 (from spec), but floor is 10.
        const { msgs } = feedSignal( [ 5, 1, 3, 2, 4, 0, 2 ],
            { threshold: 0.5, minAbsoluteThreshold: 10 } );
        // All pairs have persistence <= 3, so floor=10 filters everything.
        expect( msgs[ 6 ].me ).to.equal( false );
        expect( msgs[ 6 ].xe ).to.equal( false );
    } );

    // ── Diagnostic: swingRate ────────────────────────────────

    it( 'tracks swingRate correctly', function () {
        const { state } = feedSignal( [ 5, 1, 3, 2, 4, 0, 2 ] );
        // received=7, emitted=2 (tick 6 fires both dip and peak completions)
        expect( state.received ).to.equal( 7 );
        expect( state.emitted ).to.equal( 2 );
        expect( state.swingRate ).to.be.closeTo( 2 / 7, 1e-9 );
    } );

    // ── Tunable threshold (function) ─────────────────────────

    it( 'resolves threshold from a function', function () {
        // threshold = (msg) => msg.sigma * 2; pass sigma=1 → eps=2
        const spec = makeSpec( { threshold: ( msg ) => ( msg.sigma || 0 ) * 2 } );
        const state = swingWatch.init( spec );
        for ( const v of [ 5, 1, 3, 2, 4, 0, 2 ] ) {
            swingWatch.update( state, { v, sigma: 1 } );
        }
        // eps=2: min pair p=1 filtered, p=3 kept → 1 pair
        expect( state.minPairCount ).to.equal( 1 );
    } );

    // ── Tunable error handling (matches threshold node's pattern) ─
    describe( 'tunable error path', function () {
        it( 'logs once and flags tunableErrorLogged on first throw', function () {
            const spec = makeSpec( { threshold: () => {
                throw new Error( 'boom' );
            } } );
            const state = swingWatch.init( spec );
            const stub  = sinon.stub( console, 'error' );
            try {
                swingWatch.update( state, { v: 1 } );
                expect( state.tunableErrorLogged ).to.equal( true );
                expect( stub.calledOnce ).to.equal( true );
                expect( stub.firstCall.args[ 0 ] ).to.include( 'tunable threw' );
            } finally {
                stub.restore();
            }
        } );

        it( 'suppresses repeat logging within one error episode', function () {
            const spec = makeSpec( { threshold: () => {
                throw new Error( 'boom' );
            } } );
            const state = swingWatch.init( spec );
            const stub  = sinon.stub( console, 'error' );
            try {
                for ( let i = 0; i < 10; i += 1 ) swingWatch.update( state, { v: i } );
                expect( stub.callCount ).to.equal( 1 );
            } finally {
                stub.restore();
            }
        } );

        it( 'clears tunableErrorLogged when the tunable recovers', function () {
            // Throws when sigma === 0, returns 2*sigma otherwise.
            const spec = makeSpec( { threshold: ( msg ) => {
                if ( msg.sigma === 0 ) throw new Error( 'bad sigma' );
                return 2 * msg.sigma;
            } } );
            const state = swingWatch.init( spec );
            const stub  = sinon.stub( console, 'error' );
            try {
                swingWatch.update( state, { v: 1, sigma: 0 } );
                expect( state.tunableErrorLogged ).to.equal( true );
                // Subsequent successful resolve clears the suppression flag
                swingWatch.update( state, { v: 2, sigma: 1 } );
                expect( state.tunableErrorLogged ).to.equal( false );
            } finally {
                stub.restore();
            }
        } );
    } );

    // ── mergeNoEmit tie-break on plateaus ────────────────────
    // Plateaus of equal values force the union-find to break ties by index
    // during extension. Without these, the tie-break branches in
    // mergeNoEmitSub / mergeNoEmitSup would never execute.
    it( 'handles a sublevel plateau adjacent to a deeper minimum', function () {
        // [5, 3, 3, 3, 5, 1, 5] — plateau at positions 1–3 (val 3), deeper
        // minimum at position 5 (val 1). The plateau extension walks across
        // equal values (exercising mergeNoEmitSub tie-break), then merges
        // with the deeper component, emitting one pair.
        const { state } = feedSignal( [ 5, 3, 3, 3, 5, 1, 5 ],
            { windowSize: 7, threshold: 0.001 } );
        expect( state.minPairCount ).to.equal( 1 );
        expect( state.minPersArr[ 0 ] ).to.equal( 2 );
    } );

    it( 'handles a superlevel plateau split by a valley', function () {
        // [5, 5, 1, 5, 5] — two equal maxima plateaus at positions 0–1 and
        // 3–4, separated by a valley at position 2. The sweep extends each
        // plateau in backward order (exercising mergeNoEmitSup tie-break),
        // then merges across the valley, emitting one pair.
        const { state } = feedSignal( [ 5, 5, 1, 5, 5 ],
            { windowSize: 5, threshold: 0.001 } );
        expect( state.maxPairCount ).to.equal( 1 );
        expect( state.maxPersArr[ 0 ] ).to.equal( 4 );
    } );

    // ── collectEvents body ───────────────────────────────────
    it( 'collectEvents captures completion details on the hand-crafted signal', function () {
        const { msgs } = feedSignal( [ 5, 1, 3, 2, 4, 0, 2 ] );
        const events = collectEvents( msgs );
        expect( events.length ).to.equal( 1 );
        expect( events[ 0 ].tick ).to.equal( 6 );
        expect( events[ 0 ].dipCompleted ).to.equal( true );
        expect( events[ 0 ].peakCompleted ).to.equal( true );
        expect( events[ 0 ].pops ).to.equal( 4 );
        expect( events[ 0 ].dipSize ).to.equal( 3 );
        expect( events[ 0 ].peakSize ).to.equal( 3 );
    } );
} );

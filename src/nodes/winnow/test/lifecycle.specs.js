// nodes/winnow/test/lifecycle.specs.js

/**
 * @fileoverview Tests for winnow lifecycle operations.
 *
 * Covers reset, recompute, control signals (disable/enable/pause/
 * unpause), idempotent reset, publishTo-without-prior-update, and
 * the cold-start → warm → reset → warm-again cycle.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';

import * as winnow from '../index.js';
import { baseSpec, bufferSpec, makeMsg } from './test-helpers.js';

// ── reset ──────────────────────────────────────────────────────────────────

describe( 'winnow — reset', function () {

    it( 'clears anchor and counter', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, makeMsg( 110, { gate: 50 } ) );
        expect( state.anchor ).to.equal( 110 );
        expect( state.counter ).to.equal( 2 );

        winnow.reset( state );
        expect( state.anchor ).to.equal( null );
        expect( state.counter ).to.equal( 0 );
        expect( state.significant ).to.equal( false );
        expect( state.deviation ).to.equal( 0 );
        expect( state.prevDirection ).to.equal( null );
    } );

    it( 'next message after reset triggers warmup', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100 ) );
        winnow.reset( state );
        winnow.update( state, makeMsg( 200 ) );
        expect( state.significant ).to.equal( true );
        expect( state.anchor ).to.equal( 200 );
    } );

    it( 'resets buffer state', function () {
        const state = winnow.init( bufferSpec() );
        winnow.update( state, makeMsg( 100, { ts: 1000 } ) );
        winnow.update( state, makeMsg( 200, { ts: 2000, gate: 50 } ) );
        expect( state.keptByGate ).to.equal( true );
        expect( state.bufferedX ).to.equal( 200 );

        winnow.reset( state );
        expect( Number.isNaN( state.bufferedX ) ).to.equal( true );
        expect( Number.isNaN( state.bufferedT ) ).to.equal( true );
        expect( state.keptByGate ).to.equal( false );
        expect( Number.isNaN( state.xPrev ) ).to.equal( true );
        expect( Number.isNaN( state.tPrev ) ).to.equal( true );
    } );

    it( 'is idempotent (double reset)', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, makeMsg( 110, { gate: 50 } ) );

        winnow.reset( state );
        const afterFirst = {
            anchor: state.anchor,
            counter: state.counter,
            significant: state.significant,
            deviation: state.deviation,
            prevDirection: state.prevDirection,
            tunableErrorLogged: state.tunableErrorLogged
        };

        winnow.reset( state );
        expect( state.anchor ).to.equal( afterFirst.anchor );
        expect( state.counter ).to.equal( afterFirst.counter );
        expect( state.significant ).to.equal( afterFirst.significant );
        expect( state.deviation ).to.equal( afterFirst.deviation );
        expect( state.prevDirection ).to.equal( afterFirst.prevDirection );
        expect( state.tunableErrorLogged ).to.equal( afterFirst.tunableErrorLogged );
    } );

    it( 'cold-start to warm to reset to warm-again cycle', function () {
        const state = winnow.init( baseSpec( { K: 2, maxGap: 1000 } ) );

        // Cold start → warmup
        winnow.update( state, makeMsg( 100, { stdev: 1.0 } ) );
        expect( state.significant ).to.equal( true );
        expect( state.anchor ).to.equal( 100 );

        // Warm: process several messages, verify deviation tracking
        winnow.update( state, makeMsg( 101, { stdev: 1.0 } ) );
        expect( state.significant ).to.equal( false );
        expect( state.deviation ).to.equal( 1 );

        winnow.update( state, makeMsg( 105, { stdev: 1.0 } ) );
        expect( state.significant ).to.equal( true );
        expect( state.anchor ).to.equal( 105 );

        // Reset
        winnow.reset( state );
        expect( state.anchor ).to.equal( null );
        expect( state.counter ).to.equal( 0 );
        expect( state.deviation ).to.equal( 0 );

        // Warm again — fresh warmup, new anchor
        winnow.update( state, makeMsg( 50, { stdev: 1.0 } ) );
        expect( state.significant ).to.equal( true );
        expect( state.anchor ).to.equal( 50 );

        // Verify deviation computed from new anchor, not old
        winnow.update( state, makeMsg( 51, { stdev: 1.0 } ) );
        expect( state.significant ).to.equal( false );
        expect( state.deviation ).to.equal( 1 );
        expect( state.predicted ).to.equal( 50 );
    } );

} );

// ── recompute ──────────────────────────────────────────────────────────────

describe( 'winnow — recompute', function () {

    it( 'returns true (no-op)', function () {
        expect( winnow.recompute() ).to.equal( true );
    } );

} );

// ── control signals ────────────────────────────────────────────────────────

describe( 'winnow — control signals', function () {

    it( 'disable stops processing', function () {
        const state = winnow.init( baseSpec() );
        winnow.disable( state );
        expect( state.disable ).to.equal( true );
        winnow.enable( state );
        expect( state.disable ).to.equal( false );
    } );

    it( 'pause stops update but publishTo still runs', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100 ) );
        winnow.pause( state );
        expect( state.pause ).to.equal( true );
        winnow.update( state, makeMsg( 200 ) );
        expect( state.anchor ).to.equal( 100 );
        const msg = {};
        winnow.publishTo( state, msg );
        expect( msg.sig ).to.equal( true );
        winnow.unpause( state );
        expect( state.pause ).to.equal( false );
    } );

    it( 'publishTo on freshly initialised state does not crash', function () {
        const state = winnow.init( baseSpec() );
        const msg = {};
        winnow.publishTo( state, msg );
        // Should publish initial values: deviation=0, predicted=0, significant=false
        expect( msg.dev ).to.equal( 0 );
        expect( msg.pred ).to.equal( 0 );
        expect( msg.sig ).to.equal( false );
    } );

} );

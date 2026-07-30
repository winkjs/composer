import { describe, it } from 'mocha';
// @fileoverview
// Lifecycle tests — reset, recompute, disable/enable, pause/unpause.

import { expect } from 'chai';
import * as swingWatch from '../index.js';
import { makeSpec } from './test-helpers.js';

describe( 'swingWatch lifecycle', function () {
    // ── Disable / Enable ─────────────────────────────────────

    it( 'skips update when disabled', function () {
        const state = swingWatch.init( makeSpec() );
        swingWatch.disable( state );
        const msg = { v: 42 };
        swingWatch.update( state, msg );
        expect( state.received ).to.equal( 0 );
    } );

    it( 'resumes after enable', function () {
        const state = swingWatch.init( makeSpec() );
        swingWatch.disable( state );
        swingWatch.enable( state );
        swingWatch.update( state, { v: 42 } );
        expect( state.received ).to.equal( 1 );
    } );

    it( 'skips publishTo when disabled', function () {
        const state = swingWatch.init( makeSpec() );
        swingWatch.disable( state );
        const msg = { v: 42 };
        swingWatch.publishTo( state, msg );
        expect( msg.me ).to.equal( undefined );
    } );

    // ── Pause / Unpause ──────────────────────────────────────

    it( 'skips update when paused', function () {
        const state = swingWatch.init( makeSpec() );
        swingWatch.pause( state );
        const before = state.received;
        swingWatch.update( state, { v: 42 } );
        expect( state.received ).to.equal( before );
    } );

    it( 'still runs publishTo when paused', function () {
        const state = swingWatch.init( makeSpec() );
        // Fill the window first
        for ( const v of [ 5, 1, 3, 2, 4, 0, 2 ] ) {
            swingWatch.update( state, { v } );
        }
        swingWatch.pause( state );
        const msg = {};
        swingWatch.publishTo( state, msg );
        // publishTo runs — publishes whatever state holds
        expect( msg.me ).to.not.equal( undefined );
    } );

    it( 'resumes after unpause', function () {
        const state = swingWatch.init( makeSpec() );
        swingWatch.pause( state );
        swingWatch.unpause( state );
        swingWatch.update( state, { v: 42 } );
        expect( state.received ).to.equal( 1 );
    } );

    // ── Reset ────────────────────────────────────────────────

    it( 'clears all state on reset', function () {
        const state = swingWatch.init( makeSpec() );
        for ( const v of [ 5, 1, 3, 2, 4, 0, 2 ] ) {
            swingWatch.update( state, { v } );
        }
        expect( state.received ).to.equal( 7 );
        swingWatch.reset( state );
        expect( state.received ).to.equal( 0 );
        expect( state.emitted ).to.equal( 0 );
        expect( state.minPairCount ).to.equal( 0 );
        expect( state.maxPairCount ).to.equal( 0 );
        expect( state.prevMinPairCount ).to.equal( 0 );
        expect( state.dipCompleted ).to.equal( false );
    } );

    it( 'reset is idempotent', function () {
        const state = swingWatch.init( makeSpec() );
        for ( const v of [ 5, 1, 3, 2, 4, 0, 2 ] ) {
            swingWatch.update( state, { v } );
        }
        swingWatch.reset( state );
        swingWatch.reset( state );
        expect( state.received ).to.equal( 0 );
        expect( state.ring.used ).to.equal( 0 );
    } );

    it( 'restarts warmup after reset', function () {
        const state = swingWatch.init( makeSpec() );
        for ( const v of [ 5, 1, 3, 2, 4, 0, 2 ] ) {
            swingWatch.update( state, { v } );
        }
        swingWatch.reset( state );
        // Feed one sample — should be in warmup, no publish
        const msg = { v: 10 };
        swingWatch.update( state, msg );
        swingWatch.publishTo( state, msg );
        expect( msg.me ).to.equal( undefined );
    } );

    // ── Recompute ────────────────────────────────────────────

    it( 'returns true', function () {
        const state = swingWatch.init( makeSpec() );
        expect( swingWatch.recompute( state ) ).to.equal( true );
    } );

    it( 'clears prev pairs so next tick diffs fresh', function () {
        const state = swingWatch.init( makeSpec() );
        for ( const v of [ 5, 1, 3, 2, 4, 0, 2 ] ) {
            swingWatch.update( state, { v } );
        }
        expect( state.prevMinPairCount ).to.be.greaterThan( 0 );
        swingWatch.recompute( state );
        expect( state.prevMinPairCount ).to.equal( 0 );
    } );

    // ── Fault handling ───────────────────────────────────────

    it( 'sets inputValidationFailed on NaN input', function () {
        const state = swingWatch.init( makeSpec() );
        swingWatch.update( state, { v: NaN } );
        expect( state.inputValidationFailed ).to.equal( true );
    } );

    it( 'sets inputValidationFailed on Infinity', function () {
        const state = swingWatch.init( makeSpec() );
        swingWatch.update( state, { v: Infinity } );
        expect( state.inputValidationFailed ).to.equal( true );
    } );

    it( 'sets inputValidationFailed on undefined input', function () {
        const state = swingWatch.init( makeSpec() );
        swingWatch.update( state, { v: undefined } );
        expect( state.inputValidationFailed ).to.equal( true );
    } );

    it( 'recovers after a bad input', function () {
        const state = swingWatch.init( makeSpec() );
        swingWatch.update( state, { v: NaN } );
        expect( state.inputValidationFailed ).to.equal( true );
        swingWatch.update( state, { v: 42 } );
        expect( state.inputValidationFailed ).to.equal( false );
    } );
} );

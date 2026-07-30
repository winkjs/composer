// nodes/winnow/test/publish-to.specs.js

/**
 * @fileoverview Tests for winnow publishTo logic.
 *
 * Covers standard stat publishing, NaN propagation, disabled/paused
 * behaviour, partial stats, and buffer-backed xPrev/tPrev publishing.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';

import * as winnow from '../index.js';
import { baseSpec, bufferSpec, makeMsg } from './test-helpers.js';

describe( 'winnow — publishTo', function () {

    it( 'publishes deviation, predicted, and significant with correct values', function () {
        const state = winnow.init( baseSpec() );
        const msg = makeMsg( 100 );
        winnow.update( state, msg );
        winnow.publishTo( state, msg );
        // Warmup at value=100: anchor set to 100, deviation=0, predicted=100
        expect( msg.dev ).to.equal( 0 );
        expect( msg.pred ).to.equal( 100 );
        expect( msg.sig ).to.equal( true );
    } );

    it( 'publishes NaN on inputValidationFailed', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, { value: NaN } );
        const msg = { value: NaN };
        winnow.publishTo( state, msg );
        expect( Number.isNaN( msg.dev ) ).to.equal( true );
        expect( Number.isNaN( msg.pred ) ).to.equal( true );
        expect( Number.isNaN( msg.sig ) ).to.equal( true );
    } );

    it( 'skips when disabled', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100 ) );
        winnow.disable( state );
        const msg = {};
        winnow.publishTo( state, msg );
        expect( msg.dev ).to.equal( undefined );
    } );

    it( 'publishes when paused (last known values)', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100 ) );
        winnow.pause( state );
        const msg = {};
        winnow.publishTo( state, msg );
        expect( msg.sig ).to.equal( true );
    } );

    it( 'publishes only configured stats', function () {
        const state = winnow.init( baseSpec( {
            stats: { significant: { storeAs: 'keep' } }
        } ) );
        winnow.update( state, makeMsg( 100 ) );
        const msg = {};
        winnow.publishTo( state, msg );
        expect( msg.keep ).to.equal( true );
        expect( msg.dev ).to.equal( undefined );
        expect( msg.pred ).to.equal( undefined );
    } );

    // ── Buffer-backed stats (xPrev / tPrev) ────────────────────────────

    it( 'publishes xPrev/tPrev as NaN on non-gate keeps', function () {
        const state = winnow.init( bufferSpec() );
        winnow.update( state, makeMsg( 100, { ts: 1000 } ) );
        // Deadband fire (no gate) — significant but not gate-kept
        winnow.update( state, makeMsg( 110, { ts: 2000, stdev: 1.0 } ) );
        const msg = {};
        winnow.publishTo( state, msg );
        expect( Number.isNaN( msg.xp ) ).to.equal( true );
        expect( Number.isNaN( msg.tp ) ).to.equal( true );
    } );

    it( 'publishes xPrev/tPrev with buffered values on gate-fire keeps', function () {
        const state = winnow.init( bufferSpec() );
        winnow.update( state, makeMsg( 100, { ts: 1000 } ) );
        winnow.update( state, makeMsg( 100, { ts: 2000 } ) );
        // Gate fire — keptByGate = true
        winnow.update( state, makeMsg( 200, { ts: 3000, gate: 50 } ) );
        const msg = {};
        winnow.publishTo( state, msg );
        expect( msg.xp ).to.equal( 100 );
        expect( msg.tp ).to.equal( 2000 );
    } );

    it( 'publishes xPrev as NaN on first message (no buffered value)', function () {
        const state = winnow.init( bufferSpec() );
        // First message is warmup — Check 1 fires, not Check 2
        // keptByGate is false, so xPrev/tPrev publish NaN
        winnow.update( state, makeMsg( 100, { ts: 1000 } ) );
        const msg = {};
        winnow.publishTo( state, msg );
        expect( Number.isNaN( msg.xp ) ).to.equal( true );
        expect( Number.isNaN( msg.tp ) ).to.equal( true );
    } );

    it( 'publishes xPrev/tPrev as NaN when not significant', function () {
        const state = winnow.init( bufferSpec() );
        winnow.update( state, makeMsg( 100, { ts: 1000 } ) );
        // Non-significant message: deviation within threshold
        winnow.update( state, makeMsg( 101, { ts: 2000, stdev: 1.0 } ) );
        expect( state.significant ).to.equal( false );
        const msg = {};
        winnow.publishTo( state, msg );
        expect( Number.isNaN( msg.xp ) ).to.equal( true );
        expect( Number.isNaN( msg.tp ) ).to.equal( true );
    } );

    it( 'publishes NaN for xPrev/tPrev on inputValidationFailed', function () {
        const state = winnow.init( bufferSpec() );
        winnow.update( state, { value: NaN } );
        const msg = {};
        winnow.publishTo( state, msg );
        // publishNaN covers all stats including xPrev/tPrev
        expect( Number.isNaN( msg.xp ) ).to.equal( true );
        expect( Number.isNaN( msg.tp ) ).to.equal( true );
    } );

} );

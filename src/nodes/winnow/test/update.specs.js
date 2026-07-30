// nodes/winnow/test/update.specs.js

/**
 * @fileoverview Tests for winnow update logic.
 *
 * Covers all five detection checks (warmup, step, trend reversal,
 * deadband, gap prevention), input guards, edge cases, and the
 * bufferPrev buffering behaviour in update().
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';

import * as winnow from '../index.js';
import { baseSpec, bufferSpec, makeMsg } from './test-helpers.js';

// ── Check 1: warmup ───────────────────────────────────────────────────────

describe( 'winnow — update — warmup', function () {

    it( 'marks first message as significant', function () {
        const state = winnow.init( baseSpec() );
        const msg = makeMsg( 100 );
        winnow.update( state, msg );
        expect( state.significant ).to.equal( true );
        expect( state.anchor ).to.equal( 100 );
    } );

    it( 'marks significant when noise field is undefined', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, { value: 101, roc: 0, trendDir: 'stable', gate: 0 } );
        expect( state.significant ).to.equal( true );
    } );

    it( 'marks significant when noise is NaN', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, makeMsg( 101, { stdev: NaN } ) );
        expect( state.significant ).to.equal( true );
    } );

} );

// ── Check 2: step detection ───────────────────────────────────────────────

describe( 'winnow — update — step detection', function () {

    it( 'fires when gate exceeds chi2Threshold', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, makeMsg( 110, { gate: 50.0 } ) );
        expect( state.significant ).to.equal( true );
        expect( state.anchor ).to.equal( 110 );
    } );

    it( 'does not fire when gate is below threshold', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, makeMsg( 100, { gate: 2.0 } ) );
        expect( state.significant ).to.equal( false );
    } );

    it( 'does not fire when gate is undefined', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, makeMsg( 100, { gate: undefined } ) );
        expect( state.significant ).to.equal( false );
    } );

} );

// ── Check 3: trend reversal ──────────────────────────────────────────────

describe( 'winnow — update — trend reversal', function () {

    it( 'fires on direction change', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100, { trendDir: 'rising' } ) );
        winnow.update( state, makeMsg( 100, { trendDir: 'rising' } ) );
        winnow.update( state, makeMsg( 100, { trendDir: 'falling' } ) );
        expect( state.significant ).to.equal( true );
    } );

    it( 'does not fire on same direction', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100, { trendDir: 'rising' } ) );
        winnow.update( state, makeMsg( 100, { trendDir: 'rising' } ) );
        winnow.update( state, makeMsg( 100, { trendDir: 'rising' } ) );
        expect( state.significant ).to.equal( false );
    } );

    it( 'ignores learning transitions', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100, { trendDir: 'learning' } ) );
        winnow.update( state, makeMsg( 100, { trendDir: 'rising' } ) );
        expect( state.significant ).to.equal( false );
    } );

    it( 'updates prevDirection on every message (audit finding)', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100, { trendDir: 'rising' } ) );
        winnow.update( state, makeMsg( 100, { trendDir: 'rising' } ) );
        winnow.update( state, makeMsg( 100, { trendDir: 'stable' } ) );
        expect( state.prevDirection ).to.equal( 'stable' );
        winnow.update( state, makeMsg( 100, { trendDir: 'falling' } ) );
        expect( state.significant ).to.equal( true );
    } );

} );

// ── Check 4: slope-aware deadband ────────────────────────────────────────

describe( 'winnow — update — deadband', function () {

    it( 'fires when deviation exceeds K * noise', function () {
        const state = winnow.init( baseSpec( { K: 2 } ) );
        winnow.update( state, makeMsg( 100, { stdev: 1.0 } ) );
        winnow.update( state, makeMsg( 110, { stdev: 1.0 } ) );
        expect( state.significant ).to.equal( true );
    } );

    it( 'does not fire when deviation is within threshold', function () {
        const state = winnow.init( baseSpec( { K: 2 } ) );
        winnow.update( state, makeMsg( 100, { stdev: 1.0 } ) );
        winnow.update( state, makeMsg( 101, { stdev: 1.0 } ) );
        expect( state.significant ).to.equal( false );
    } );

    it( 'uses slope projection for predicted value', function () {
        const state = winnow.init( baseSpec( { K: 2 } ) );
        winnow.update( state, makeMsg( 100, { roc: 0.5 } ) );
        winnow.update( state, makeMsg( 100.5, { stdev: 1.0, roc: 0.5 } ) );
        expect( state.significant ).to.equal( false );
        expect( state.predicted ).to.equal( 100.5 );
    } );

    it( 'tightens threshold as elapsed grows', function () {
        const state = winnow.init( baseSpec( { K: 2, tightenBase: 2 } ) );
        winnow.update( state, makeMsg( 100, { stdev: 1.0 } ) );

        winnow.update( state, makeMsg( 101 ) );
        expect( state.significant ).to.equal( false );

        winnow.update( state, makeMsg( 100.5 ) );
        winnow.update( state, makeMsg( 100.8 ) );

        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, makeMsg( 100.4 ) );
        expect( state.significant ).to.equal( false );
    } );

} );

// ── Check 5: gap prevention ─────────────────────────────────────────────

describe( 'winnow — update — gap prevention', function () {

    it( 'forces significant after maxGap', function () {
        const state = winnow.init( baseSpec( { maxGap: 5 } ) );
        winnow.update( state, makeMsg( 100 ) );
        for ( let i = 0; i < 4; i += 1 ) {
            winnow.update( state, makeMsg( 100 ) );
        }
        expect( state.significant ).to.equal( false );
        winnow.update( state, makeMsg( 100 ) );
        expect( state.significant ).to.equal( true );
    } );

} );

// ── Guards ───────────────────────────────────────────────────────────────

describe( 'winnow — update — guards', function () {

    it( 'skips when disabled', function () {
        const state = winnow.init( baseSpec() );
        winnow.disable( state );
        winnow.update( state, makeMsg( 100 ) );
        expect( state.counter ).to.equal( 0 );
        expect( state.anchor ).to.equal( null );
    } );

    it( 'skips when paused', function () {
        const state = winnow.init( baseSpec() );
        winnow.pause( state );
        winnow.update( state, makeMsg( 100 ) );
        expect( state.counter ).to.equal( 0 );
        expect( state.anchor ).to.equal( null );
    } );

    it( 'sets inputValidationFailed on NaN input', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, { value: NaN, stdev: 1, roc: 0, trendDir: 'stable', gate: 0 } );
        expect( state.inputValidationFailed ).to.equal( true );
    } );

    it( 'sets inputValidationFailed on undefined input', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, { stdev: 1, roc: 0, trendDir: 'stable', gate: 0 } );
        expect( state.inputValidationFailed ).to.equal( true );
    } );

    it( 'clears inputValidationFailed on valid input after failure', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, { value: NaN } );
        expect( state.inputValidationFailed ).to.equal( true );
        winnow.update( state, makeMsg( 100 ) );
        expect( state.inputValidationFailed ).to.equal( false );
    } );

} );

// ── Edge cases ───────────────────────────────────────────────────────────

describe( 'winnow — update — edge cases', function () {

    it( 'handles non-finite slope gracefully (defaults to 0)', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100, { roc: undefined } ) );
        expect( state.anchorSlope ).to.equal( 0 );
    } );

    it( 'handles NaN slope gracefully', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100, { roc: NaN } ) );
        expect( state.anchorSlope ).to.equal( 0 );
    } );

    it( 'handles tunable K that throws', function () {
        const state = winnow.init( baseSpec( {
            K: function () {
                throw new Error( 'broken' );
            }
        } ) );
        winnow.update( state, makeMsg( 100 ) );
        expect( state.significant ).to.equal( true );
        expect( state.tunableErrorLogged ).to.equal( true );
    } );

    it( 'recovers from tunable error', function () {
        let shouldThrow = true;
        const state = winnow.init( baseSpec( {
            K: function () {
                if ( shouldThrow ) throw new Error( 'broken' );
                return 2;
            }
        } ) );
        winnow.update( state, makeMsg( 100 ) );
        expect( state.tunableErrorLogged ).to.equal( true );
        shouldThrow = false;
        winnow.update( state, makeMsg( 100 ) );
        expect( state.tunableErrorLogged ).to.equal( false );
    } );

} );

// ── bufferPrev behaviour ─────────────────────────────────────────────────

describe( 'winnow — update — bufferPrev', function () {

    it( 'buffers previous tick values', function () {
        const state = winnow.init( bufferSpec() );
        // First message: bufferedX was NaN → xPrev gets NaN; bufferedX set to 100
        winnow.update( state, makeMsg( 100, { ts: 1000 } ) );
        expect( Number.isNaN( state.xPrev ) ).to.equal( true );
        expect( state.bufferedX ).to.equal( 100 );
        expect( state.bufferedT ).to.equal( 1000 );

        // Second message: xPrev gets 100 (previous bufferedX); bufferedX set to 200
        winnow.update( state, makeMsg( 200, { ts: 2000 } ) );
        expect( state.xPrev ).to.equal( 100 );
        expect( state.tPrev ).to.equal( 1000 );
        expect( state.bufferedX ).to.equal( 200 );
        expect( state.bufferedT ).to.equal( 2000 );
    } );

    it( 'resets keptByGate on each update', function () {
        const state = winnow.init( bufferSpec() );
        winnow.update( state, makeMsg( 100, { ts: 1000 } ) );
        // Gate fire on second message
        winnow.update( state, makeMsg( 200, { ts: 2000, gate: 50 } ) );
        expect( state.keptByGate ).to.equal( true );

        // Third message: keptByGate should be reset to false before checks
        winnow.update( state, makeMsg( 200, { ts: 3000 } ) );
        expect( state.keptByGate ).to.equal( false );
    } );

    it( 'sets keptByGate on step detection (Check 2)', function () {
        const state = winnow.init( bufferSpec() );
        winnow.update( state, makeMsg( 100, { ts: 1000 } ) );
        winnow.update( state, makeMsg( 100, { ts: 2000 } ) );
        // Gate fire
        winnow.update( state, makeMsg( 200, { ts: 3000, gate: 50 } ) );
        expect( state.keptByGate ).to.equal( true );
        expect( state.xPrev ).to.equal( 100 );
        expect( state.tPrev ).to.equal( 2000 );
    } );

    it( 'does not set keptByGate on non-gate significant events', function () {
        const state = winnow.init( bufferSpec() );
        winnow.update( state, makeMsg( 100, { ts: 1000 } ) );
        // Deadband fire (no gate) — deviation = |110-100| = 10 > K*noise = 2
        winnow.update( state, makeMsg( 110, { ts: 2000, stdev: 1.0 } ) );
        expect( state.significant ).to.equal( true );
        expect( state.keptByGate ).to.equal( false );
    } );

    it( 'does not buffer when bufferPrev is false', function () {
        const state = winnow.init( baseSpec() );
        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, makeMsg( 200 ) );
        // bufferedX should still be NaN (init default, never written)
        expect( Number.isNaN( state.bufferedX ) ).to.equal( true );
    } );

    it( 'buffers X without timestampField', function () {
        const state = winnow.init( baseSpec( {
            bufferPrev: true,
            stats: {
                significant: { storeAs: 'sig' },
                xPrev: { storeAs: 'xp' }
            }
        } ) );
        winnow.update( state, makeMsg( 100 ) );
        winnow.update( state, makeMsg( 200 ) );
        expect( state.xPrev ).to.equal( 100 );
        // tPrev remains NaN since no timestampField
        expect( Number.isNaN( state.bufferedT ) ).to.equal( true );
    } );

} );

// Lifecycle tests for kalman1d node.
// Covers disable/enable, pause/unpause, reset, recompute, and
// full init-warm-reset-warm-again cycle.

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as kalman1d from '../index.js';
import { goldenTruth, TOL_STATE, makeSpec, makeMsg, feedSequence } from './test-helpers.js';

const gt7 = goldenTruth[ 'S7-basic-innovation' ];
const gt4 = goldenTruth[ 'S4-dare-steady-state' ];

describe( 'Kalman 1d — lifecycle', function () {

    // ── disable / pause ────────────────────────────────────────────

    describe( 'disable and pause', function () {

        it( 'skips update when disabled', function () {
            const state = kalman1d.init( makeSpec() );
            kalman1d.update( state, makeMsg( 100 ) );
            kalman1d.disable( state );

            kalman1d.update( state, makeMsg( 200 ) );
            expect( state.xHat ).to.equal( 100 );
        } );

        it( 'resumes after enable', function () {
            const state = kalman1d.init( makeSpec() );
            kalman1d.update( state, makeMsg( 100 ) );
            kalman1d.disable( state );
            kalman1d.update( state, makeMsg( 200 ) );
            kalman1d.enable( state );

            kalman1d.update( state, makeMsg( 100 ) );
            expect( state.updateCount ).to.equal( 2 );
        } );

        it( 'skips update when paused', function () {
            const state = kalman1d.init( makeSpec() );
            kalman1d.update( state, makeMsg( 100 ) );
            const xBefore = state.xHat;
            kalman1d.pause( state );

            kalman1d.update( state, makeMsg( 200 ) );
            expect( state.xHat ).to.equal( xBefore );
        } );

        it( 'resumes after unpause', function () {
            // see golden-truth-kalman1d.py §7: same filter state as init(100)+update(102)
            const state = kalman1d.init( makeSpec() );
            kalman1d.update( state, makeMsg( 100 ) );
            kalman1d.pause( state );
            kalman1d.update( state, makeMsg( 200 ) ); // skipped by pause
            kalman1d.unpause( state );

            kalman1d.update( state, makeMsg( 102 ) );
            // Same as golden-truth §7: init(100) then update(102)
            expect( state.xHat ).to.be.closeTo( gt7.xHat, TOL_STATE );
        } );
    } );

    // ── reset ──────────────────────────────────────────────────────

    describe( 'reset', function () {

        it( 'clears all accumulated state', function () {
            const state = kalman1d.init( makeSpec() );
            feedSequence( state, [ 100, 102, 104, 106 ], null, null );

            const result = kalman1d.reset( state );

            expect( result ).to.equal( true );
            expect( state.xHat ).to.equal( 0 );
            expect( state.P ).to.equal( 0 );
            expect( state.isInitialized ).to.equal( false );
            expect( state.innovation ).to.equal( 0 );
            expect( state.innovationGate ).to.equal( 0 );
            expect( state.updateCount ).to.equal( 0 );
            expect( state.outlierCount ).to.equal( 0 );
        } );

        it( 'is idempotent', function () {
            const state = kalman1d.init( makeSpec() );
            feedSequence( state, [ 100, 102 ], null, null );

            kalman1d.reset( state );
            kalman1d.reset( state );

            expect( state.xHat ).to.equal( 0 );
            expect( state.isInitialized ).to.equal( false );
        } );

        it( 'preserves model parameters', function () {
            const state = kalman1d.init( makeSpec( {
                sensorVariance: 4,
                controlModel: 0.5
            } ) );
            feedSequence( state, [ 100, 102 ], null, null );

            kalman1d.reset( state );

            expect( state.R ).to.equal( 4 );
            expect( state.G ).to.equal( 0.5 );
        } );

        it( 'allows re-initialization after reset', function () {
            const state = kalman1d.init( makeSpec() );
            feedSequence( state, [ 100, 102, 104 ], null, null );
            kalman1d.reset( state );

            kalman1d.update( state, makeMsg( 200 ) );
            expect( state.xHat ).to.equal( 200 );
            expect( state.isInitialized ).to.equal( true );
        } );
    } );

    // ── recompute ──────────────────────────────────────────────────

    describe( 'recompute', function () {

        it( 'clamps P within bounds', function () {
            const state = kalman1d.init( makeSpec( {
                sensorVariance: 1,
                varianceLimit: 10
            } ) );
            kalman1d.update( state, makeMsg( 100 ) );

            // Force P above Pmax
            state.P = 20;
            kalman1d.recompute( state );
            expect( state.P ).to.equal( 10 );

            // Force P below Pmin
            state.P = 1e-15;
            kalman1d.recompute( state );
            expect( state.P ).to.equal( 1e-10 );
        } );

        it( 'preserves valid P', function () {
            const state = kalman1d.init( makeSpec() );
            kalman1d.update( state, makeMsg( 100 ) );
            const P = state.P;

            const result = kalman1d.recompute( state );
            expect( result ).to.equal( true );
            expect( state.P ).to.equal( P );
        } );
    } );

    // ── full lifecycle ─────────────────────────────────────────────

    describe( 'full lifecycle', function () {

        it( 'init → warm → reset → warm-again cycle', function () {
            const state = kalman1d.init( makeSpec() );

            // Warm
            feedSequence( state, [ 100, 102, 104, 106, 108 ], null, null );
            expect( state.updateCount ).to.equal( 5 );

            // Reset
            kalman1d.reset( state );
            expect( state.isInitialized ).to.equal( false );

            // Warm again at different level
            feedSequence( state, [ 200, 202, 204 ], null, null );
            expect( state.xHat ).to.be.closeTo( 202, 2 );
            expect( state.updateCount ).to.equal( 3 );
        } );

        it( 'long-running stability (500 updates)', function () {
            // see golden-truth-kalman1d.py §4: P converges to steady-state
            const gt = gt4.cases[ 1 ]; // Q/R = 0.01
            const state = kalman1d.init( makeSpec() );
            feedSequence( state, new Array( 500 ).fill( 100 ), null, null );

            expect( state.xHat ).to.equal( 100 );
            expect( state.P ).to.be.closeTo( gt.Pss, 1e-3 );
            expect( state.updateCount ).to.equal( 500 );
        } );
    } );
} );

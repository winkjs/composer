// Core update tests for kalman1d node.
// Covers auto-initialization, basic filtering, control input, outlier
// exclusion (exclude and follow modes), invalid input, P bounds,
// non-unity model coefficients, and edge cases.
//
// Reference values from golden-truth-kalman1d.py (filterpy + scipy).

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as kalman1d from '../index.js';
import { goldenTruth, TOL_STATE, TOL_DERIVED, makeSpec, makeMsg, feedSequence } from './test-helpers.js';

const gt1 = goldenTruth[ 'S1-constant-input' ];
const gt2 = goldenTruth[ 'S2-step-change-exclude' ];
const gt3 = goldenTruth[ 'S3-ramp-with-control' ];
const gt4 = goldenTruth[ 'S4-dare-steady-state' ];
const gt5 = goldenTruth[ 'S5-non-unity-HF' ];
const gt6 = goldenTruth[ 'S6-follow-mode' ];
const gt7 = goldenTruth[ 'S7-basic-innovation' ];
const gt8 = goldenTruth[ 'S8-missing-control' ];
const gt9 = goldenTruth[ 'S9-decaying-state' ];
const gt10 = goldenTruth[ 'S10-negative-control' ];

describe( 'Kalman 1d — update', function () {

    // ── auto initialization ────────────────────────────────────────

    describe( 'auto initialization', function () {

        it( 'initializes from first measurement (H=1)', function () {
            // see golden-truth-kalman1d.py §1
            const state = kalman1d.init( makeSpec() );
            kalman1d.update( state, makeMsg( 100 ) );

            expect( state.isInitialized ).to.equal( true );
            expect( state.xHat ).to.equal( gt1.initXHat );
            expect( state.P ).to.equal( gt1.initP );
            expect( state.innovation ).to.equal( 0 );
            expect( state.innovationGate ).to.equal( 0 );
            expect( state.updateCount ).to.equal( 1 );
        } );

        it( 'initializes from first measurement (H=2)', function () {
            // see golden-truth-kalman1d.py §5
            const state = kalman1d.init( makeSpec( { measurement: 2 } ) );
            kalman1d.update( state, makeMsg( 200 ) );

            expect( state.xHat ).to.equal( gt5.initXHat );
            expect( state.P ).to.equal( gt5.initP );
        } );
    } );

    // ── basic filtering ────────────────────────────────────────────

    describe( 'basic filtering', function () {

        it( 'converges on constant input', function () {
            // see golden-truth-kalman1d.py §1
            const state = kalman1d.init( makeSpec() );

            // Init tick
            kalman1d.update( state, makeMsg( 100 ) );

            // Step 2: P should drop from 1.0
            kalman1d.update( state, makeMsg( 100 ) );
            expect( state.xHat ).to.equal( 100 );
            expect( state.P ).to.be.closeTo( gt1.trace[ 0 ].P, TOL_STATE );
            expect( state.innovation ).to.equal( 0 );
            expect( state.innovationGate ).to.equal( 0 );

            // Feed 19 more constant values (total 21 update calls = init + 20 predict-update)
            for ( let i = 0; i < 19; i += 1 ) {
                kalman1d.update( state, makeMsg( 100 ) );
            }

            // see golden-truth-kalman1d.py §1, step 21
            expect( state.xHat ).to.equal( 100 );
            expect( state.P ).to.be.closeTo( gt1.finalP, TOL_STATE );
        } );

        it( 'P converges toward steady-state value', function () {
            // see golden-truth-kalman1d.py §4 (DARE + filterpy cross-check)
            const gt = gt4.cases[ 1 ]; // Q/R = 0.01
            const state = kalman1d.init( makeSpec() );
            feedSequence( state, new Array( 501 ).fill( 100 ), null, null );

            expect( state.P ).to.be.closeTo( gt.Pss, 1e-3 );
        } );

        it( 'produces correct innovation for noisy input', function () {
            // see golden-truth-kalman1d.py §7
            const state = kalman1d.init( makeSpec() );
            kalman1d.update( state, makeMsg( 100 ) );
            kalman1d.update( state, makeMsg( 102 ) );

            expect( state.xHat ).to.be.closeTo( gt7.xHat, TOL_STATE );
            expect( state.P ).to.be.closeTo( gt7.P, TOL_STATE );
            expect( state.innovation ).to.be.closeTo( gt7.innovation, TOL_STATE );
            expect( state.innovationGate ).to.be.closeTo( gt7.innovationGate, TOL_DERIVED );
        } );
    } );

    // ── control input ──────────────────────────────────────────────

    describe( 'control input', function () {

        it( 'tracks ramp perfectly with correct control model', function () {
            // see golden-truth-kalman1d.py §3
            const state = kalman1d.init( makeSpec( {
                control: 'power',
                controlModel: 1.0
            } ) );

            kalman1d.update( state, makeMsg( 100, { power: 5 } ) );

            for ( let i = 1; i <= 10; i += 1 ) {
                const z = 100 + ( 5 * i );
                kalman1d.update( state, makeMsg( z, { power: 5 } ) );
                expect( state.xHat ).to.be.closeTo( gt3.trace[ i - 1 ].xHat, TOL_STATE );
                expect( state.innovation ).to.be.closeTo( gt3.trace[ i - 1 ].innovation, TOL_STATE );
            }
        } );

        it( 'defaults to 0 when control field is missing from message', function () {
            // see golden-truth-kalman1d.py §8
            const state = kalman1d.init( makeSpec( {
                control: 'power',
                controlModel: 1.0
            } ) );

            kalman1d.update( state, makeMsg( 100, { power: 5 } ) );
            kalman1d.update( state, makeMsg( 105 ) );

            expect( state.innovation ).to.be.closeTo( gt8.innovation, TOL_STATE );
            expect( state.innovationGate ).to.be.closeTo( gt8.innovationGate, TOL_DERIVED );
            // gate > chi2Threshold (6.63) → excluded, xHat stays at prediction
            expect( state.xHat ).to.be.closeTo( gt8.xHat, TOL_STATE );
            expect( state.P ).to.be.closeTo( gt8.P, TOL_STATE );
        } );

        it( 'treats NaN control as 0', function () {
            // Same scenario as missing control — NaN treated as 0
            // see golden-truth-kalman1d.py §8: same values expected
            const state = kalman1d.init( makeSpec( {
                control: 'power',
                controlModel: 1.0
            } ) );

            kalman1d.update( state, makeMsg( 100, { power: 5 } ) );
            kalman1d.update( state, makeMsg( 105, { power: NaN } ) );

            expect( state.innovation ).to.be.closeTo( gt8.innovation, TOL_STATE );
            expect( state.xHat ).to.be.closeTo( gt8.xHat, TOL_STATE );
            expect( state.P ).to.be.closeTo( gt8.P, TOL_STATE );
        } );

        it( 'works without control field specified', function () {
            // see golden-truth-kalman1d.py §7: init(100), update(102)
            const state = kalman1d.init( makeSpec() );
            kalman1d.update( state, makeMsg( 100 ) );
            kalman1d.update( state, makeMsg( 102 ) );

            expect( state.xHat ).to.be.closeTo( gt7.xHat, TOL_STATE );
            expect( state.P ).to.be.closeTo( gt7.P, TOL_STATE );
        } );
    } );

    // ── outlier exclusion ──────────────────────────────────────────

    describe( 'outlier exclusion', function () {

        it( 'excludes outlier and preserves estimate with exact P', function () {
            // see golden-truth-kalman1d.py §2
            const state = kalman1d.init( makeSpec() );

            // Warm up with 12 constant values (init + 11 updates)
            feedSequence( state, new Array( 12 ).fill( 100 ), null, null );
            expect( state.P ).to.be.closeTo( gt2.warmUpP, TOL_STATE );

            // Inject step: z=200, should be excluded
            kalman1d.update( state, makeMsg( 200 ) );

            // Excluded: xHat = xPred = 100, P = PPred = P_before + Q
            expect( state.xHat ).to.be.closeTo( gt2.firstExcluded.xHat, TOL_STATE );
            expect( state.P ).to.be.closeTo( gt2.firstExcluded.P, TOL_STATE );
        } );

        it( 'publishes innovation even on excluded measurement', function () {
            // CRITICAL: innovation is a measurement-space signal about reality
            const state = kalman1d.init( makeSpec() );
            feedSequence( state, new Array( 12 ).fill( 100 ), null, null );

            kalman1d.update( state, makeMsg( 200 ) );

            // Innovation = 200 - H*xPred = 200 - 100 = 100
            expect( state.innovation ).to.be.closeTo( gt2.firstExcluded.innovation, TOL_DERIVED );
            // Gate should be very high (>>6.63)
            expect( state.innovationGate ).to.be.greaterThan( 6.63 );
            expect( state.innovationGate ).to.be.closeTo( gt2.firstExcluded.innovationGate, 1 );
            expect( state.outlierCount ).to.equal( 1 );
        } );

        it( 'continues excluding with exact P growth per step', function () {
            // see golden-truth-kalman1d.py §2: P grows by Q each excluded step
            const state = kalman1d.init( makeSpec() );
            feedSequence( state, new Array( 12 ).fill( 100 ), null, null );

            // Inject 5 outliers — verify P after each exclusion
            for ( let i = 0; i < 5; i += 1 ) {
                kalman1d.update( state, makeMsg( 200 ) );
                expect( state.P ).to.be.closeTo( gt2.excludedPSequence[ i ], TOL_STATE );
                expect( state.innovation ).to.be.closeTo( gt2.firstExcluded.innovation, TOL_DERIVED );
            }

            expect( state.outlierCount ).to.equal( 5 );
            expect( state.xHat ).to.be.closeTo( gt2.firstExcluded.xHat, TOL_DERIVED );
        } );
    } );

    // ── follow mode ────────────────────────────────────────────────

    describe( 'follow mode', function () {

        it( 'resets to measurement on outlier', function () {
            // see golden-truth-kalman1d.py §6
            const state = kalman1d.init( makeSpec( { followMode: true } ) );
            feedSequence( state, new Array( 12 ).fill( 100 ), null, null );

            kalman1d.update( state, makeMsg( 200 ) );

            // Follow: xHat resets to z/H = 200
            expect( state.xHat ).to.equal( gt6.followReset.xHat );
            // P resets to R/H² = 1
            expect( state.P ).to.equal( gt6.followReset.P );
            expect( state.outlierCount ).to.equal( 1 );
            // Innovation still reflects the jump magnitude
            expect( state.innovation ).to.be.closeTo( gt6.followReset.innovation, TOL_DERIVED );
        } );

        it( 'converges after follow reset', function () {
            // see golden-truth-kalman1d.py §6
            const state = kalman1d.init( makeSpec( { followMode: true } ) );
            feedSequence( state, new Array( 12 ).fill( 100 ), null, null );

            // Step to 200 (follow-reset), then continue at 200
            kalman1d.update( state, makeMsg( 200 ) );
            kalman1d.update( state, makeMsg( 200 ) );

            // After follow-reset, next normal step with z=200 converges
            // P matches S1 step 2 (same P=1 starting point)
            expect( state.xHat ).to.equal( 200 );
            expect( state.P ).to.be.closeTo( gt1.trace[ 0 ].P, TOL_STATE );
            expect( state.innovation ).to.equal( 0 );
        } );
    } );

    // ── invalid input ──────────────────────────────────────────────

    describe( 'invalid input', function () {

        it( 'handles NaN gracefully', function () {
            const state = kalman1d.init( makeSpec() );
            kalman1d.update( state, makeMsg( 100 ) );
            const xBefore = state.xHat;

            kalman1d.update( state, makeMsg( NaN ) );

            expect( state.inputValidationFailed ).to.equal( true );
            expect( state.xHat ).to.equal( xBefore );
        } );

        it( 'handles Infinity gracefully', function () {
            const state = kalman1d.init( makeSpec() );
            kalman1d.update( state, makeMsg( 100 ) );

            kalman1d.update( state, makeMsg( Infinity ) );
            expect( state.inputValidationFailed ).to.equal( true );

            kalman1d.update( state, makeMsg( -Infinity ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'handles undefined gracefully', function () {
            const state = kalman1d.init( makeSpec() );
            kalman1d.update( state, makeMsg( 100 ) );

            kalman1d.update( state, { } ); // no temperature field
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'clears flag on next valid input', function () {
            const state = kalman1d.init( makeSpec() );
            kalman1d.update( state, makeMsg( 100 ) );
            kalman1d.update( state, makeMsg( NaN ) );
            expect( state.inputValidationFailed ).to.equal( true );

            kalman1d.update( state, makeMsg( 100 ) );
            expect( state.inputValidationFailed ).to.equal( false );
        } );
    } );

    // ── P bounds ───────────────────────────────────────────────────

    describe( 'P bounds', function () {

        it( 'clamps P to Pmax', function () {
            const state = kalman1d.init( makeSpec( {
                varianceLimit: 10,
                sensorVariance: 1
            } ) );
            // Pmax = 10 * 1 = 10

            kalman1d.update( state, makeMsg( 100 ) );
            // Force P above Pmax
            state.P = 20;

            kalman1d.update( state, makeMsg( 100 ) );
            // PPred = min(20.01, 10) = 10, S = 10+1 = 11, K = 10/11
            // innovation = 0 (z=100, xPred=100), so xHat = 100
            // P = (1 - 10/11) * 10 = 10/11
            expect( state.P ).to.be.closeTo( 10 / 11, TOL_STATE );
        } );

        it( 'clamps P to Pmin (prevents filter lock)', function () {
            // Force PPred below Pmin by setting P=0 and Q very small
            const state = kalman1d.init( makeSpec( {
                processVariance: 1e-15,  // Q = 1e-15 (absolute)
                sensorVariance: 1        // Pmin = 1e-10
            } ) );
            kalman1d.update( state, makeMsg( 100 ) );
            // Force P to 0
            state.P = 0;

            kalman1d.update( state, makeMsg( 102 ) );
            // PPred = F*0*F + Q = 1e-15 < Pmin = 1e-10 → clamped
            // After Kalman update, P derives from clamped PPred
            expect( state.P ).to.be.greaterThan( 0 );
        } );
    } );

    // ── non-unity coefficients ─────────────────────────────────────

    describe( 'non-unity coefficients', function () {

        it( 'handles H=2 correctly', function () {
            // see golden-truth-kalman1d.py §5
            const state = kalman1d.init( makeSpec( {
                measurement: 2,
                stateTransition: 0.99
            } ) );

            kalman1d.update( state, makeMsg( 200 ) );
            // xHat = z/H = 100
            expect( state.xHat ).to.equal( gt5.initXHat );
            // P = R/(H*H) = 1/4 = 0.25
            expect( state.P ).to.equal( gt5.initP );

            kalman1d.update( state, makeMsg( 200 ) );
            // xPred = F*xHat = 0.99*100 = 99, zPred = H*xPred = 198
            // innovation = 200 - 198 = 2
            expect( state.innovation ).to.be.closeTo( gt5.trace[ 0 ].innovation, TOL_STATE );
            expect( state.xHat ).to.be.closeTo( gt5.trace[ 0 ].xHat, TOL_DERIVED );
            expect( state.P ).to.be.closeTo( gt5.trace[ 0 ].P, TOL_DERIVED );
        } );

        it( 'handles F<1 (decaying state)', function () {
            // see golden-truth-kalman1d.py §9: F=0.95, init(100), update(100)
            // Use high chi2Threshold to prevent gate from excluding the update
            const state = kalman1d.init( makeSpec( {
                stateTransition: 0.95,
                chi2Threshold: 1000
            } ) );

            kalman1d.update( state, makeMsg( 100 ) );
            kalman1d.update( state, makeMsg( 100 ) );

            // xPred = 0.95*100 = 95, innovation = 100-95 = 5
            expect( state.innovation ).to.be.closeTo( gt9.innovation, TOL_STATE );
            expect( state.xHat ).to.be.closeTo( gt9.xHat, TOL_DERIVED );
            expect( state.P ).to.be.closeTo( gt9.P, TOL_DERIVED );
        } );
    } );

    // ── edge cases ─────────────────────────────────────────────────

    describe( 'edge cases', function () {

        it( 'handles very small Q (near-zero process noise)', function () {
            // Q = 0.0001, default R = 1, so Q/R = 0.0001.
            // Steady-state P is small but convergence is slow.
            const state = kalman1d.init( makeSpec( {
                processVariance: 0.0001
            } ) );

            feedSequence( state, new Array( 500 ).fill( 100 ), null, null );

            expect( state.P ).to.be.greaterThan( 0 );
            expect( state.P ).to.be.lessThan( 0.1 );
        } );

        it( 'flushes denormals in P to zero', function () {
            // When K ≈ 1, P_new = (1 - K·H)·PPred ≈ 0, may hit denormal range.
            const state = kalman1d.init( makeSpec( {
                sensorVariance: 1e-35, // R = 1e-35 → Pmin = 1e-45
                processVariance: 1e-35 // Q = 1e-35 (absolute, not a ratio)
            } ) );
            kalman1d.update( state, makeMsg( 100 ) );
            kalman1d.update( state, makeMsg( 100 ) );

            // P should be flushed to 0 (or remain very small)
            expect( state.P ).to.be.lessThan( 1e-30 );
        } );

        it( 'handles negative controlModel (fuel consumption)', function () {
            // see golden-truth-kalman1d.py §10: G=-1, init(100), z=98, u=2
            // xPred = 100 + (-1)*2 = 98, innovation = 98-98 = 0
            const state = kalman1d.init( makeSpec( {
                control: 'fuelRate',
                controlModel: -1
            } ) );

            kalman1d.update( state, makeMsg( 100, { fuelRate: 2 } ) );
            kalman1d.update( state, makeMsg( 98, { fuelRate: 2 } ) );

            expect( state.innovation ).to.be.closeTo( gt10.innovation, TOL_STATE );
            expect( state.innovationGate ).to.be.closeTo( gt10.innovationGate, TOL_STATE );
            expect( state.xHat ).to.be.closeTo( gt10.xHat, TOL_STATE );
            expect( state.P ).to.be.closeTo( gt10.P, TOL_STATE );
        } );

        it( 'does not initialize on NaN first measurement', function () {
            const state = kalman1d.init( makeSpec() );
            kalman1d.update( state, makeMsg( NaN ) );

            expect( state.isInitialized ).to.equal( false );
            expect( state.xHat ).to.equal( 0 );
        } );

        it( 'initializes correctly after NaN first measurement', function () {
            const state = kalman1d.init( makeSpec() );
            kalman1d.update( state, makeMsg( NaN ) );
            kalman1d.update( state, makeMsg( 100 ) );

            expect( state.isInitialized ).to.equal( true );
            expect( state.xHat ).to.equal( 100 );
        } );
    } );
} );

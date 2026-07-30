/**
 * Tests for SNN core building blocks: MM normalization, BLI integration,
 * L1 receptor neurons, L2 decision neuron, and burn-in calibration.
 * All functions are pure and stateless — tested in isolation.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { normalise, integrate } from '../integrate.js';
import { processReceptor, decayReceptor } from '../receptor.js';
import { computeSynapticCurrent, updateMembrane, readout } from '../decision.js';
import { computeWarmupSamples, deriveCTarget, checkCalibration } from '../calibrate.js';
import { createReceptorState, GOLDEN } from './test-helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// MM Normalization
// ─────────────────────────────────────────────────────────────────────────────

describe( 'MM normalization', function () {
    it( 'd=0 produces n=0 (golden truth)', function () {
        expect( normalise( 0, 3 ) ).to.equal( GOLDEN.mm.d0_theta3 );
    } );

    it( 'd=theta produces n=0.5 (half-saturation identity, golden truth)', function () {
        expect( normalise( 3, 3 ) ).to.equal( GOLDEN.mm.d3_theta3 );
    } );

    it( 'd=2*theta produces n=2/3 (golden truth)', function () {
        expect( normalise( 6, 3 ) ).to.equal( GOLDEN.mm.d6_theta3 );
    } );

    it( 'result is always strictly less than 1 for finite d', function () {
        expect( normalise( 1e12, 1 ) ).to.be.lessThan( 1 );
    } );

    it( 'monotonically increasing: larger d produces larger n', function () {
        const n1 = normalise( 1, 3 );
        const n2 = normalise( 5, 3 );
        const n3 = normalise( 20, 3 );
        expect( n1 ).to.be.lessThan( n2 );
        expect( n2 ).to.be.lessThan( n3 );
    } );
} );

// ─────────────────────────────────────────────────────────────────────────────
// BLI Integration
// ─────────────────────────────────────────────────────────────────────────────

describe( 'BLI integration', function () {
    it( 'cold start: charge=0, n=0.5, decayFactor=1 (golden truth)', function () {
        expect( integrate( 0, 0.5, 1 ) ).to.equal( GOLDEN.bli.coldStart_c0_n05_df1 );
    } );

    it( 'pure decay: charge=0.5, n=0, decayFactor=0.5 (golden truth)', function () {
        expect( integrate( 0.5, 0, 0.5 ) ).to.equal( GOLDEN.bli.pureDecay_c05_n0_df05 );
    } );

    it( 'headroom injection: charge never exceeds 1', function () {
        let charge = 0;
        for ( let i = 0; i < 100; i += 1 ) {
            charge = integrate( charge, 0.99, 0.999 );
        }
        expect( charge ).to.be.at.most( 1 );
    } );

    it( 'monotonicity: charge increases on every step when n > 0', function () {
        let charge = 0;
        for ( let i = 0; i < 10; i += 1 ) {
            const prev = charge;
            charge = integrate( charge, 0.3, 0.95 );
            expect( charge ).to.be.greaterThan( prev );
        }
    } );

    it( 'recovery: 10-step pure decay (golden truth)', function () {
        let charge = 0.9;
        for ( let i = 0; i < 10; i += 1 ) {
            charge = integrate( charge, 0, 0.9 );
        }
        expect( charge ).to.be.closeTo( GOLDEN.bli.pureDecay10Steps_c09_df09, 1e-12 );
    } );

    it( 'decayFactor=0 with n=0 (golden truth)', function () {
        expect( integrate( 0.8, 0, 0 ) ).to.equal( GOLDEN.bli.df0_n0 );
    } );

    it( 'decayFactor=0 with injection (golden truth)', function () {
        expect( integrate( 0.8, 0.5, 0 ) ).to.equal( GOLDEN.bli.df0_n05 );
    } );

    it( 'explicit formula c=0.6 n=0.4 df=0.7 (golden truth)', function () {
        expect( integrate( 0.6, 0.4, 0.7 ) ).to.be.closeTo( GOLDEN.bli.formula_c06_n04_df07, 1e-12 );
    } );
} );

// ─────────────────────────────────────────────────────────────────────────────
// Receptor (L1): LIF, BLI, Rate Channels
// ─────────────────────────────────────────────────────────────────────────────

describe( 'Receptor (L1)', function () {

    describe( 'processReceptor', function () {
        const gSub = GOLDEN.receptor.subThreshold_n04_df1;
        const gTwo = GOLDEN.receptor.twoStep_n06_df1;
        const gDec = GOLDEN.receptor.decayInject_m08_n01_df05;

        it( 'sub-threshold input accumulates without firing (golden truth)', function () {
            const s = createReceptorState( 1 );
            processReceptor( s, 0, 0.4, 1 );
            expect( s.membranes[ 0 ] ).to.equal( gSub.membrane );
            expect( s.spikes[ 0 ] ).to.equal( gSub.spike );
            expect( s.fired[ 0 ] ).to.equal( gSub.fired );
        } );

        it( 'threshold crossing emits graded spike (golden truth)', function () {
            const s = createReceptorState( 1 );
            processReceptor( s, 0, 0.6, 1 );
            processReceptor( s, 0, 0.6, 1 );
            expect( s.spikes[ 0 ] ).to.equal( gTwo.step2_spike );
            expect( s.fired[ 0 ] ).to.equal( gTwo.step2_fired );
        } );

        it( 'reset-by-subtraction carries excess potential (golden truth)', function () {
            const s = createReceptorState( 1 );
            processReceptor( s, 0, 0.6, 1 );
            processReceptor( s, 0, 0.6, 1 );
            expect( s.membranes[ 0 ] ).to.be.closeTo( gTwo.step2_membrane, 1e-12 );
        } );

        it( 'BLI channel integrates in parallel (golden truth)', function () {
            const s = createReceptorState( 1 );
            processReceptor( s, 0, 0.5, 1 );
            expect( s.charges[ 0 ] ).to.equal( GOLDEN.bli.coldStart_c0_n05_df1 );
        } );

        it( 'rate channel tracks firing events (golden truth)', function () {
            const s = createReceptorState( 1 );
            processReceptor( s, 0, 0.6, 1 );
            expect( s.rates[ 0 ] ).to.equal( 0 );
            processReceptor( s, 0, 0.6, 1 );
            expect( s.rates[ 0 ] ).to.equal( gTwo.step2_rate );
        } );

        it( 'decay applied before input injection (golden truth)', function () {
            const s = createReceptorState( 1 );
            s.membranes[ 0 ] = 0.8;
            processReceptor( s, 0, 0.1, 0.5 );
            expect( s.membranes[ 0 ] ).to.equal( gDec.membrane );
        } );

        it( 'steady-state firing pattern with constant input', function () {
            const s = createReceptorState( 1 );
            let fireCount = 0;
            for ( let i = 0; i < 20; i += 1 ) {
                processReceptor( s, 0, 0.4, 1 );
                fireCount += s.fired[ 0 ];
            }
            expect( fireCount ).to.be.greaterThan( 5 );
            expect( fireCount ).to.be.lessThan( 10 );
        } );
    } );

    describe( 'decayReceptor', function () {
        it( 'decays all channels and clears spike/fired (golden truth)', function () {
            const g = GOLDEN.receptor.decay_m08_c06_r2_df05;
            const s = createReceptorState( 1 );
            s.membranes[ 0 ] = 0.8;
            s.charges[ 0 ] = 0.6;
            s.rates[ 0 ] = 2.0;
            s.spikes[ 0 ] = 1.5;
            s.fired[ 0 ] = 1;
            decayReceptor( s, 0, 0.5 );
            expect( s.membranes[ 0 ] ).to.equal( g.membrane );
            expect( s.charges[ 0 ] ).to.equal( g.charge );
            expect( s.rates[ 0 ] ).to.equal( g.rate );
            expect( s.spikes[ 0 ] ).to.equal( g.spike );
            expect( s.fired[ 0 ] ).to.equal( g.fired );
        } );

        it( 'decayFactor=0 zeros all channels', function () {
            const s = createReceptorState( 1 );
            s.membranes[ 0 ] = 0.8;
            s.charges[ 0 ] = 0.6;
            s.rates[ 0 ] = 2.0;
            decayReceptor( s, 0, 0 );
            expect( s.membranes[ 0 ] ).to.equal( 0 );
            expect( s.charges[ 0 ] ).to.equal( 0 );
            expect( s.rates[ 0 ] ).to.equal( 0 );
        } );

        it( 'decayFactor=1 preserves values but clears spike', function () {
            const s = createReceptorState( 1 );
            s.membranes[ 0 ] = 0.8;
            s.spikes[ 0 ] = 1.2;
            s.fired[ 0 ] = 1;
            decayReceptor( s, 0, 1 );
            expect( s.membranes[ 0 ] ).to.equal( 0.8 );
            expect( s.spikes[ 0 ] ).to.equal( 0 );
            expect( s.fired[ 0 ] ).to.equal( 0 );
        } );
    } );
} );

// ─────────────────────────────────────────────────────────────────────────────
// Decision (L2): Synaptic Current, Membrane, Readout
// ─────────────────────────────────────────────────────────────────────────────

describe( 'Decision (L2)', function () {

    describe( 'computeSynapticCurrent', function () {
        it( 'single excitatory spike (golden truth)', function () {
            const spikes = new Float64Array( [ 1.5 ] );
            const weights = new Float64Array( [ 1.0 ] );
            expect( computeSynapticCurrent( spikes, weights, 1.0, 1 ) )
                .to.equal( GOLDEN.decision.synaptic_single );
        } );

        it( 'mixed excitatory and inhibitory (golden truth)', function () {
            const spikes = new Float64Array( [ 1.0, 0.8 ] );
            const weights = new Float64Array( [ 1.0, -0.5 ] );
            expect( computeSynapticCurrent( spikes, weights, 1.5, 2 ) )
                .to.be.closeTo( GOLDEN.decision.synaptic_mixed, 1e-12 );
        } );

        it( 'no spikes produces 0 (golden truth)', function () {
            const spikes = new Float64Array( [ 0, 0 ] );
            const weights = new Float64Array( [ 1.0, -0.5 ] );
            expect( computeSynapticCurrent( spikes, weights, 1.5, 2 ) )
                .to.equal( GOLDEN.decision.synaptic_zero );
        } );

        it( 'inhibitory-only spike produces negative current (golden truth)', function () {
            const spikes = new Float64Array( [ 0, 1.0 ] );
            const weights = new Float64Array( [ 1.0, -0.5 ] );
            expect( computeSynapticCurrent( spikes, weights, 1.5, 2 ) )
                .to.be.closeTo( GOLDEN.decision.synaptic_inhibitory, 1e-12 );
        } );
    } );

    describe( 'updateMembrane', function () {
        it( 'accumulates positive current (golden truth)', function () {
            expect( updateMembrane( 2.0, 1.0, 0.9 ) )
                .to.equal( GOLDEN.decision.membrane_accumulate );
        } );

        it( 'floors at zero for negative result (golden truth)', function () {
            expect( updateMembrane( 0.1, -1.0, 0.5 ) )
                .to.equal( GOLDEN.decision.membrane_floor );
        } );

        it( 'pure decay with zero current (golden truth)', function () {
            expect( updateMembrane( 2.0, 0, 0.9 ) )
                .to.equal( GOLDEN.decision.membrane_decay );
        } );

        it( 'zero membrane with positive current (golden truth)', function () {
            expect( updateMembrane( 0, 1.5, 0.9 ) )
                .to.equal( GOLDEN.decision.membrane_zero_pos );
        } );
    } );

    describe( 'readout', function () {
        it( 'V2=theta produces 0.5 (golden truth)', function () {
            expect( readout( 5, 5 ) ).to.equal( GOLDEN.decision.readout_half );
        } );

        it( 'V2=0 produces 0 (golden truth)', function () {
            expect( readout( 0, 1 ) ).to.equal( GOLDEN.decision.readout_zero );
        } );

        it( 'large V2 approaches 1 asymptotically (golden truth)', function () {
            expect( readout( 1000, 1 ) ).to.be.closeTo( GOLDEN.decision.readout_large, 1e-12 );
            expect( readout( 1000, 1 ) ).to.be.lessThan( 1 );
        } );

        it( 'theta <= 0 guard returns 0', function () {
            expect( readout( 5, 0 ) ).to.equal( 0 );
            expect( readout( 5, -1 ) ).to.equal( 0 );
        } );

        it( 'known value: V2=3, theta=1 (golden truth)', function () {
            expect( readout( 3, 1 ) ).to.equal( GOLDEN.decision.readout_3_1 );
        } );
    } );
} );

// ─────────────────────────────────────────────────────────────────────────────
// Calibration
// ─────────────────────────────────────────────────────────────────────────────

describe( 'Calibration', function () {

    describe( 'computeWarmupSamples', function () {
        it( 'computes ceil(5 * tau * rate) (golden truth)', function () {
            expect( computeWarmupSamples( 10, 1 ) ).to.equal( GOLDEN.calibration.warmup_tau10_rate1 );
        } );

        it( 'ceil rounds up fractional result (golden truth)', function () {
            expect( computeWarmupSamples( 10, 0.3 ) ).to.equal( GOLDEN.calibration.warmup_tau10_rate03 );
        } );

        it( 'minimum of 1 for very small tau*rate (golden truth)', function () {
            expect( computeWarmupSamples( 0.01, 0.01 ) ).to.equal( GOLDEN.calibration.warmup_tiny );
        } );
    } );

    describe( 'deriveCTarget', function () {
        it( 'returns monitorAt / 3 (golden truth)', function () {
            expect( deriveCTarget( 0.25 ) ).to.be.closeTo( GOLDEN.calibration.cTarget_025, 1e-12 );
        } );

        it( 'scales linearly with monitor threshold (golden truth)', function () {
            expect( deriveCTarget( 0.6 ) ).to.be.closeTo( GOLDEN.calibration.cTarget_06, 1e-12 );
        } );
    } );

    describe( 'checkCalibration', function () {
        it( 'no-op before warmup boundary', function () {
            const s = Object.create( null );
            s.messageCount = 5;
            s.warmupSamples = 10;
            s.calibrating = true;
            s.l2Theta = 1.0;
            checkCalibration( s );
            expect( s.calibrating ).to.equal( true );
            expect( s.l2Theta ).to.equal( 1.0 );
        } );

        it( 'derives Theta at warmup boundary (golden truth)', function () {
            const s = Object.create( null );
            s.messageCount = 10;
            s.warmupSamples = 10;
            s.calibrating = true;
            s.l2Membrane = 2.0;
            s.l2Theta = 1.0;
            s.cTarget = 0.25 / 3;
            checkCalibration( s );
            expect( s.l2Theta ).to.be.closeTo( GOLDEN.calibration.theta_V2_l2mem2, 1e-10 );
            expect( s.calibrating ).to.equal( false );
        } );

        it( 'V2=0 fallback sets Theta to 1.0', function () {
            const s = Object.create( null );
            s.messageCount = 10;
            s.warmupSamples = 10;
            s.calibrating = true;
            s.l2Membrane = 0;
            s.l2Theta = 5.0;
            s.cTarget = 0.1;
            checkCalibration( s );
            expect( s.l2Theta ).to.equal( 1.0 );
            expect( s.calibrating ).to.equal( false );
        } );

        it( 'triggers past boundary (messageCount > warmupSamples)', function () {
            const s = Object.create( null );
            s.messageCount = 15;
            s.warmupSamples = 10;
            s.calibrating = true;
            s.l2Membrane = 1.0;
            s.l2Theta = 1.0;
            s.cTarget = 0.1;
            checkCalibration( s );
            expect( s.calibrating ).to.equal( false );
        } );
    } );
} );

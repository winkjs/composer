/**
 * End-to-end integration tests for appraise node: sustained violation,
 * recovery, calibration boundary, per-source decay, mixed excitatory/inhibitory,
 * multi-source pipeline with per-source scalars, and reset-then-resume.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as appraise from '../index.js';
import {
    createMessage, GOLDEN,
    MINIMAL_SPEC, FULL_SPEC, INHIBITORY_SPEC, PER_SOURCE_HL_SPEC
} from './test-helpers.js';

describe( 'End-to-end scenarios', function () {

    it( 'sustained violation drives conviction to steady state', function () {
        const state = appraise.init( MINIMAL_SPEC );
        for ( let t = 1; t <= 50; t += 1 ) {
            appraise.update( state, createMessage( { phStat: 10, timestamp: t } ) );
        }
        expect( state.combined ).to.be.greaterThan( 0.5 );
    } );

    it( 'recovery: conviction returns to near zero after violation stops', function () {
        const state = appraise.init( MINIMAL_SPEC );
        for ( let t = 1; t <= 20; t += 1 ) {
            appraise.update( state, createMessage( { phStat: 10, timestamp: t } ) );
        }
        expect( state.combined ).to.be.greaterThan( 0.3 );

        for ( let t = 21; t <= 500; t += 1 ) {
            appraise.update( state, createMessage( { phStat: 0, timestamp: t } ) );
        }
        expect( state.combined ).to.be.lessThan( 0.01 );
    } );

    it( 'calibration boundary derives Theta', function () {
        const spec = { ...MINIMAL_SPEC, messageRate: 1.0 };
        const state = appraise.init( spec );
        expect( state.calibrating ).to.equal( true );

        const warmup = state.warmupSamples;
        for ( let t = 1; t <= warmup; t += 1 ) {
            appraise.update( state, createMessage( { phStat: 3, timestamp: t } ) );
        }
        expect( state.calibrating ).to.equal( false );
        expect( state.l2Theta ).to.be.greaterThan( 0 );
    } );

    it( 'per-source halfLife: faster source decays faster', function () {
        const state = appraise.init( PER_SOURCE_HL_SPEC );
        appraise.update( state, createMessage( {
            a: 6, b: 6, c: 6, timestamp: 1
        } ) );
        expect( state.charges[ 0 ] ).to.equal( state.charges[ 1 ] );

        appraise.update( state, createMessage( {
            a: 0, b: 0, c: 0, timestamp: 25
        } ) );
        expect( state.charges[ 0 ] ).to.be.lessThan( state.charges[ 1 ] );
        expect( state.charges[ 1 ] ).to.be.lessThan( state.charges[ 2 ] );
    } );

    it( 'mixed sources: excitatory + inhibitory end-to-end', function () {
        const state = appraise.init( INHIBITORY_SPEC );

        for ( let t = 1; t <= 10; t += 1 ) {
            appraise.update( state, createMessage( {
                phStat: 10, trendSlope: 0, timestamp: t
            } ) );
        }
        const peakCombined = state.combined;
        expect( peakCombined ).to.be.greaterThan( 0 );

        for ( let t = 11; t <= 30; t += 1 ) {
            appraise.update( state, createMessage( {
                phStat: 0, trendSlope: -5, timestamp: t
            } ) );
        }
        expect( state.combined ).to.be.lessThan( peakCombined );
    } );

    it( 'multi-source pipeline publishes per-source scalars', function () {
        const state = appraise.init( FULL_SPEC );
        for ( let t = 1; t <= 5; t += 1 ) {
            appraise.update( state, createMessage( {
                phStat: 5,
kurtPhStat: 3,
rmsTrendConf: 1.0,
esEnvelope: 0.1,
                timestamp: t
            } ) );
        }
        const msg = Object.create( null );
        appraise.publishTo( state, msg );

        // Scalar stats
        expect( msg.eaCombined ).to.equal( state.combined );
        expect( msg.eaState ).to.equal( state.stateName );
        expect( msg.eaMembrane ).to.equal( state.l2Membrane );
        expect( msg.eaCalibrating ).to.equal( state.calibrating );

        // Per-source charge scalars
        expect( msg.eaCharge_phStat ).to.equal( state.charges[ 0 ] );
        expect( msg.eaCharge_kurtPhStat ).to.equal( state.charges[ 1 ] );
        expect( msg.eaCharge_rmsTrendConf ).to.equal( state.charges[ 2 ] );
        expect( msg.eaCharge_esEnvelope ).to.equal( state.charges[ 3 ] );

        // Per-source rate scalars
        expect( msg.eaRate_phStat ).to.equal( state.rates[ 0 ] );
        expect( msg.eaRate_kurtPhStat ).to.equal( state.rates[ 1 ] );
        expect( msg.eaRate_rmsTrendConf ).to.equal( state.rates[ 2 ] );
        expect( msg.eaRate_esEnvelope ).to.equal( state.rates[ 3 ] );

        // At least some charges should be non-zero after 5 updates
        const anyChargeNonZero = ( msg.eaCharge_phStat > 0 ) ||
            ( msg.eaCharge_kurtPhStat > 0 ) ||
            ( msg.eaCharge_rmsTrendConf > 0 ) ||
            ( msg.eaCharge_esEnvelope > 0 );
        expect( anyChargeNonZero ).to.equal( true );
    } );

    it( 'reset then resume: cold start after reset', function () {
        const state = appraise.init( MINIMAL_SPEC );
        for ( let t = 1; t <= 5; t += 1 ) {
            appraise.update( state, createMessage( { phStat: 10, timestamp: t } ) );
        }
        appraise.reset( state );

        appraise.update( state, createMessage( { phStat: 6, timestamp: 100 } ) );
        expect( state.charges[ 0 ] ).to.equal( GOLDEN.mm.d6_theta3 );
    } );
} );

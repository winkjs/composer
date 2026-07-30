/**
 * Tests for appraise update loop, signed weight dynamics, and threshold
 * classification. Covers message processing, decay, missing fields,
 * validation failure, excitatory/inhibitory interaction, and state transitions.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import * as appraise from '../index.js';
import { createMessage, MINIMAL_SPEC, INHIBITORY_SPEC, PER_SOURCE_HL_SPEC, TAU, GOLDEN } from './test-helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// Update Loop
// ─────────────────────────────────────────────────────────────────────────────

describe( 'Update loop', function () {
    let state;

    beforeEach( function () {
        state = appraise.init( MINIMAL_SPEC );
    } );

    it( 'first message: no spike, combined stays 0 (golden truth)', function () {
        const g = GOLDEN.e2e.messages[ 0 ];
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        expect( state.combined ).to.equal( g.combined );
        expect( state.spikes[ 0 ] ).to.equal( g.spike );
    } );

    it( 'first message: BLI charge still computed (golden truth)', function () {
        const g = GOLDEN.e2e.messages[ 0 ];
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        expect( state.charges[ 0 ] ).to.equal( g.charge );
    } );

    it( 'second message: L1 fires, L2 accumulates, conviction rises (golden truth)', function () {
        const g = GOLDEN.e2e.messages[ 1 ];
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        appraise.update( state, createMessage( { phStat: 6, timestamp: 2 } ) );

        expect( state.fired[ 0 ] ).to.equal( g.fired );
        expect( state.combined ).to.be.closeTo( g.combined, 1e-10 );
        expect( state.combined ).to.be.greaterThan( 0 );
    } );

    it( 'increments messageCount on each valid message', function () {
        appraise.update( state, createMessage( { phStat: 3, timestamp: 1 } ) );
        expect( state.messageCount ).to.equal( 1 );
        appraise.update( state, createMessage( { phStat: 3, timestamp: 2 } ) );
        expect( state.messageCount ).to.equal( 2 );
    } );

    it( 'missing source field causes pure decay', function () {
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        const chargeAfterFirst = state.charges[ 0 ];
        appraise.update( state, createMessage( { timestamp: 2 } ) );
        const df = Math.exp( -1 / TAU );
        expect( state.charges[ 0 ] ).to.be.closeTo( chargeAfterFirst * df, 1e-12 );
    } );

    it( 'missing field in per-source decay path causes pure decay', function () {
        const psState = appraise.init( PER_SOURCE_HL_SPEC );
        appraise.update( psState, createMessage( { a: 6, b: 6, c: 6, timestamp: 1 } ) );
        const chargeB = psState.charges[ 1 ];
        // Second message: source 'b' missing — pure decay on that channel
        appraise.update( psState, createMessage( { a: 6, c: 6, timestamp: 2 } ) );
        expect( psState.charges[ 1 ] ).to.be.lessThan( chargeB );
    } );

    it( 'invalid timestamp sets inputValidationFailed', function () {
        appraise.update( state, createMessage( { phStat: 3, timestamp: NaN } ) );
        expect( state.inputValidationFailed ).to.equal( true );
    } );

    it( 'disabled state returns immediately', function () {
        state.disable = true;
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        expect( state.charges[ 0 ] ).to.equal( 0 );
        expect( state.messageCount ).to.equal( 0 );
    } );

    it( 'quiet after excitatory: conviction decays', function () {
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        appraise.update( state, createMessage( { phStat: 6, timestamp: 2 } ) );
        const peakCombined = state.combined;
        expect( peakCombined ).to.be.greaterThan( 0 );

        appraise.update( state, createMessage( { timestamp: 3 } ) );
        expect( state.combined ).to.be.lessThan( peakCombined );
    } );
} );

// ─────────────────────────────────────────────────────────────────────────────
// Signed Weights: Excitatory / Inhibitory
// ─────────────────────────────────────────────────────────────────────────────

describe( 'Signed weights', function () {
    it( 'inhibitory spike reduces L2 membrane', function () {
        const state = appraise.init( INHIBITORY_SPEC );
        for ( let t = 1; t <= 5; t += 1 ) {
            appraise.update( state, createMessage( {
                phStat: 10, trendSlope: 0, timestamp: t
            } ) );
        }
        const preInhibit = state.l2Membrane;
        expect( preInhibit ).to.be.greaterThan( 0 );

        for ( let t = 6; t <= 10; t += 1 ) {
            appraise.update( state, createMessage( {
                phStat: 0, trendSlope: -5, timestamp: t
            } ) );
        }
        expect( state.l2Membrane ).to.be.lessThan( preInhibit );
    } );

    it( 'active recovery is faster than passive decay', function () {
        const state1 = appraise.init( INHIBITORY_SPEC );
        const state2 = appraise.init( INHIBITORY_SPEC );

        for ( let t = 1; t <= 5; t += 1 ) {
            const msg = createMessage( { phStat: 10, trendSlope: 0, timestamp: t } );
            appraise.update( state1, msg );
            appraise.update( state2, msg );
        }

        for ( let t = 6; t <= 15; t += 1 ) {
            appraise.update( state1, createMessage( {
                phStat: 0, trendSlope: 0, timestamp: t
            } ) );
            appraise.update( state2, createMessage( {
                phStat: 0, trendSlope: -5, timestamp: t
            } ) );
        }

        expect( state2.combined ).to.be.lessThan( state1.combined );
    } );
} );

// ─────────────────────────────────────────────────────────────────────────────
// Threshold Classification
// ─────────────────────────────────────────────────────────────────────────────

describe( 'Threshold classification', function () {
    it( 'Normal when combined < monitor.at', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( state.stateName ).to.equal( 'Normal' );
    } );

    it( 'classifies correctly as conviction rises', function () {
        const state = appraise.init( MINIMAL_SPEC );
        for ( let t = 1; t <= 3; t += 1 ) {
            appraise.update( state, createMessage( { phStat: 100, timestamp: t } ) );
        }
        expect( [ 'Monitor', 'Degraded', 'Critical' ] ).to.include( state.stateName );
    } );

    it( 'Critical when combined >= critical.at', function () {
        const state = appraise.init( MINIMAL_SPEC );
        for ( let t = 1; t <= 20; t += 1 ) {
            appraise.update( state, createMessage( { phStat: 1000, timestamp: t } ) );
        }
        expect( state.stateName ).to.equal( 'Critical' );
    } );

    it( 'returns to Normal after quiet period', function () {
        const state = appraise.init( MINIMAL_SPEC );
        for ( let t = 1; t <= 5; t += 1 ) {
            appraise.update( state, createMessage( { phStat: 100, timestamp: t } ) );
        }
        for ( let t = 6; t <= 500; t += 1 ) {
            appraise.update( state, createMessage( { phStat: 0, timestamp: t } ) );
        }
        expect( state.stateName ).to.equal( 'Normal' );
    } );
} );

/**
 * Tests for appraise node lifecycle: reset (two-layer, Theta preservation),
 * recompute (NaN recovery, numerical stability), disable/enable, pause/unpause.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as appraise from '../index.js';
import { getSupportedControlMethods } from '../introspect.js';
import { readout } from '../decision.js';
import { createMessage, MINIMAL_SPEC } from './test-helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// Reset
// ─────────────────────────────────────────────────────────────────────────────

describe( 'Reset', function () {
    it( 'clears L1 state arrays', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        appraise.update( state, createMessage( { phStat: 6, timestamp: 2 } ) );
        appraise.reset( state );
        expect( state.membranes[ 0 ] ).to.equal( 0 );
        expect( state.spikes[ 0 ] ).to.equal( 0 );
        expect( state.fired[ 0 ] ).to.equal( 0 );
        expect( state.charges[ 0 ] ).to.equal( 0 );
        expect( state.rates[ 0 ] ).to.equal( 0 );
    } );

    it( 'clears L2 membrane', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        appraise.update( state, createMessage( { phStat: 6, timestamp: 2 } ) );
        appraise.reset( state );
        expect( state.l2Membrane ).to.equal( 0 );
    } );

    it( 'resets combined and stateName', function () {
        const state = appraise.init( MINIMAL_SPEC );
        for ( let t = 1; t <= 10; t += 1 ) {
            appraise.update( state, createMessage( { phStat: 100, timestamp: t } ) );
        }
        appraise.reset( state );
        expect( state.combined ).to.equal( 0 );
        expect( state.stateName ).to.equal( 'Normal' );
    } );

    it( 'resets timing for cold start', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.update( state, createMessage( { phStat: 3, timestamp: 1 } ) );
        appraise.reset( state );
        expect( state.lastTimestamp ).to.equal( 0 );
        expect( state.hasReceivedMessage ).to.equal( false );
    } );

    it( 'preserves Theta after calibration is complete', function () {
        const state = appraise.init( MINIMAL_SPEC );
        state.calibrating = false;
        state.l2Theta = 5.5;
        appraise.reset( state );
        expect( state.l2Theta ).to.equal( 5.5 );
        expect( state.calibrating ).to.equal( false );
    } );

    it( 'resets messageCount if still calibrating', function () {
        const state = appraise.init( MINIMAL_SPEC );
        state.messageCount = 50;
        expect( state.calibrating ).to.equal( true );
        appraise.reset( state );
        expect( state.messageCount ).to.equal( 0 );
    } );

    it( 'preserves messageCount if calibration is done', function () {
        const state = appraise.init( MINIMAL_SPEC );
        state.calibrating = false;
        state.messageCount = 200;
        appraise.reset( state );
        expect( state.messageCount ).to.equal( 200 );
    } );

    it( 'returns true', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( appraise.reset( state ) ).to.equal( true );
    } );
} );

// ─────────────────────────────────────────────────────────────────────────────
// Recompute
// ─────────────────────────────────────────────────────────────────────────────

describe( 'Recompute', function () {
    it( 'NaN in L1 charges triggers reset', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        state.charges[ 0 ] = NaN;
        appraise.recompute( state );
        expect( state.charges[ 0 ] ).to.equal( 0 );
        expect( state.l2Membrane ).to.equal( 0 );
    } );

    it( 'NaN in L1 membranes triggers reset', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        state.membranes[ 0 ] = NaN;
        appraise.recompute( state );
        expect( state.membranes[ 0 ] ).to.equal( 0 );
    } );

    it( 'NaN in L2 membrane triggers reset', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        state.l2Membrane = NaN;
        appraise.recompute( state );
        expect( state.l2Membrane ).to.equal( 0 );
        expect( state.combined ).to.equal( 0 );
    } );

    it( 'clamps L1 charges to [0, 1]', function () {
        const state = appraise.init( MINIMAL_SPEC );
        state.charges[ 0 ] = 1.5;
        appraise.recompute( state );
        expect( state.charges[ 0 ] ).to.equal( 1 );
    } );

    it( 'floors L1 charges at 0', function () {
        const state = appraise.init( MINIMAL_SPEC );
        state.charges[ 0 ] = -0.3;
        appraise.recompute( state );
        expect( state.charges[ 0 ] ).to.equal( 0 );
    } );

    it( 'floors L1 membranes at 0', function () {
        const state = appraise.init( MINIMAL_SPEC );
        state.membranes[ 0 ] = -0.5;
        appraise.recompute( state );
        expect( state.membranes[ 0 ] ).to.equal( 0 );
    } );

    it( 'floors L2 membrane at 0', function () {
        const state = appraise.init( MINIMAL_SPEC );
        state.l2Membrane = -1.0;
        appraise.recompute( state );
        expect( state.l2Membrane ).to.equal( 0 );
    } );

    it( 'recomputes conviction via MM readout', function () {
        const state = appraise.init( MINIMAL_SPEC );
        state.l2Membrane = 3.0;
        appraise.recompute( state );
        expect( state.combined ).to.equal( readout( 3.0, state.l2Theta ) );
    } );

    it( 'reclassifies state after recompute', function () {
        const state = appraise.init( MINIMAL_SPEC );
        state.l2Membrane = 100;
        appraise.recompute( state );
        expect( state.stateName ).not.to.equal( 'Normal' );
    } );

    it( 'idempotent on clean state', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        const before = state.combined;
        appraise.recompute( state );
        expect( state.combined ).to.equal( before );
    } );

    it( 'returns true', function () {
        const state = appraise.init( MINIMAL_SPEC );
        expect( appraise.recompute( state ) ).to.equal( true );
    } );
} );

// ─────────────────────────────────────────────────────────────────────────────
// Disable / Enable
// ─────────────────────────────────────────────────────────────────────────────

describe( 'Disable / Enable', function () {
    it( 'disable sets flag', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.disable( state );
        expect( state.disable ).to.equal( true );
    } );

    it( 'update skips processing when disabled', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.disable( state );
        appraise.update( state, createMessage( { phStat: 100, timestamp: 1 } ) );
        expect( state.charges[ 0 ] ).to.equal( 0 );
    } );

    it( 'publishTo skips when disabled', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.disable( state );
        const msg = Object.create( null );
        appraise.publishTo( state, msg );
        expect( msg.eaCombined ).to.equal( undefined );
    } );

    it( 'enable clears flag and resumes processing', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.disable( state );
        appraise.enable( state );
        expect( state.disable ).to.equal( false );
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        expect( state.charges[ 0 ] ).to.be.greaterThan( 0 );
    } );

    it( 'disable preserves existing state', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        const chargeBeforeDisable = state.charges[ 0 ];
        appraise.disable( state );
        expect( state.charges[ 0 ] ).to.equal( chargeBeforeDisable );
    } );
} );

// ─────────────────────────────────────────────────────────────────────────────
// Pause / Unpause
// ─────────────────────────────────────────────────────────────────────────────

describe( 'Pause/Unpause control', function () {
    it( 'skips update when paused', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.update( state, createMessage( { phStat: 10, timestamp: 1 } ) );
        const combinedBefore = state.combined;

        state.pause = true;
        appraise.update( state, createMessage( { phStat: 100, timestamp: 2 } ) );

        expect( state.combined ).to.equal( combinedBefore );
    } );

    it( 'publishes when paused', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.update( state, createMessage( { phStat: 10, timestamp: 1 } ) );

        state.pause = true;
        const msg = Object.create( null );
        appraise.publishTo( state, msg );

        expect( msg.eaCombined ).to.equal( state.combined );
    } );

    it( 'pause/unpause control methods exist', function () {
        const methods = getSupportedControlMethods();
        expect( methods ).to.have.property( 'pause' );
        expect( methods ).to.have.property( 'unpause' );
    } );
} );

/**
 * Tests for appraise publishTo: per-source scalar publishing, NaN fault
 * isolation across all numeric fields, and disable guard.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as appraise from '../index.js';
import { createMessage, MINIMAL_SPEC, FULL_SPEC } from './test-helpers.js';

describe( 'Publishing', function () {
    it( 'publishes combined', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        const msg = Object.create( null );
        appraise.publishTo( state, msg );
        expect( msg.eaCombined ).to.equal( state.combined );
    } );

    it( 'publishes all configured stats as per-source scalars', function () {
        const state = appraise.init( FULL_SPEC );
        appraise.update( state, createMessage( {
            phStat: 3,
kurtPhStat: 2,
rmsTrendConf: 0.5,
esEnvelope: 0.02,
            timestamp: 1
        } ) );
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
    } );

    it( 'per-source charge values match internal charges array', function () {
        const state = appraise.init( FULL_SPEC );
        appraise.update( state, createMessage( {
            phStat: 3,
kurtPhStat: 2,
rmsTrendConf: 0.5,
esEnvelope: 0.02,
            timestamp: 1
        } ) );
        const msg = Object.create( null );
        appraise.publishTo( state, msg );

        expect( msg.eaCharge_phStat ).to.equal( state.charges[ 0 ] );
        expect( msg.eaCharge_kurtPhStat ).to.equal( state.charges[ 1 ] );
        expect( msg.eaCharge_rmsTrendConf ).to.equal( state.charges[ 2 ] );
        expect( msg.eaCharge_esEnvelope ).to.equal( state.charges[ 3 ] );
    } );

    it( 'per-source rate values match internal rates array', function () {
        const state = appraise.init( FULL_SPEC );
        appraise.update( state, createMessage( {
            phStat: 3,
kurtPhStat: 2,
rmsTrendConf: 0.5,
esEnvelope: 0.02,
            timestamp: 1
        } ) );
        const msg = Object.create( null );
        appraise.publishTo( state, msg );

        expect( msg.eaRate_phStat ).to.equal( state.rates[ 0 ] );
        expect( msg.eaRate_kurtPhStat ).to.equal( state.rates[ 1 ] );
        expect( msg.eaRate_rmsTrendConf ).to.equal( state.rates[ 2 ] );
        expect( msg.eaRate_esEnvelope ).to.equal( state.rates[ 3 ] );
    } );

    it( 'publishes NaN for all numeric stats on validation failure', function () {
        const state = appraise.init( FULL_SPEC );
        appraise.update( state, createMessage( { timestamp: NaN } ) );
        const msg = Object.create( null );
        appraise.publishTo( state, msg );

        // Scalar numeric stats
        expect( Number.isNaN( msg.eaCombined ) ).to.equal( true );
        expect( Number.isNaN( msg.eaMembrane ) ).to.equal( true );

        // Per-source charge NaN
        expect( Number.isNaN( msg.eaCharge_phStat ) ).to.equal( true );
        expect( Number.isNaN( msg.eaCharge_kurtPhStat ) ).to.equal( true );
        expect( Number.isNaN( msg.eaCharge_rmsTrendConf ) ).to.equal( true );
        expect( Number.isNaN( msg.eaCharge_esEnvelope ) ).to.equal( true );

        // Per-source rate NaN
        expect( Number.isNaN( msg.eaRate_phStat ) ).to.equal( true );
        expect( Number.isNaN( msg.eaRate_kurtPhStat ) ).to.equal( true );
        expect( Number.isNaN( msg.eaRate_rmsTrendConf ) ).to.equal( true );
        expect( Number.isNaN( msg.eaRate_esEnvelope ) ).to.equal( true );

        // Non-numeric stats not published on failure
        expect( msg.eaState ).to.equal( undefined );
        expect( msg.eaCalibrating ).to.equal( undefined );
    } );

    it( 'skips publishing when disabled', function () {
        const state = appraise.init( MINIMAL_SPEC );
        state.disable = true;
        const msg = Object.create( null );
        appraise.publishTo( state, msg );
        expect( msg.eaCombined ).to.equal( undefined );
    } );

    it( 'does not publish per-source fields when stats not configured', function () {
        const state = appraise.init( MINIMAL_SPEC );
        appraise.update( state, createMessage( { phStat: 6, timestamp: 1 } ) );
        const msg = Object.create( null );
        appraise.publishTo( state, msg );

        // MINIMAL_SPEC only has combined — no charge/rate fields
        expect( msg.eaCombined ).to.equal( state.combined );
        expect( msg.eaCharge_phStat ).to.equal( undefined );
        expect( msg.eaRate_phStat ).to.equal( undefined );
    } );
} );

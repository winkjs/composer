// Publishing tests for kalman1d node.
// Covers stat publishing, NaN propagation, disabled/paused states,
// and innovation publishing after outlier exclusion.

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as kalman1d from '../index.js';
import { goldenTruth, TOL_STATE, TOL_DERIVED, makeSpec, makeMsg, feedSequence } from './test-helpers.js';

const gt7 = goldenTruth[ 'S7-basic-innovation' ];
const gt2 = goldenTruth[ 'S2-step-change-exclude' ];

describe( 'Kalman 1d — publishTo', function () {

    it( 'publishes all requested stats with exact values', function () {
        // see golden-truth-kalman1d.py §7: init(100), update(102)
        const state = kalman1d.init( makeSpec() );
        kalman1d.update( state, makeMsg( 100 ) );
        kalman1d.update( state, makeMsg( 102 ) );

        const msg = {};
        kalman1d.publishTo( state, msg );

        expect( msg.tempEst ).to.be.closeTo( gt7.xHat, TOL_STATE );
        expect( msg.tempVar ).to.be.closeTo( gt7.P, TOL_STATE );
        expect( msg.tempInnov ).to.be.closeTo( gt7.innovation, TOL_STATE );
        expect( msg.tempGate ).to.be.closeTo( gt7.innovationGate, TOL_DERIVED );
    } );

    it( 'publishes only requested stats', function () {
        const state = kalman1d.init( makeSpec( {
            stats: {
                filtered: { storeAs: 'tempEst' }
            }
        } ) );
        kalman1d.update( state, makeMsg( 100 ) );

        const msg = {};
        kalman1d.publishTo( state, msg );

        expect( msg.tempEst ).to.equal( 100 );
        expect( msg.tempVar ).to.equal( undefined );
        expect( msg.tempInnov ).to.equal( undefined );
        expect( msg.tempGate ).to.equal( undefined );
    } );

    it( 'publishes NaN on validation failure', function () {
        const state = kalman1d.init( makeSpec() );
        kalman1d.update( state, makeMsg( 100 ) );
        kalman1d.update( state, makeMsg( NaN ) );

        const msg = {};
        kalman1d.publishTo( state, msg );

        expect( Number.isNaN( msg.tempEst ) ).to.equal( true );
        expect( Number.isNaN( msg.tempVar ) ).to.equal( true );
        expect( Number.isNaN( msg.tempInnov ) ).to.equal( true );
        expect( Number.isNaN( msg.tempGate ) ).to.equal( true );
    } );

    it( 'skips when disabled', function () {
        const state = kalman1d.init( makeSpec() );
        kalman1d.update( state, makeMsg( 100 ) );
        kalman1d.disable( state );

        const msg = {};
        kalman1d.publishTo( state, msg );

        expect( msg.tempEst ).to.equal( undefined );
    } );

    it( 'publishes when paused (last-known values)', function () {
        const state = kalman1d.init( makeSpec() );
        kalman1d.update( state, makeMsg( 100 ) );
        kalman1d.pause( state );

        const msg = {};
        kalman1d.publishTo( state, msg );

        expect( msg.tempEst ).to.equal( 100 );
        expect( msg.tempVar ).to.equal( 1 );
    } );

    it( 'publishes innovation after outlier exclusion', function () {
        // see golden-truth-kalman1d.py §2: first excluded step
        const state = kalman1d.init( makeSpec() );
        feedSequence( state, new Array( 12 ).fill( 100 ), null, null );

        // Excluded outlier
        kalman1d.update( state, makeMsg( 200 ) );

        const msg = {};
        kalman1d.publishTo( state, msg );

        // Innovation reflects the excluded measurement
        expect( msg.tempInnov ).to.be.closeTo( gt2.firstExcluded.innovation, TOL_DERIVED );
        expect( msg.tempGate ).to.be.closeTo( gt2.firstExcluded.innovationGate, 1 );
        // Filtered value is the prediction, P is predicted covariance
        expect( msg.tempEst ).to.be.closeTo( gt2.firstExcluded.xHat, TOL_STATE );
        expect( msg.tempVar ).to.be.closeTo( gt2.firstExcluded.P, TOL_STATE );
    } );
} );

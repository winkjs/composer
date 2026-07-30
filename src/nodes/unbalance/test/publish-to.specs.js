/**
 * @fileoverview publishTo tests for the unbalance node — selective emission of
 * only the configured stats, NaN propagation to every output on a faulted tick,
 * and silence when the node is disabled.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import * as ub from '../index.js';
import { STORE, METRIC_STATS, allStatsOutputs, specFor, msgFrom, runOnce } from './test-helpers.js';

describe( 'unbalance — publishTo', function () {

    it( 'copies only the configured stats onto the message', function () {
        const { msg } = runOnce( [ 'a', 'b', 'c' ], [ 110, 100, 96 ], {
            mean: { storeAs: STORE.mean },
            range: { storeAs: STORE.range }
        } );
        expect( msg[ STORE.mean ] ).to.be.closeTo( 102, 1e-12 );
        expect( msg[ STORE.range ] ).to.equal( 14 );
        // Unrequested stats must not appear.
        expect( STORE.min in msg ).to.equal( false );
        expect( STORE.max in msg ).to.equal( false );
        expect( STORE.maxDev in msg ).to.equal( false );
        expect( STORE.unbalance in msg ).to.equal( false );
        expect( STORE.worstIndex in msg ).to.equal( false );
        expect( STORE.worstDev in msg ).to.equal( false );
    } );

    it( 'publishes NaN to every configured metric on an invalid input', function () {
        const { msg } = runOnce( [ 'a', 'b', 'c' ], [ NaN, 100, 100 ] );
        for ( let i = 0; i < METRIC_STATS.length; i += 1 ) {
            expect( Number.isNaN( msg[ STORE[ METRIC_STATS[ i ] ] ] ) ).to.equal( true );
        }
    } );

    it( 'emits nothing when the node is disabled', function () {
        const fields = [ 'a', 'b', 'c' ];
        const state = ub.init( specFor( fields ) );
        ub.disable( state );
        ub.update( state, msgFrom( fields, [ 110, 100, 96 ] ) );
        const msg = Object.create( null );
        ub.publishTo( state, msg );
        expect( Object.keys( msg ).length ).to.equal( 0 );
    } );

    it( 'emits presentCount as the real count in skip mode', function () {
        const stats = allStatsOutputs();
        stats.presentCount = { storeAs: STORE.presentCount };
        const { msg } = runOnce( [ 'a', 'b', 'c' ], [ 100, NaN, 96 ], stats, { skipOnNaN: true, minPresent: 2 } );
        expect( msg[ STORE.presentCount ] ).to.equal( 2 );
        expect( msg[ STORE.mean ] ).to.be.closeTo( 98, 1e-12 );
    } );

    it( 'keeps presentCount real on a blanked tick while the metrics go NaN', function () {
        const stats = allStatsOutputs();
        stats.presentCount = { storeAs: STORE.presentCount };
        // Blank mode (default): one missing field blanks every metric.
        const { msg } = runOnce( [ 'a', 'b', 'c' ], [ NaN, 100, 96 ], stats );
        for ( let i = 0; i < METRIC_STATS.length; i += 1 ) {
            expect( Number.isNaN( msg[ STORE[ METRIC_STATS[ i ] ] ] ) ).to.equal( true );
        }
        expect( msg[ STORE.presentCount ] ).to.equal( 2 );
    } );

    it( 'does not write presentCount when it is not configured', function () {
        const { msg } = runOnce( [ 'a', 'b', 'c' ], [ 110, 100, 96 ] );
        expect( STORE.presentCount in msg ).to.equal( false );
    } );
} );

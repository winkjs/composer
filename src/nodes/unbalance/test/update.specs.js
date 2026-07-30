/**
 * @fileoverview Hot-path computation tests for the unbalance node.
 *
 * The numpy golden-truth file covers the broad numeric input space; this file
 * pins the spec-defined conventions that numpy's argmax would NOT settle the
 * same way (the high-side tie-break) plus the trivial-by-hand edge cases
 * (all-equal, single-phasing, near-zero mean) and the fault paths. Expected
 * values for the convention cases come from the documented spec rule in
 * Requirement 6, not from running the node.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import * as ub from '../index.js';
import { specFor, msgFrom } from './test-helpers.js';

const feed = function ( fields, values, stats, options ) {
    const state = ub.init( specFor( fields, stats, options ) );
    ub.update( state, msgFrom( fields, values ) );
    return state;
};

describe( 'unbalance — update (hot path)', function () {

    it( 'reduces the field group at a single tick', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ 110, 100, 96 ] );
        expect( s.mean ).to.be.closeTo( 102, 1e-12 );
        expect( s.min ).to.equal( 96 );
        expect( s.max ).to.equal( 110 );
        expect( s.range ).to.equal( 14 );
        expect( s.maxDev ).to.be.closeTo( 8, 1e-12 );
        expect( s.unbalance ).to.be.closeTo( 7.843137254901961, 1e-9 );
        expect( s.worstIndex ).to.equal( 0 );
        expect( s.worstDev ).to.be.closeTo( 8, 1e-12 );
    } );

    // Requirement 6: on an exact symmetric tie the high side wins. This is the
    // documented convention — numpy's first-wins argmax would not settle it the
    // same way, so it is pinned here by hand.
    it( 'breaks a symmetric tie toward the high side', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ 110, 100, 90 ] );
        expect( s.maxDev ).to.be.closeTo( 10, 1e-12 );
        expect( s.worstIndex ).to.equal( 0 );
        expect( s.worstDev ).to.be.closeTo( 10, 1e-12 );
    } );

    // With two channels the two extremes are always equidistant from the mean,
    // so every N=2 case is a tie and resolves to the high side.
    it( 'treats N=2 as a tie and reports the high channel', function () {
        const s = feed( [ 'a', 'b' ], [ 100, 80 ] );
        expect( s.mean ).to.equal( 90 );
        expect( s.worstIndex ).to.equal( 0 );
        expect( s.worstDev ).to.be.closeTo( 10, 1e-12 );
        expect( s.unbalance ).to.be.closeTo( 11.11111111111111, 1e-9 );
    } );

    it( 'reports zero unbalance when all channels are equal', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ 42, 42, 42 ] );
        expect( s.range ).to.equal( 0 );
        expect( s.maxDev ).to.equal( 0 );
        expect( s.unbalance ).to.equal( 0 );
        expect( s.worstIndex ).to.equal( 0 );
        expect( s.worstDev ).to.equal( 0 );
    } );

    it( 'reports a large finite unbalance on single-phasing (one channel at zero)', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ 100, 100, 0 ] );
        expect( s.range ).to.equal( 100 );
        expect( s.unbalance ).to.be.closeTo( 100, 1e-9 );
        expect( s.worstIndex ).to.equal( 2 );
        expect( s.worstDev ).to.be.closeTo( -66.66666666666667, 1e-9 );
    } );

    it( 'makes only unbalance NaN at a near-zero mean; spread stays valid', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ 5, -5, 1e-15 ] );
        expect( Number.isNaN( s.unbalance ) ).to.equal( true );
        expect( s.min ).to.equal( -5 );
        expect( s.max ).to.equal( 5 );
        expect( s.range ).to.equal( 10 );
        expect( s.maxDev ).to.be.closeTo( 5, 1e-9 );
    } );

    it( 'flags the tick invalid on a NaN input', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ NaN, 100, 100 ] );
        expect( s.inputValidationFailed ).to.equal( true );
    } );

    it( 'flags the tick invalid on +Infinity (Number.isFinite path, not NaN-poison)', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ Infinity, 100, 100 ] );
        expect( s.inputValidationFailed ).to.equal( true );
    } );

    it( 'flags the tick invalid on -Infinity', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ -Infinity, 100, 100 ] );
        expect( s.inputValidationFailed ).to.equal( true );
    } );

    it( 'clears the invalid flag on the next good tick', function () {
        const fields = [ 'a', 'b', 'c' ];
        const state = ub.init( specFor( fields ) );
        ub.update( state, msgFrom( fields, [ NaN, 100, 100 ] ) );
        expect( state.inputValidationFailed ).to.equal( true );
        ub.update( state, msgFrom( fields, [ 110, 100, 96 ] ) );
        expect( state.inputValidationFailed ).to.equal( false );
        expect( state.mean ).to.be.closeTo( 102, 1e-12 );
    } );

    it( 'skips the deviation step when no deviation stat is requested', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ 110, 100, 96 ], {
            mean: { storeAs: 'm' },
            range: { storeAs: 'r' }
        } );
        // Spread stats computed...
        expect( s.mean ).to.be.closeTo( 102, 1e-12 );
        expect( s.range ).to.equal( 14 );
        // ...deviation stats left at their init values (block short-circuited).
        expect( s.maxDev ).to.equal( 0 );
        expect( s.unbalance ).to.equal( 0 );
        expect( s.worstIndex ).to.equal( 0 );
        expect( s.worstDev ).to.equal( 0 );
    } );

    it( 'sets presentCount to the full width in blank mode (default)', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ 110, 100, 96 ] );
        expect( s.presentCount ).to.equal( 3 );
    } );
} );

describe( 'unbalance — update (skip mode)', function () {

    it( 'computes the metric over the present channels when skipOnNaN is on', function () {
        // Middle field missing; mean over the two present ( 100, 96 ) = 98.
        const s = feed( [ 'a', 'b', 'c' ], [ 100, NaN, 96 ], undefined, { skipOnNaN: true, minPresent: 2 } );
        expect( s.presentCount ).to.equal( 2 );
        expect( s.inputValidationFailed ).to.equal( false );
        expect( s.mean ).to.be.closeTo( 98, 1e-12 );
        expect( s.min ).to.equal( 96 );
        expect( s.max ).to.equal( 100 );
    } );

    it( 'reports worstIndex as the real field index, not the present-subset index', function () {
        // Field 1 missing; present are fields 0 and 2. The high field 0 is worst.
        const s = feed( [ 'a', 'b', 'c' ], [ 130, NaN, 100 ], undefined, { skipOnNaN: true, minPresent: 2 } );
        expect( s.presentCount ).to.equal( 2 );
        expect( s.worstIndex ).to.equal( 0 );
    } );

    it( 'blanks the metrics but keeps presentCount below the minPresent floor', function () {
        // Four present required, only two report.
        const s = feed( [ 'a', 'b', 'c', 'd' ], [ 100, NaN, NaN, 96 ], undefined, { skipOnNaN: true, minPresent: 4 } );
        expect( s.inputValidationFailed ).to.equal( true );
        expect( s.presentCount ).to.equal( 2 );
    } );

    it( 'blanks with presentCount zero when every channel is missing', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ NaN, NaN, NaN ], undefined, { skipOnNaN: true, minPresent: 2 } );
        expect( s.inputValidationFailed ).to.equal( true );
        expect( s.presentCount ).to.equal( 0 );
    } );

    it( 'matches blank mode exactly when skipOnNaN is on but nothing is missing', function () {
        const skip = feed( [ 'a', 'b', 'c' ], [ 110, 100, 96 ], undefined, { skipOnNaN: true } );
        const blank = feed( [ 'a', 'b', 'c' ], [ 110, 100, 96 ] );
        expect( skip.presentCount ).to.equal( 3 );
        expect( skip.mean ).to.equal( blank.mean );
        expect( skip.unbalance ).to.equal( blank.unbalance );
        expect( skip.worstIndex ).to.equal( blank.worstIndex );
        expect( skip.worstDev ).to.equal( blank.worstDev );
    } );
} );

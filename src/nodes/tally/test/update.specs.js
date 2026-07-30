/**
 * @fileoverview Hot-path computation tests for the tally node.
 *
 * Boolean logic over flags, so the expected values are trivial and hand-computed
 * (a small integer count, true / false). This file pins the three reductions
 * across all-true / all-false / mixed sets, the truthiness reading (1 and a
 * truthy string count; 0, '', null, undefined do not), the N = 1 floor, and the
 * NaN-only fault rule.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import * as tally from '../index.js';
import { specFor, msgFrom } from './test-helpers.js';

const feed = function ( fields, values, stats ) {
    const state = tally.init( specFor( fields, stats ) );
    tally.update( state, msgFrom( fields, values ) );
    return state;
};

describe( 'tally — update (hot path)', function () {

    it( 'counts a mixed set: any true, not all, count of the true flags', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ true, false, true ] );
        expect( s.count ).to.equal( 2 );
        expect( s.any ).to.equal( true );
        expect( s.all ).to.equal( false );
    } );

    it( 'reports all-true', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ true, true, true ] );
        expect( s.count ).to.equal( 3 );
        expect( s.any ).to.equal( true );
        expect( s.all ).to.equal( true );
    } );

    it( 'reports all-false', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ false, false, false ] );
        expect( s.count ).to.equal( 0 );
        expect( s.any ).to.equal( false );
        expect( s.all ).to.equal( false );
    } );

    it( 'reads numeric 1 / 0 flags by truthiness', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ 1, 0, 1 ] );
        expect( s.count ).to.equal( 2 );
        expect( s.any ).to.equal( true );
        expect( s.all ).to.equal( false );
    } );

    it( 'reads a non-empty string as truthy and an empty string as falsy', function () {
        const s = feed( [ 'a', 'b' ], [ 'yes', '' ] );
        expect( s.count ).to.equal( 1 );
        expect( s.any ).to.equal( true );
        expect( s.all ).to.equal( false );
    } );

    it( 'treats null as not-true with no fault', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ true, null, true ] );
        expect( s.inputValidationFailed ).to.equal( false );
        expect( s.count ).to.equal( 2 );
        expect( s.all ).to.equal( false );
    } );

    it( 'treats a missing field (undefined) as not-true with no fault', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ true, undefined, true ] );
        expect( s.inputValidationFailed ).to.equal( false );
        expect( s.count ).to.equal( 2 );
        expect( s.all ).to.equal( false );
    } );

    it( 'treats a field absent from the message as not-true with no fault', function () {
        const state = tally.init( specFor( [ 'a', 'b', 'c' ] ) );
        const msg = Object.create( null );
        msg.a = true;
        msg.c = true;        // b is never set
        tally.update( state, msg );
        expect( state.inputValidationFailed ).to.equal( false );
        expect( state.count ).to.equal( 2 );
        expect( state.all ).to.equal( false );
    } );

    it( 'is meaningful over a single flag (N = 1)', function () {
        const onTrue = feed( [ 'a' ], [ true ] );
        expect( onTrue.count ).to.equal( 1 );
        expect( onTrue.any ).to.equal( true );
        expect( onTrue.all ).to.equal( true );

        const onFalse = feed( [ 'a' ], [ false ] );
        expect( onFalse.count ).to.equal( 0 );
        expect( onFalse.any ).to.equal( false );
        expect( onFalse.all ).to.equal( false );
    } );

    it( 'flags the tick invalid on a NaN flag', function () {
        const s = feed( [ 'a', 'b', 'c' ], [ true, NaN, false ] );
        expect( s.inputValidationFailed ).to.equal( true );
    } );

    it( 'clears the invalid flag on the next good tick', function () {
        const fields = [ 'a', 'b', 'c' ];
        const state = tally.init( specFor( fields ) );
        tally.update( state, msgFrom( fields, [ true, NaN, false ] ) );
        expect( state.inputValidationFailed ).to.equal( true );
        tally.update( state, msgFrom( fields, [ true, true, true ] ) );
        expect( state.inputValidationFailed ).to.equal( false );
        expect( state.count ).to.equal( 3 );
        expect( state.all ).to.equal( true );
    } );
} );

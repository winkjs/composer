/**
 * @fileoverview init / validation tests for the unbalance node. Covers the
 * resolved state shape, the defensive copy of the field list, the needDev
 * short-circuit flag, and every spec the schema must reject.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import * as ub from '../index.js';
import { specFor } from './test-helpers.js';

describe( 'unbalance — init / validation', function () {

    it( 'initializes standard flags and resolved configuration', function () {
        const state = ub.init( specFor( [ 'a', 'b', 'c' ] ) );
        expect( state.inputValidationFailed ).to.equal( false );
        expect( state.disable ).to.equal( false );
        expect( state.pause ).to.equal( false );
        expect( state.n ).to.equal( 3 );
        expect( state.fields ).to.deep.equal( [ 'a', 'b', 'c' ] );
        expect( state.nodeType ).to.equal( 'Unbalance' );
    } );

    it( 'copies the field list so later spec mutation cannot reach state', function () {
        const fields = [ 'a', 'b' ];
        const state = ub.init( specFor( fields ) );
        fields[ 0 ] = 'mutated';
        expect( state.fields[ 0 ] ).to.equal( 'a' );
    } );

    it( 'sets needDev true when a deviation stat is requested', function () {
        const withUnbalance = ub.init( specFor( [ 'a', 'b' ], { unbalance: { storeAs: 'u' } } ) );
        const withWorst = ub.init( specFor( [ 'a', 'b' ], { worstIndex: { storeAs: 'w' } } ) );
        expect( withUnbalance.needDev ).to.equal( true );
        expect( withWorst.needDev ).to.equal( true );
    } );

    it( 'sets needDev false when only spread stats are requested', function () {
        const state = ub.init( specFor( [ 'a', 'b' ], {
            mean: { storeAs: 'm' },
            range: { storeAs: 'r' }
        } ) );
        expect( state.needDev ).to.equal( false );
    } );

    it( 'rejects fewer than two fields', function () {
        expect( () => ub.init( specFor( [ 'a' ] ) ) ).to.throw();
    } );

    it( 'rejects duplicate field names', function () {
        expect( () => ub.init( specFor( [ 'a', 'a' ] ) ) ).to.throw();
    } );

    it( 'rejects a field name containing spaces', function () {
        expect( () => ub.init( specFor( [ 'a b', 'c' ] ) ) ).to.throw();
    } );

    it( 'rejects an empty stats object', function () {
        expect( () => ub.init( specFor( [ 'a', 'b' ], {} ) ) ).to.throw();
    } );

    it( 'rejects an unknown stat name', function () {
        expect( () => ub.init( specFor( [ 'a', 'b' ], { bogus: { storeAs: 'x' } } ) ) ).to.throw();
    } );

    it( 'rejects a stat missing storeAs', function () {
        expect( () => ub.init( specFor( [ 'a', 'b' ], { mean: {} } ) ) ).to.throw();
    } );

    it( 'defaults to blank mode: skipOnNaN false, minPresent equal to the width', function () {
        const state = ub.init( specFor( [ 'a', 'b', 'c' ] ) );
        expect( state.skipOnNaN ).to.equal( false );
        expect( state.minPresent ).to.equal( 3 );
    } );

    it( 'in skip mode defaults minPresent to two', function () {
        const state = ub.init( specFor( [ 'a', 'b', 'c' ], undefined, { skipOnNaN: true } ) );
        expect( state.skipOnNaN ).to.equal( true );
        expect( state.minPresent ).to.equal( 2 );
    } );

    it( 'in skip mode honours an explicit minPresent', function () {
        const state = ub.init( specFor( [ 'a', 'b', 'c', 'd' ], undefined, { skipOnNaN: true, minPresent: 3 } ) );
        expect( state.minPresent ).to.equal( 3 );
    } );

    it( 'initializes presentCount to zero', function () {
        const state = ub.init( specFor( [ 'a', 'b', 'c' ] ) );
        expect( state.presentCount ).to.equal( 0 );
    } );

    it( 'rejects minPresent set without skipOnNaN', function () {
        expect( () => ub.init( specFor( [ 'a', 'b', 'c' ], undefined, { minPresent: 2 } ) ) ).to.throw();
    } );

    it( 'rejects minPresent greater than the number of fields', function () {
        expect( () => ub.init( specFor( [ 'a', 'b', 'c' ], undefined, { skipOnNaN: true, minPresent: 4 } ) ) ).to.throw();
    } );

    it( 'rejects minPresent below the floor of two', function () {
        expect( () => ub.init( specFor( [ 'a', 'b', 'c' ], undefined, { skipOnNaN: true, minPresent: 1 } ) ) ).to.throw();
    } );

    it( 'rejects a non-boolean skipOnNaN', function () {
        expect( () => ub.init( specFor( [ 'a', 'b', 'c' ], undefined, { skipOnNaN: 'yes' } ) ) ).to.throw();
    } );
} );

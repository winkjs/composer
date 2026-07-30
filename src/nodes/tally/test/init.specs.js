/**
 * @fileoverview init / validation tests for the tally node. Covers the resolved
 * state shape, the resting output values, the defensive copy of the field list,
 * the single-field floor (minItems: 1), and every spec the schema must reject.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import * as tally from '../index.js';
import { specFor } from './test-helpers.js';

describe( 'tally — init / validation', function () {

    it( 'initializes standard flags and resolved configuration', function () {
        const state = tally.init( specFor( [ 'a', 'b', 'c' ] ) );
        expect( state.inputValidationFailed ).to.equal( false );
        expect( state.disable ).to.equal( false );
        expect( state.pause ).to.equal( false );
        expect( state.n ).to.equal( 3 );
        expect( state.fields ).to.deep.equal( [ 'a', 'b', 'c' ] );
        expect( state.nodeType ).to.equal( 'Tally' );
    } );

    it( 'initializes the computed outputs to their resting values', function () {
        const state = tally.init( specFor( [ 'a', 'b' ] ) );
        expect( state.any ).to.equal( false );
        expect( state.all ).to.equal( false );
        expect( state.count ).to.equal( 0 );
    } );

    it( 'copies the field list so later spec mutation cannot reach state', function () {
        const fields = [ 'a', 'b' ];
        const state = tally.init( specFor( fields ) );
        fields[ 0 ] = 'mutated';
        expect( state.fields[ 0 ] ).to.equal( 'a' );
    } );

    it( 'accepts a single field (minItems: 1)', function () {
        const state = tally.init( specFor( [ 'a' ] ) );
        expect( state.n ).to.equal( 1 );
        expect( state.fields ).to.deep.equal( [ 'a' ] );
    } );

    it( 'rejects an empty field list', function () {
        expect( () => tally.init( specFor( [] ) ) ).to.throw();
    } );

    it( 'rejects duplicate field names', function () {
        expect( () => tally.init( specFor( [ 'a', 'a' ] ) ) ).to.throw();
    } );

    it( 'rejects a field name containing spaces', function () {
        expect( () => tally.init( specFor( [ 'a b', 'c' ] ) ) ).to.throw();
    } );

    it( 'rejects an empty stats object', function () {
        expect( () => tally.init( specFor( [ 'a', 'b' ], {} ) ) ).to.throw();
    } );

    it( 'rejects an unknown stat name', function () {
        expect( () => tally.init( specFor( [ 'a', 'b' ], { bogus: { storeAs: 'x' } } ) ) ).to.throw();
    } );

    it( 'rejects a stat missing storeAs', function () {
        expect( () => tally.init( specFor( [ 'a', 'b' ], { any: {} } ) ) ).to.throw();
    } );
} );

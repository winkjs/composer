/**
 * @fileoverview Tests for resolvePickByField - the build-time resolver that replaces
 * pickByField markers with the current fan field's value. Mirrors the groupBy
 * resolver's pass-through behaviour; differs only at the leaf.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { resolvePickByField } from '../resolve-pick-by-field.js';
import { pickByField, lookupByField } from '../../core/tunable/helpers.js';

describe( 'resolvePickByField', function () {

    describe( 'pickByField resolution', function () {

        it( 'resolves a marker to the current field value', function () {
            const opt = pickByField( { scb1: 0.8, scb2: 0.6 } );
            expect( resolvePickByField( opt, 'scb1' ) ).to.equal( 0.8 );
            expect( resolvePickByField( opt, 'scb2' ) ).to.equal( 0.6 );
        } );

        it( 'resolves a marker nested inside an options object', function () {
            const options = { threshold: pickByField( { a: 1, b: 2 } ), mode: 'above' };
            const resolved = resolvePickByField( options, 'b' );
            expect( resolved ).to.deep.equal( { threshold: 2, mode: 'above' } );
        } );

        it( 'resolves a marker nested inside an array', function () {
            const value = [ pickByField( { a: 10, b: 20 } ), 'fixed' ];
            expect( resolvePickByField( value, 'a' ) ).to.deep.equal( [ 10, 'fixed' ] );
        } );

        it( 'returns a resolved object value as-is, without re-walking it', function () {
            // The field-keyed object must reach the node's own resolveNestedObject
            // intact - reference equality proves it was not rebuilt.
            const range = { min: 0, max: 10 };
            const opt = pickByField( { scb1: range } );
            expect( resolvePickByField( opt, 'scb1' ) ).to.equal( range );
        } );

        it( 'resolves a present key whose value is undefined (hasOwnProperty, not falsiness)', function () {
            const opt = pickByField( { scb1: undefined } );
            expect( resolvePickByField( opt, 'scb1' ) ).to.equal( undefined );
        } );

        it( 'throws a clear build error for a missing key', function () {
            const opt = pickByField( { scb1: 0.8 } );
            expect( () => resolvePickByField( opt, 'scb9' ) )
                .to.throw( 'pickByField has no entry for field \'scb9\'' );
        } );

        it( 'lists the available keys in the error message', function () {
            const opt = pickByField( { scb1: 0.8, scb2: 0.6 } );
            expect( () => resolvePickByField( opt, 'scb9' ) ).to.throw( 'scb1, scb2' );
        } );

    } );

    describe( 'pass-through (mirrors the groupBy resolver)', function () {

        it( 'preserves a different tunable (lookupByField) for runtime', function () {
            const tun = lookupByField( 'mode', { idle: 1 }, 0 );
            expect( resolvePickByField( tun, 'scb1' ) ).to.equal( tun );
        } );

        it( 'preserves a plain predicate function for runtime', function () {
            const pred = ( msg ) => ( msg.x > 0 );
            expect( resolvePickByField( pred, 'scb1' ) ).to.equal( pred );
        } );

        it( 'passes number, string and boolean primitives through unchanged', function () {
            expect( resolvePickByField( 42, 'scb1' ) ).to.equal( 42 );
            expect( resolvePickByField( 'text', 'scb1' ) ).to.equal( 'text' );
            expect( resolvePickByField( true, 'scb1' ) ).to.equal( true );
        } );

        it( 'passes null and undefined through unchanged', function () {
            expect( resolvePickByField( null, 'scb1' ) ).to.equal( null );
            expect( resolvePickByField( undefined, 'scb1' ) ).to.equal( undefined );
        } );

        it( 'recurses arrays and objects with no markers, leaving values intact', function () {
            const value = { a: [ 1, 2 ], b: { c: 'x' } };
            expect( resolvePickByField( value, 'scb1' ) ).to.deep.equal( { a: [ 1, 2 ], b: { c: 'x' } } );
        } );

        it( 'resolves markers mixed with other tunables in one options object', function () {
            const tun = lookupByField( 'mode', { idle: 1 }, 0 );
            const options = { pick: pickByField( { s: 5 } ), keep: tun, n: 3 };
            const resolved = resolvePickByField( options, 's' );
            expect( resolved.pick ).to.equal( 5 );
            expect( resolved.keep ).to.equal( tun );
            expect( resolved.n ).to.equal( 3 );
        } );

    } );

} );

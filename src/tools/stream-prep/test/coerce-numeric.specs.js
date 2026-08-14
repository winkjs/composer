// test/coerce-numeric.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { coerceCell, coerceNumeric } from '../coerce-numeric.js';

describe( 'coerceNumeric', function () {

    // ── coerceCell — the per-cell primitive ──────────────────────

    describe( 'coerceCell', function () {

        it( 'passes numbers through, including NaN', function () {
            expect( coerceCell( 42.5 ) ).to.equal( 42.5 );
            expect( coerceCell( 0 ) ).to.equal( 0 );
            expect( coerceCell( -3.4e38 ) ).to.equal( -3.4e38 );
            expect( Number.isNaN( coerceCell( NaN ) ) ).to.equal( true );
        } );

        it( 'maps no-value cells to NaN, never 0', function () {
            expect( Number.isNaN( coerceCell( '' ) ) ).to.equal( true );
            expect( Number.isNaN( coerceCell( null ) ) ).to.equal( true );
            expect( Number.isNaN( coerceCell( undefined ) ) ).to.equal( true );
        } );

        it( 'parses numeric strings and booleans', function () {
            expect( coerceCell( '42.5' ) ).to.equal( 42.5 );
            expect( coerceCell( '-7' ) ).to.equal( -7 );
            expect( coerceCell( true ) ).to.equal( 1 );
            expect( coerceCell( false ) ).to.equal( 0 );
        } );

        it( 'maps unparseable values to NaN', function () {
            expect( Number.isNaN( coerceCell( 'abc' ) ) ).to.equal( true );
            expect( Number.isNaN( coerceCell( {} ) ) ).to.equal( true );
        } );

        it( 'pins the documented whitespace limitation: "   " coerces to 0', function () {
            // Matches Number's own behaviour; detecting it would cost a
            // per-cell allocation. Documented in the module header.
            expect( coerceCell( '   ' ) ).to.equal( 0 );
        } );

    } );

    // ── init validation ──────────────────────────────────────────

    describe( 'init validation', function () {

        it( 'throws on a non-array or empty fields list', function () {
            expect( () => coerceNumeric() ).to.throw( 'winkComposer/coerceNumeric: fields must be a non-empty array.' );
            expect( () => coerceNumeric( 'tempC' ) ).to.throw( 'fields must be a non-empty array' );
            expect( () => coerceNumeric( [] ) ).to.throw( 'fields must be a non-empty array' );
        } );

        it( 'throws on a non-string or empty field name', function () {
            expect( () => coerceNumeric( [ 'a', 7 ] ) ).to.throw( 'every field must be a non-empty string' );
            expect( () => coerceNumeric( [ '' ] ) ).to.throw( 'every field must be a non-empty string' );
        } );

        it( 'throws on an invalid sentinelAbs', function () {
            expect( () => coerceNumeric( [ 'a' ], { sentinelAbs: 0 } ) ).to.throw( 'sentinelAbs must be a positive number' );
            expect( () => coerceNumeric( [ 'a' ], { sentinelAbs: -1 } ) ).to.throw( 'sentinelAbs must be a positive number' );
            expect( () => coerceNumeric( [ 'a' ], { sentinelAbs: NaN } ) ).to.throw( 'sentinelAbs must be a positive number' );
            expect( () => coerceNumeric( [ 'a' ], { sentinelAbs: '1e30' } ) ).to.throw( 'sentinelAbs must be a positive number' );
        } );

    } );

    // ── transform behavior ───────────────────────────────────────

    describe( 'transform', function () {

        it( 'mutates in place and returns the same reference', function () {
            const transform = coerceNumeric( [ 'tempC' ] );
            const row = { tempC: '42.5', other: 'keep' };
            const out = transform( row );
            expect( out === row ).to.equal( true );
            expect( row.tempC ).to.equal( 42.5 );
        } );

        it( 'coerces every declared field and only those', function () {
            const transform = coerceNumeric( [ 'a', 'b' ] );
            const row = { a: '', b: '7', c: '9' };
            transform( row );
            expect( Number.isNaN( row.a ) ).to.equal( true );
            expect( row.b ).to.equal( 7 );
            expect( row.c ).to.equal( '9' );
        } );

        it( 'maps a missing declared field to NaN', function () {
            const transform = coerceNumeric( [ 'a' ] );
            const row = {};
            transform( row );
            expect( Number.isNaN( row.a ) ).to.equal( true );
        } );

        it( 'maps non-finite values to NaN even without sentinelAbs', function () {
            const transform = coerceNumeric( [ 'a' ] );
            expect( Number.isNaN( transform( { a: Infinity } ).a ) ).to.equal( true );
            expect( Number.isNaN( transform( { a: '-Infinity' } ).a ) ).to.equal( true );
        } );

        it( 'applies the sentinelAbs magnitude cut at-or-above, both signs', function () {
            const transform = coerceNumeric( [ 'a' ], { sentinelAbs: 1e30 } );
            expect( Number.isNaN( transform( { a: 3.4e38 } ).a ) ).to.equal( true );
            expect( Number.isNaN( transform( { a: -3.4e38 } ).a ) ).to.equal( true );
            expect( Number.isNaN( transform( { a: 1e30 } ).a ) ).to.equal( true );
            expect( transform( { a: 0.999e30 } ).a ).to.equal( 0.999e30 );
        } );

        it( 'is immune to caller mutation of the fields array after init', function () {
            const fields = [ 'a' ];
            const transform = coerceNumeric( fields );
            fields.push( 'b' );
            const row = { a: '1', b: '2' };
            transform( row );
            expect( row.a ).to.equal( 1 );
            expect( row.b ).to.equal( '2' );
        } );

    } );

} );

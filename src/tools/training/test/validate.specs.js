// test/validate.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { validateMatrix, validateBinaryLabels, validateBinaryArray } from '../validate.js';

describe( 'training/validate', function () {

    // ── validateMatrix ─────────────────────────────────────────────

    describe( 'validateMatrix', function () {

        it( 'returns dimensions for a valid matrix', function () {
            const X = [ [ 1, 2 ], [ 3, 4 ], [ 5, 6 ] ];
            const dims = validateMatrix( X, 'test' );
            expect( dims ).to.deep.equal( { n: 3, p: 2 } );
        } );

        it( 'accepts single-row matrix', function () {
            const dims = validateMatrix( [ [ 10, 20, 30 ] ], 'test' );
            expect( dims ).to.deep.equal( { n: 1, p: 3 } );
        } );

        it( 'accepts single-column matrix', function () {
            const dims = validateMatrix( [ [ 1 ], [ 2 ] ], 'test' );
            expect( dims ).to.deep.equal( { n: 2, p: 1 } );
        } );

        it( 'throws on non-array input', function () {
            expect( () => validateMatrix( 'not an array', 'test' ) )
                .to.throw( 'test: X must be a non-empty array' );
        } );

        it( 'throws on null input', function () {
            expect( () => validateMatrix( null, 'test' ) )
                .to.throw( 'test: X must be a non-empty array' );
        } );

        it( 'throws on empty array', function () {
            expect( () => validateMatrix( [], 'test' ) )
                .to.throw( 'test: X must be a non-empty array' );
        } );

        it( 'throws on empty rows', function () {
            expect( () => validateMatrix( [ [] ], 'test' ) )
                .to.throw( 'test: rows must have at least one feature' );
        } );

        it( 'throws on ragged rows', function () {
            expect( () => validateMatrix( [ [ 1, 2 ], [ 3 ] ], 'test' ) )
                .to.throw( 'test: row 1 has length 1, expected 2' );
        } );

        it( 'throws when a row is not an array', function () {
            expect( () => validateMatrix( [ [ 1, 2 ], 'bad' ], 'test' ) )
                .to.throw( 'test: row 1 has length N/A' );
        } );

        it( 'throws on NaN value', function () {
            expect( () => validateMatrix( [ [ 1, NaN ] ], 'test' ) )
                .to.throw( 'test: non-finite value at row 0, column 1' );
        } );

        it( 'throws on Infinity value', function () {
            expect( () => validateMatrix( [ [ Infinity, 1 ] ], 'test' ) )
                .to.throw( 'test: non-finite value at row 0, column 0' );
        } );

        it( 'throws on -Infinity value', function () {
            expect( () => validateMatrix( [ [ 1, -Infinity ] ], 'test' ) )
                .to.throw( 'test: non-finite value at row 0, column 1' );
        } );

        it( 'throws on undefined value', function () {
            expect( () => validateMatrix( [ [ 1, undefined ] ], 'test' ) )
                .to.throw( 'non-finite value' );
        } );

        it( 'throws on string value in matrix', function () {
            expect( () => validateMatrix( [ [ 1, 'two' ] ], 'test' ) )
                .to.throw( 'non-finite value' );
        } );

        it( 'includes caller name in error message', function () {
            expect( () => validateMatrix( [], 'computeStandardParams' ) )
                .to.throw( 'computeStandardParams' );
        } );
    } );

    // ── validateBinaryLabels ───────────────────────────────────────

    describe( 'validateBinaryLabels', function () {

        it( 'accepts valid binary labels', function () {
            expect( () => validateBinaryLabels( [ 0, 1, 0, 1, 1 ], 5, 'test' ) )
                .to.not.throw();
        } );

        it( 'accepts all-zero labels', function () {
            expect( () => validateBinaryLabels( [ 0, 0, 0 ], 3, 'test' ) )
                .to.not.throw();
        } );

        it( 'accepts all-one labels', function () {
            expect( () => validateBinaryLabels( [ 1, 1, 1 ], 3, 'test' ) )
                .to.not.throw();
        } );

        it( 'throws on non-array input', function () {
            expect( () => validateBinaryLabels( 'not', 3, 'test' ) )
                .to.throw( 'test: y must be an array with length 3' );
        } );

        it( 'throws on length mismatch', function () {
            expect( () => validateBinaryLabels( [ 0, 1 ], 3, 'test' ) )
                .to.throw( 'test: y must be an array with length 3, got 2' );
        } );

        it( 'throws on value 2', function () {
            expect( () => validateBinaryLabels( [ 0, 2, 1 ], 3, 'test' ) )
                .to.throw( 'test: y[1] = 2, expected 0 or 1' );
        } );

        it( 'throws on value -1', function () {
            expect( () => validateBinaryLabels( [ -1, 0 ], 2, 'test' ) )
                .to.throw( 'test: y[0] = -1, expected 0 or 1' );
        } );

        it( 'throws on fractional value', function () {
            expect( () => validateBinaryLabels( [ 0, 0.5 ], 2, 'test' ) )
                .to.throw( 'test: y[1] = 0.5, expected 0 or 1' );
        } );

        it( 'throws on boolean true (strict equality)', function () {
            expect( () => validateBinaryLabels( [ true, 0 ], 2, 'test' ) )
                .to.throw( 'test: y[0] = true, expected 0 or 1' );
        } );

        it( 'includes caller name in error message', function () {
            expect( () => validateBinaryLabels( 'bad', 3, 'train' ) )
                .to.throw( 'train' );
        } );
    } );

    // ── validateBinaryArray ────────────────────────────────────────

    describe( 'validateBinaryArray', function () {

        it( 'accepts valid binary array', function () {
            expect( () => validateBinaryArray( [ 0, 1, 1, 0 ], 'predictions', 'test' ) )
                .to.not.throw();
        } );

        it( 'accepts Uint8Array with binary values', function () {
            expect( () => validateBinaryArray( new Uint8Array( [ 0, 1, 0 ] ), 'predictions', 'test' ) )
                .to.not.throw();
        } );

        it( 'accepts empty array', function () {
            expect( () => validateBinaryArray( [], 'predictions', 'test' ) )
                .to.not.throw();
        } );

        it( 'throws on value 2', function () {
            expect( () => validateBinaryArray( [ 0, 2 ], 'predictions', 'test' ) )
                .to.throw( 'test: predictions[1] = 2, expected 0 or 1' );
        } );

        it( 'throws on fractional value', function () {
            expect( () => validateBinaryArray( [ 0.7, 1 ], 'labels', 'cm' ) )
                .to.throw( 'cm: labels[0] = 0.7, expected 0 or 1' );
        } );

        it( 'throws on negative value', function () {
            expect( () => validateBinaryArray( [ -1, 0 ], 'predictions', 'test' ) )
                .to.throw( 'test: predictions[0] = -1, expected 0 or 1' );
        } );

        it( 'includes parameter name in error message', function () {
            expect( () => validateBinaryArray( [ 3 ], 'myParam', 'caller' ) )
                .to.throw( 'caller: myParam[0] = 3' );
        } );
    } );
} );

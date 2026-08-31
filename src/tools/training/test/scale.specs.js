// test/scale.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    computeStandardParams,
    computeMinMaxParams,
    computeRobustParams,
    scale,
    standardize
} from '../scale.js';

describe( 'scale', function () {

    // ── computeStandardParams (Welford) ─────────────────────────────

    describe( 'computeStandardParams', function () {

        it( 'computes correct mean and std for known data', function () {
            // Feature 0: [2, 4, 6, 8]  → mean=5, std=√5 ≈ 2.2361
            // Feature 1: [1, 1, 1, 1]  → mean=1, std=0 → clamped to 1
            const X = [
                [ 2, 1 ],
                [ 4, 1 ],
                [ 6, 1 ],
                [ 8, 1 ]
            ];

            const params = computeStandardParams( X );

            expect( params.method ).to.equal( 'standard' );
            expect( params.mean ).to.be.instanceOf( Float64Array );
            expect( params.std ).to.be.instanceOf( Float64Array );
            expect( params.mean[ 0 ] ).to.equal( 5 );
            expect( params.mean[ 1 ] ).to.equal( 1 );
            expect( params.std[ 0 ] ).to.be.closeTo( Math.sqrt( 5 ), 1e-10 );
            // Zero-variance: std clamped to 1, isConstant flagged.
            expect( params.std[ 1 ] ).to.equal( 1 );
            expect( params.isConstant[ 0 ] ).to.equal( 0 );
            expect( params.isConstant[ 1 ] ).to.equal( 1 );
        } );

        it( 'returns Float64Arrays and Uint8Array', function () {
            const params = computeStandardParams( [ [ 1, 2 ], [ 3, 4 ] ] );
            expect( params.mean ).to.be.instanceOf( Float64Array );
            expect( params.std ).to.be.instanceOf( Float64Array );
            expect( params.isConstant ).to.be.instanceOf( Uint8Array );
        } );

        it( 'handles single-sample input', function () {
            const params = computeStandardParams( [ [ 5, 10 ] ] );
            expect( params.mean[ 0 ] ).to.equal( 5 );
            expect( params.mean[ 1 ] ).to.equal( 10 );
            // Single sample → std = 0 → clamped to 1.
            expect( params.std[ 0 ] ).to.equal( 1 );
            expect( params.std[ 1 ] ).to.equal( 1 );
            expect( params.isConstant[ 0 ] ).to.equal( 1 );
        } );

        it( 'handles single-feature input', function () {
            const params = computeStandardParams( [ [ 10 ], [ 20 ], [ 30 ] ] );
            expect( params.mean[ 0 ] ).to.equal( 20 );
            // std = sqrt( (100+0+100)/3 ) = sqrt(200/3)
            expect( params.std[ 0 ] ).to.be.closeTo( Math.sqrt( 200 / 3 ), 1e-10 );
        } );

        it( 'Welford accuracy: near-cancellation data', function () {
            // Classic catastrophic cancellation test case.
            // Two-pass: sum = 3e8+6, mean = 1e8+2 — correct.
            // Naive one-pass would lose precision in (Σx² - n×mean²).
            // Welford remains accurate because it accumulates deviations.
            const X = [ [ 1e8 + 1 ], [ 1e8 + 2 ], [ 1e8 + 3 ] ];
            const params = computeStandardParams( X );

            expect( params.mean[ 0 ] ).to.be.closeTo( 1e8 + 2, 1e-6 );
            // Population std of [1,2,3] around mean 2 = sqrt(2/3) ≈ 0.8165
            expect( params.std[ 0 ] ).to.be.closeTo( Math.sqrt( 2 / 3 ), 1e-10 );
        } );

        it( 'throws on empty array', function () {
            expect( () => computeStandardParams( [] ) ).to.throw( 'non-empty' );
        } );

        it( 'throws on non-array', function () {
            expect( () => computeStandardParams( 'bad' ) ).to.throw( 'non-empty' );
        } );

        it( 'throws on NaN in matrix', function () {
            expect( () => computeStandardParams( [ [ 1, NaN ] ] ) )
                .to.throw( 'non-finite' );
        } );

        it( 'throws on ragged rows', function () {
            expect( () => computeStandardParams( [ [ 1, 2 ], [ 3 ] ] ) )
                .to.throw( 'row 1' );
        } );
    } );

    // ── computeMinMaxParams ─────────────────────────────────────────

    describe( 'computeMinMaxParams', function () {

        it( 'computes correct min and range', function () {
            const X = [
                [ 2, 10 ],
                [ 8, 30 ],
                [ 4, 20 ]
            ];
            const params = computeMinMaxParams( X );

            expect( params.method ).to.equal( 'minMax' );
            expect( params.min[ 0 ] ).to.equal( 2 );
            expect( params.min[ 1 ] ).to.equal( 10 );
            expect( params.range[ 0 ] ).to.equal( 6 );  // 8 - 2
            expect( params.range[ 1 ] ).to.equal( 20 ); // 30 - 10
        } );

        it( 'finds a minimum that arrives after the first row', function () {
            // The fixture above keeps every column minimum in row one, so
            // the min-update path never ran. Here column 0 dips in row two
            // while column 1 peaks — both update paths in one matrix.
            const X = [
                [ 5, 1 ],
                [ 3, 4 ]
            ];
            const params = computeMinMaxParams( X );

            expect( params.min[ 0 ] ).to.equal( 3 );
            expect( params.min[ 1 ] ).to.equal( 1 );
            expect( params.range[ 0 ] ).to.equal( 2 ); // 5 - 3
            expect( params.range[ 1 ] ).to.equal( 3 ); // 4 - 1
        } );

        it( 'returns correct types', function () {
            const params = computeMinMaxParams( [ [ 1 ], [ 2 ] ] );
            expect( params.min ).to.be.instanceOf( Float64Array );
            expect( params.range ).to.be.instanceOf( Float64Array );
            expect( params.isConstant ).to.be.instanceOf( Uint8Array );
        } );

        it( 'flags constant features', function () {
            const X = [ [ 5, 1 ], [ 5, 2 ], [ 5, 3 ] ];
            const params = computeMinMaxParams( X );
            expect( params.isConstant[ 0 ] ).to.equal( 1 );
            expect( params.isConstant[ 1 ] ).to.equal( 0 );
            expect( params.range[ 0 ] ).to.equal( 1 ); // clamped
        } );

        it( 'handles single-sample input', function () {
            const params = computeMinMaxParams( [ [ 5, 10 ] ] );
            expect( params.min[ 0 ] ).to.equal( 5 );
            expect( params.range[ 0 ] ).to.equal( 1 ); // clamped
            expect( params.isConstant[ 0 ] ).to.equal( 1 );
        } );

        it( 'handles negative values', function () {
            const X = [ [ -10 ], [ -5 ], [ 5 ] ];
            const params = computeMinMaxParams( X );
            expect( params.min[ 0 ] ).to.equal( -10 );
            expect( params.range[ 0 ] ).to.equal( 15 ); // 5 - (-10)
        } );

        it( 'throws on empty array', function () {
            expect( () => computeMinMaxParams( [] ) ).to.throw( 'non-empty' );
        } );

        it( 'throws on NaN in matrix', function () {
            expect( () => computeMinMaxParams( [ [ NaN ] ] ) )
                .to.throw( 'non-finite' );
        } );
    } );

    // ── computeRobustParams ─────────────────────────────────────────

    describe( 'computeRobustParams', function () {

        it( 'computes correct median and IQR for odd n', function () {
            // [1, 2, 3, 4, 5] sorted, n=5
            // median = percentile(0.50): pos = 0.50 × 4 = 2.0 → sorted[2] = 3
            // Q1 = percentile(0.25): pos = 0.25 × 4 = 1.0 → sorted[1] = 2
            // Q3 = percentile(0.75): pos = 0.75 × 4 = 3.0 → sorted[3] = 4
            // IQR = 4 - 2 = 2
            const X = [ [ 3 ], [ 1 ], [ 5 ], [ 2 ], [ 4 ] ];
            const params = computeRobustParams( X );

            expect( params.method ).to.equal( 'robust' );
            expect( params.median[ 0 ] ).to.equal( 3 );
            expect( params.iqr[ 0 ] ).to.equal( 2 );
        } );

        it( 'computes correct median and IQR for even n', function () {
            // [1, 2, 3, 4] sorted → median = (2+3)/2 = 2.5
            // Q1 = percentile(0.25) on [1,2,3,4]: pos=0.75 → 1*(0.25)+2*(0.75) = 1.75
            // Q3 = percentile(0.75) on [1,2,3,4]: pos=2.25 → 3*(0.75)+4*(0.25) = 3.25
            // IQR = 3.25 - 1.75 = 1.5
            const X = [ [ 4 ], [ 2 ], [ 1 ], [ 3 ] ];
            const params = computeRobustParams( X );

            expect( params.median[ 0 ] ).to.be.closeTo( 2.5, 1e-10 );
            expect( params.iqr[ 0 ] ).to.be.closeTo( 1.5, 1e-10 );
        } );

        it( 'returns correct types', function () {
            const params = computeRobustParams( [ [ 1 ], [ 2 ] ] );
            expect( params.median ).to.be.instanceOf( Float64Array );
            expect( params.iqr ).to.be.instanceOf( Float64Array );
            expect( params.isConstant ).to.be.instanceOf( Uint8Array );
        } );

        it( 'flags constant features', function () {
            const X = [ [ 5, 1 ], [ 5, 3 ], [ 5, 5 ] ];
            const params = computeRobustParams( X );
            expect( params.isConstant[ 0 ] ).to.equal( 1 );
            expect( params.isConstant[ 1 ] ).to.equal( 0 );
            expect( params.iqr[ 0 ] ).to.equal( 1 ); // clamped
        } );

        it( 'handles single-sample input', function () {
            const params = computeRobustParams( [ [ 42 ] ] );
            expect( params.median[ 0 ] ).to.equal( 42 );
            expect( params.iqr[ 0 ] ).to.equal( 1 ); // clamped
            expect( params.isConstant[ 0 ] ).to.equal( 1 );
        } );

        it( 'is resistant to outliers', function () {
            // 9 values near 0, one extreme outlier at 1000.
            const X = [
                [ 1 ], [ 2 ], [ 3 ], [ 4 ], [ 5 ],
                [ 6 ], [ 7 ], [ 8 ], [ 9 ], [ 1000 ]
            ];
            const robust = computeRobustParams( X );
            const standard = computeStandardParams( X );

            // Robust median near 5.5, standard mean near 104.5 — outlier shifts mean heavily.
            expect( robust.median[ 0 ] ).to.be.closeTo( 5.5, 1e-10 );
            expect( standard.mean[ 0 ] ).to.be.greaterThan( 100 );
        } );

        it( 'throws on empty array', function () {
            expect( () => computeRobustParams( [] ) ).to.throw( 'non-empty' );
        } );

        it( 'throws on NaN in matrix', function () {
            expect( () => computeRobustParams( [ [ NaN ] ] ) )
                .to.throw( 'non-finite' );
        } );
    } );

    // ── scale (unified dispatcher) ──────────────────────────────────

    describe( 'scale', function () {

        it( 'standard: produces zero-mean unit-std features', function () {
            const X = [
                [ 2, 10 ],
                [ 4, 20 ],
                [ 6, 30 ],
                [ 8, 40 ]
            ];
            const params = computeStandardParams( X );
            const Xs = scale( X, params );

            expect( Xs ).to.have.lengthOf( 4 );
            expect( Xs[ 0 ] ).to.have.lengthOf( 2 );

            for ( let j = 0; j < 2; j += 1 ) {
                let colMean = 0;
                for ( let i = 0; i < 4; i += 1 ) colMean += Xs[ i ][ j ];
                colMean /= 4;
                expect( colMean ).to.be.closeTo( 0, 1e-10 );
            }

            for ( let j = 0; j < 2; j += 1 ) {
                let colVar = 0;
                for ( let i = 0; i < 4; i += 1 ) colVar += Xs[ i ][ j ] * Xs[ i ][ j ];
                colVar /= 4;
                expect( Math.sqrt( colVar ) ).to.be.closeTo( 1, 1e-10 );
            }
        } );

        it( 'minMax: produces values in [0, 1]', function () {
            const X = [
                [ 2, 10 ],
                [ 4, 20 ],
                [ 6, 30 ],
                [ 8, 40 ]
            ];
            const params = computeMinMaxParams( X );
            const Xs = scale( X, params );

            for ( let i = 0; i < 4; i += 1 ) {
                for ( let j = 0; j < 2; j += 1 ) {
                    expect( Xs[ i ][ j ] ).to.be.at.least( 0 );
                    expect( Xs[ i ][ j ] ).to.be.at.most( 1 );
                }
            }
            // First row should be 0 (min), last row should be 1 (max).
            expect( Xs[ 0 ][ 0 ] ).to.equal( 0 );
            expect( Xs[ 3 ][ 0 ] ).to.equal( 1 );
        } );

        it( 'robust: produces median ≈ 0', function () {
            const X = [
                [ 1 ], [ 2 ], [ 3 ], [ 4 ], [ 5 ],
                [ 6 ], [ 7 ], [ 8 ], [ 9 ]
            ];
            const params = computeRobustParams( X );
            const Xs = scale( X, params );

            // Median of sorted [1..9] = 5. After robust scaling, value 5 → 0.
            expect( Xs[ 4 ][ 0 ] ).to.be.closeTo( 0, 1e-10 );
        } );

        it( 'does not mutate the original matrix', function () {
            const X = [ [ 2, 4 ], [ 6, 8 ] ];
            const copy = X.map( ( r ) => r.slice() );
            const params = computeStandardParams( X );
            scale( X, params );

            expect( X[ 0 ][ 0 ] ).to.equal( copy[ 0 ][ 0 ] );
            expect( X[ 0 ][ 1 ] ).to.equal( copy[ 0 ][ 1 ] );
            expect( X[ 1 ][ 0 ] ).to.equal( copy[ 1 ][ 0 ] );
            expect( X[ 1 ][ 1 ] ).to.equal( copy[ 1 ][ 1 ] );
        } );

        it( 'constant column standardizes to zeros', function () {
            const X = [ [ 1, 5 ], [ 2, 5 ], [ 3, 5 ] ];
            const params = computeStandardParams( X );
            const Xs = scale( X, params );

            for ( let i = 0; i < 3; i += 1 ) {
                expect( Xs[ i ][ 1 ] ).to.equal( 0 );
            }
        } );

        it( 'applies training params to different-sized test set', function () {
            const trainX = [ [ 0, 0 ], [ 10, 10 ] ];
            const params = computeStandardParams( trainX );
            // mean = [5, 5], std = [5, 5]

            const testX = [ [ 5, 5 ], [ 15, 15 ], [ -5, -5 ] ];
            const testXs = scale( testX, params );

            expect( testXs[ 0 ][ 0 ] ).to.be.closeTo( 0, 1e-10 );
            expect( testXs[ 1 ][ 0 ] ).to.be.closeTo( 2, 1e-10 );
            expect( testXs[ 2 ][ 0 ] ).to.be.closeTo( -2, 1e-10 );
        } );

        it( 'throws on unknown method', function () {
            expect( () => scale( [ [ 1 ] ], { method: 'unknown' } ) )
                .to.throw( 'unknown method "unknown"' );
        } );

        it( 'throws on empty array', function () {
            const params = { method: 'standard', mean: new Float64Array( 1 ), std: new Float64Array( [ 1 ] ) };
            expect( () => scale( [], params ) ).to.throw( 'non-empty' );
        } );
    } );

    // ── standardize (backward compat alias) ─────────────────────────

    describe( 'standardize (alias)', function () {

        it( 'is the same function as scale', function () {
            expect( standardize ).to.equal( scale );
        } );

        it( 'works with computeStandardParams output', function () {
            const X = [ [ 1 ], [ 2 ], [ 3 ] ];
            const params = computeStandardParams( X );
            const Xs = standardize( X, params );

            let colMean = 0;
            for ( let i = 0; i < 3; i += 1 ) colMean += Xs[ i ][ 0 ];
            colMean /= 3;
            expect( colMean ).to.be.closeTo( 0, 1e-10 );
        } );
    } );
} );

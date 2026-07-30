// test/logistic.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { sigmoid, train, predict, classify } from '../logistic.js';

describe( 'logistic', function () {

    // ── sigmoid ───────────────────────────────────────────────────

    describe( 'sigmoid', function () {

        it( 'returns 0.5 at z = 0', function () {
            expect( sigmoid( 0 ) ).to.equal( 0.5 );
        } );

        it( 'approaches 1 for large positive z', function () {
            expect( sigmoid( 10 ) ).to.be.closeTo( 1, 1e-4 );
        } );

        it( 'approaches 0 for large negative z', function () {
            expect( sigmoid( -10 ) ).to.be.closeTo( 0, 1e-4 );
        } );

        it( 'never returns exact 1 for z > 500 (clamped below 1)', function () {
            expect( sigmoid( 501 ) ).to.be.closeTo( 1, 1e-14 );
            expect( sigmoid( 501 ) ).to.be.lessThan( 1 );
            expect( sigmoid( 1000 ) ).to.be.lessThan( 1 );
        } );

        it( 'never returns exact 0 for z < -500 (clamped above 0)', function () {
            expect( sigmoid( -501 ) ).to.be.closeTo( 0, 1e-14 );
            expect( sigmoid( -501 ) ).to.be.greaterThan( 0 );
            expect( sigmoid( -1000 ) ).to.be.greaterThan( 0 );
        } );

        it( 'is monotonically increasing', function () {
            const values = [ -100, -10, -1, 0, 1, 10, 100 ];
            for ( let i = 1; i < values.length; i += 1 ) {
                expect( sigmoid( values[ i ] ) ).to.be.greaterThan( sigmoid( values[ i - 1 ] ) );
            }
        } );

        it( 'satisfies σ(z) + σ(-z) = 1', function () {
            const zValues = [ 0.5, 1, 3, 7, 50 ];
            for ( let i = 0; i < zValues.length; i += 1 ) {
                const z = zValues[ i ];
                expect( sigmoid( z ) + sigmoid( -z ) ).to.be.closeTo( 1, 1e-10 );
            }
        } );

        it( 'log(sigmoid(z)) is safe for extreme inputs', function () {
            // Key fix: sigmoid never returns exact 0 or 1,
            // so log never produces -Infinity.
            const logHigh = Math.log( sigmoid( 600 ) );
            const logLow = Math.log( sigmoid( -600 ) );
            expect( Number.isFinite( logHigh ) ).to.equal( true );
            expect( Number.isFinite( logLow ) ).to.equal( true );
        } );
    } );

    // ── train ─────────────────────────────────────────────────────

    describe( 'train', function () {

        it( 'converges on linearly separable data', function () {
            const X = [
                [ -3 ], [ -2 ], [ -1 ], [ -0.5 ],
                [  0.5 ], [  1 ], [  2 ], [  3 ]
            ];
            const y = [ 0, 0, 0, 0, 1, 1, 1, 1 ];

            const model = train( X, y, { maxIter: 2000, lambda: 0 } );

            expect( model.coefficients ).to.be.instanceOf( Float64Array );
            expect( model.coefficients ).to.have.lengthOf( 1 );
            expect( model.coefficients[ 0 ] ).to.be.greaterThan( 0 );
            expect( model.loss ).to.be.lessThan( 0.1 );

            const probs = predict( X, model.coefficients, model.intercept );
            const preds = classify( probs, 0.5 );
            for ( let i = 0; i < y.length; i += 1 ) {
                expect( preds[ i ] ).to.equal( y[ i ] );
            }
        } );

        it( 'handles multi-feature data', function () {
            const X = [
                [ 0, 0, -1 ], [ 1, 1, -1 ],
                [ 0, 1,  1 ], [ 1, 0,  1 ]
            ];
            const y = [ 0, 0, 1, 1 ];

            const model = train( X, y, { maxIter: 3000, lambda: 0 } );

            expect( model.coefficients ).to.have.lengthOf( 3 );
            expect( model.coefficients[ 2 ] ).to.be.greaterThan( 0 );
        } );

        it( 'loss decreases monotonically', function () {
            const X = [
                [ -2 ], [ -1 ], [ 1 ], [ 2 ],
                [ -3 ], [ -1.5 ], [ 1.5 ], [ 3 ]
            ];
            const y = [ 0, 0, 1, 1, 0, 0, 1, 1 ];

            let prevLoss = Infinity;
            const maxIter = 50;
            for ( let step = 1; step <= maxIter; step += 1 ) {
                const model = train( X, y, { maxIter: step, minIter: step, lambda: 0.01, convergenceTol: 0 } );
                expect( model.loss ).to.be.at.most( prevLoss + 1e-10 );
                prevLoss = model.loss;
            }
        } );

        it( 'L2 regularization shrinks coefficients', function () {
            const X = [
                [ -2 ], [ -1 ], [ 1 ], [ 2 ]
            ];
            const y = [ 0, 0, 1, 1 ];

            const noReg = train( X, y, { maxIter: 1000, lambda: 0 } );
            const hiReg = train( X, y, { maxIter: 1000, lambda: 10.0 } );

            // Higher lambda → smaller coefficient magnitude.
            expect( Math.abs( hiReg.coefficients[ 0 ] ) )
                .to.be.lessThan( Math.abs( noReg.coefficients[ 0 ] ) );
        } );

        it( 'class weights shift decision boundary towards minority class', function () {
            const X = [
                [ -4 ], [ -3 ], [ -2 ], [ -1 ], [ 0 ], [ 0.5 ], [ 1 ], [ 1.5 ],
                [ 2 ], [ 3 ]
            ];
            const y = [ 0, 0, 0, 0, 0, 0, 0, 0, 1, 1 ];

            const noWeight = train( X, y, { maxIter: 2000, lambda: 0 } );
            const autoWeight = train( X, y, { maxIter: 2000, lambda: 0, classWeight: 'auto' } );

            expect( autoWeight.intercept ).to.be.greaterThan( noWeight.intercept );
        } );

        it( 'converges early when tolerance is met', function () {
            const X = [ [ -2 ], [ -1 ], [ 1 ], [ 2 ] ];
            const y = [ 0, 0, 1, 1 ];

            const model = train( X, y, { maxIter: 10000, convergenceTol: 1e-4 } );
            expect( model.iterations ).to.be.lessThan( 10000 );
        } );

        it( 'respects minIter before checking convergence', function () {
            const X = [ [ -2 ], [ -1 ], [ 1 ], [ 2 ] ];
            const y = [ 0, 0, 1, 1 ];

            // Very loose tolerance with high minIter — must run at least minIter.
            const model = train( X, y, { maxIter: 100, minIter: 20, convergenceTol: 1.0 } );
            expect( model.iterations ).to.be.at.least( 20 );
        } );

        it( 'returns finite coefficients and loss', function () {
            const X = [ [ 0 ], [ 1 ] ];
            const y = [ 0, 1 ];

            const model = train( X, y, { maxIter: 100 } );
            expect( Number.isFinite( model.loss ) ).to.equal( true );
            expect( Number.isFinite( model.intercept ) ).to.equal( true );
            expect( Number.isFinite( model.coefficients[ 0 ] ) ).to.equal( true );
        } );

        it( 'throws when X is empty', function () {
            expect( () => train( [], [], {} ) ).to.throw( 'non-empty' );
        } );

        it( 'throws when X and y lengths differ', function () {
            expect( () => train( [ [ 1 ] ], [ 0, 1 ], {} ) ).to.throw( 'length' );
        } );

        it( 'throws when auto class weight with single class', function () {
            expect( () => train( [ [ 1 ], [ 2 ] ], [ 0, 0 ], { classWeight: 'auto' } ) )
                .to.throw( 'both classes' );
        } );

        it( 'throws on non-binary labels', function () {
            expect( () => train( [ [ 1 ], [ 2 ] ], [ 0, 2 ] ) )
                .to.throw( 'expected 0 or 1' );
        } );

        it( 'throws on NaN in feature matrix', function () {
            expect( () => train( [ [ NaN ] ], [ 0 ] ) )
                .to.throw( 'non-finite' );
        } );

        it( 'throws on ragged rows', function () {
            expect( () => train( [ [ 1, 2 ], [ 3 ] ], [ 0, 1 ] ) )
                .to.throw( 'row 1' );
        } );

        it( 'regularization is dataset-size-invariant', function () {
            // Same data repeated 10× should produce similar coefficients
            // because lambda is scaled by 1/n.
            const X4 = [ [ -2 ], [ -1 ], [ 1 ], [ 2 ] ];
            const y4 = [ 0, 0, 1, 1 ];

            const X40 = [];
            const y40 = [];
            for ( let r = 0; r < 10; r += 1 ) {
                for ( let i = 0; i < 4; i += 1 ) {
                    X40.push( X4[ i ].slice() );
                    y40.push( y4[ i ] );
                }
            }

            const m4 = train( X4, y4, { maxIter: 2000, lambda: 0.1 } );
            const m40 = train( X40, y40, { maxIter: 2000, lambda: 0.1 } );

            // Coefficients should be similar (within 20%) for same lambda.
            const ratio = Math.abs( m4.coefficients[ 0 ] ) / Math.abs( m40.coefficients[ 0 ] );
            expect( ratio ).to.be.greaterThan( 0.8 );
            expect( ratio ).to.be.lessThan( 1.2 );
        } );
    } );

    // ── predict ───────────────────────────────────────────────────

    describe( 'predict', function () {

        it( 'returns Float64Array of probabilities', function () {
            const X = [ [ 1 ], [ -1 ] ];
            const coefficients = new Float64Array( [ 2 ] );
            const intercept = 0;

            const probs = predict( X, coefficients, intercept );

            expect( probs ).to.be.instanceOf( Float64Array );
            expect( probs ).to.have.lengthOf( 2 );
            expect( probs[ 0 ] ).to.be.greaterThan( 0.5 );
            expect( probs[ 1 ] ).to.be.lessThan( 0.5 );
        } );

        it( 'returns 0.5 when all coefficients and intercept are zero', function () {
            const X = [ [ 10 ], [ -10 ], [ 0 ] ];
            const coefficients = new Float64Array( [ 0 ] );
            const probs = predict( X, coefficients, 0 );

            for ( let i = 0; i < probs.length; i += 1 ) {
                expect( probs[ i ] ).to.equal( 0.5 );
            }
        } );

        it( 'probabilities are in (0, 1)', function () {
            const X = [ [ 5 ], [ -5 ], [ 0 ] ];
            const coefficients = new Float64Array( [ 1 ] );
            const probs = predict( X, coefficients, 0 );

            for ( let i = 0; i < probs.length; i += 1 ) {
                expect( probs[ i ] ).to.be.greaterThan( 0 );
                expect( probs[ i ] ).to.be.lessThan( 1 );
            }
            expect( probs[ 0 ] ).to.be.greaterThan( probs[ 1 ] );
        } );
    } );

    // ── classify ──────────────────────────────────────────────────

    describe( 'classify', function () {

        it( 'thresholds at 0.5 by default', function () {
            const probs = new Float64Array( [ 0.1, 0.4, 0.5, 0.6, 0.9 ] );
            const labels = classify( probs );

            expect( labels ).to.be.instanceOf( Uint8Array );
            expect( Array.from( labels ) ).to.deep.equal( [ 0, 0, 1, 1, 1 ] );
        } );

        it( 'uses custom threshold', function () {
            const probs = new Float64Array( [ 0.1, 0.3, 0.5, 0.7, 0.9 ] );
            const labels = classify( probs, 0.7 );
            expect( Array.from( labels ) ).to.deep.equal( [ 0, 0, 0, 1, 1 ] );
        } );

        it( 'returns all zeros when threshold is 1', function () {
            const probs = new Float64Array( [ 0.1, 0.5, 0.99 ] );
            const labels = classify( probs, 1.0 );
            expect( Array.from( labels ) ).to.deep.equal( [ 0, 0, 0 ] );
        } );

        it( 'returns all ones when threshold is 0', function () {
            const probs = new Float64Array( [ 0.0, 0.01, 0.5 ] );
            const labels = classify( probs, 0 );
            expect( Array.from( labels ) ).to.deep.equal( [ 1, 1, 1 ] );
        } );
    } );
} );

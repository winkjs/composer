// test/metrics.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { confusionMatrix, classificationMetrics, sweepThresholds } from '../metrics.js';

describe( 'metrics', function () {

    // ── confusionMatrix ───────────────────────────────────────────

    describe( 'confusionMatrix', function () {

        it( 'counts all-correct predictions', function () {
            const preds  = [ 1, 1, 0, 0 ];
            const labels = [ 1, 1, 0, 0 ];
            const cm = confusionMatrix( preds, labels );
            expect( cm ).to.deep.equal( { tp: 2, fp: 0, fn: 0, tn: 2 } );
        } );

        it( 'counts all-wrong predictions', function () {
            const preds  = [ 0, 0, 1, 1 ];
            const labels = [ 1, 1, 0, 0 ];
            const cm = confusionMatrix( preds, labels );
            expect( cm ).to.deep.equal( { tp: 0, fp: 2, fn: 2, tn: 0 } );
        } );

        it( 'counts mixed predictions', function () {
            const preds  = [ 1, 0, 1, 0, 1 ];
            const labels = [ 1, 1, 0, 0, 1 ];
            const cm = confusionMatrix( preds, labels );
            expect( cm ).to.deep.equal( { tp: 2, fp: 1, fn: 1, tn: 1 } );
        } );

        it( 'handles all-positive predictions', function () {
            const preds  = [ 1, 1, 1, 1 ];
            const labels = [ 1, 0, 1, 0 ];
            const cm = confusionMatrix( preds, labels );
            expect( cm ).to.deep.equal( { tp: 2, fp: 2, fn: 0, tn: 0 } );
        } );

        it( 'handles all-negative predictions', function () {
            const preds  = [ 0, 0, 0, 0 ];
            const labels = [ 1, 0, 1, 0 ];
            const cm = confusionMatrix( preds, labels );
            expect( cm ).to.deep.equal( { tp: 0, fp: 0, fn: 2, tn: 2 } );
        } );

        it( 'works with typed arrays', function () {
            const preds  = new Uint8Array( [ 1, 0, 1 ] );
            const labels = new Uint8Array( [ 1, 1, 0 ] );
            const cm = confusionMatrix( preds, labels );
            expect( cm ).to.deep.equal( { tp: 1, fp: 1, fn: 1, tn: 0 } );
        } );

        it( 'throws on length mismatch', function () {
            expect( () => confusionMatrix( [ 1, 0 ], [ 1 ] ) ).to.throw( 'same length' );
        } );

        it( 'throws on non-binary predictions', function () {
            expect( () => confusionMatrix( [ 2, 0 ], [ 1, 0 ] ) )
                .to.throw( 'predictions[0] = 2, expected 0 or 1' );
        } );

        it( 'throws on non-binary labels', function () {
            expect( () => confusionMatrix( [ 1, 0 ], [ 0.5, 0 ] ) )
                .to.throw( 'labels[0] = 0.5, expected 0 or 1' );
        } );

        it( 'throws on fractional predictions', function () {
            expect( () => confusionMatrix( [ 0.7, 0.3 ], [ 1, 0 ] ) )
                .to.throw( 'expected 0 or 1' );
        } );
    } );

    // ── classificationMetrics ─────────────────────────────────────

    describe( 'classificationMetrics', function () {

        it( 'computes perfect classifier metrics', function () {
            const cm = { tp: 5, fp: 0, fn: 0, tn: 5 };
            const m = classificationMetrics( cm );
            expect( m.precision ).to.equal( 1 );
            expect( m.recall ).to.equal( 1 );
            expect( m.f1 ).to.equal( 1 );
            expect( m.specificity ).to.equal( 1 );
            expect( m.fpr ).to.equal( 0 );
            expect( m.accuracy ).to.equal( 1 );
        } );

        it( 'computes metrics for typical confusion matrix', function () {
            const cm = { tp: 3, fp: 1, fn: 2, tn: 4 };
            const m = classificationMetrics( cm );
            expect( m.precision ).to.be.closeTo( 3 / 4, 1e-10 );
            expect( m.recall ).to.be.closeTo( 3 / 5, 1e-10 );
            expect( m.f1 ).to.be.closeTo( 2 * ( 3 / 4 ) * ( 3 / 5 ) / ( ( 3 / 4 ) + ( 3 / 5 ) ), 1e-10 );
            expect( m.specificity ).to.be.closeTo( 4 / 5, 1e-10 );
            expect( m.fpr ).to.be.closeTo( 1 / 5, 1e-10 );
            expect( m.accuracy ).to.be.closeTo( 7 / 10, 1e-10 );
        } );

        it( 'handles zero true positives', function () {
            const cm = { tp: 0, fp: 0, fn: 5, tn: 5 };
            const m = classificationMetrics( cm );
            expect( m.precision ).to.equal( 0 );
            expect( m.recall ).to.equal( 0 );
            expect( m.f1 ).to.equal( 0 );
        } );

        it( 'handles zero negatives', function () {
            const cm = { tp: 5, fp: 0, fn: 0, tn: 0 };
            const m = classificationMetrics( cm );
            expect( m.precision ).to.equal( 1 );
            expect( m.recall ).to.equal( 1 );
            expect( m.accuracy ).to.equal( 1 );
        } );

        it( 'handles all-zero confusion matrix', function () {
            const cm = { tp: 0, fp: 0, fn: 0, tn: 0 };
            const m = classificationMetrics( cm );
            expect( m.precision ).to.equal( 0 );
            expect( m.recall ).to.equal( 0 );
            expect( m.f1 ).to.equal( 0 );
            expect( m.accuracy ).to.equal( 0 );
        } );
    } );

    // ── sweepThresholds ───────────────────────────────────────────

    describe( 'sweepThresholds', function () {

        it( 'returns one entry per threshold', function () {
            const probs = new Float64Array( [ 0.2, 0.8 ] );
            const labels = [ 0, 1 ];
            const thresholds = [ 0.1, 0.5, 0.9 ];

            const results = sweepThresholds( probs, labels, thresholds );

            expect( results ).to.have.lengthOf( 3 );
            expect( results[ 0 ].threshold ).to.equal( 0.1 );
            expect( results[ 1 ].threshold ).to.equal( 0.5 );
            expect( results[ 2 ].threshold ).to.equal( 0.9 );
        } );

        it( 'reports recall 0 when the labels hold no positives', function () {
            // All-zero labels: tp + fn = 0, so recall takes its guarded 0
            // instead of dividing by zero. Counts by hand: preds at 0.5
            // are [1, 1, 0] → fp=2, tn=1.
            const probs = new Float64Array( [ 0.9, 0.8, 0.2 ] );
            const labels = [ 0, 0, 0 ];

            const r = sweepThresholds( probs, labels, [ 0.5 ] )[ 0 ];

            expect( r.tp ).to.equal( 0 );
            expect( r.fp ).to.equal( 2 );
            expect( r.fn ).to.equal( 0 );
            expect( r.tn ).to.equal( 1 );
            expect( r.recall ).to.equal( 0 );
            expect( r.precision ).to.equal( 0 );
        } );

        it( 'reports specificity and fpr 0 when the labels hold no negatives', function () {
            // All-one labels: tn + fp = 0, so specificity and fpr take
            // their guarded 0s. Counts by hand: preds at 0.5 are
            // [1, 0, 0] → tp=1, fn=2.
            const probs = new Float64Array( [ 0.9, 0.2, 0.4 ] );
            const labels = [ 1, 1, 1 ];

            const r = sweepThresholds( probs, labels, [ 0.5 ] )[ 0 ];

            expect( r.tp ).to.equal( 1 );
            expect( r.fn ).to.equal( 2 );
            expect( r.tn ).to.equal( 0 );
            expect( r.fp ).to.equal( 0 );
            expect( r.specificity ).to.equal( 0 );
            expect( r.fpr ).to.equal( 0 );
        } );

        it( 'low threshold catches all positives', function () {
            const probs = new Float64Array( [ 0.1, 0.3, 0.7, 0.9 ] );
            const labels = [ 0, 0, 1, 1 ];

            const results = sweepThresholds( probs, labels, [ 0.05 ] );
            expect( results[ 0 ].tp ).to.equal( 2 );
            expect( results[ 0 ].fp ).to.equal( 2 );
            expect( results[ 0 ].fn ).to.equal( 0 );
            expect( results[ 0 ].tn ).to.equal( 0 );
            expect( results[ 0 ].recall ).to.equal( 1 );
        } );

        it( 'high threshold misses all', function () {
            const probs = new Float64Array( [ 0.1, 0.3, 0.7, 0.9 ] );
            const labels = [ 0, 0, 1, 1 ];

            const results = sweepThresholds( probs, labels, [ 0.95 ] );
            expect( results[ 0 ].tp ).to.equal( 0 );
            expect( results[ 0 ].fp ).to.equal( 0 );
            expect( results[ 0 ].recall ).to.equal( 0 );
            expect( results[ 0 ].precision ).to.equal( 0 );
        } );

        it( 'optimal threshold gives perfect classification', function () {
            const probs = new Float64Array( [ 0.1, 0.2, 0.8, 0.9 ] );
            const labels = [ 0, 0, 1, 1 ];

            const results = sweepThresholds( probs, labels, [ 0.5 ] );
            expect( results[ 0 ].tp ).to.equal( 2 );
            expect( results[ 0 ].fp ).to.equal( 0 );
            expect( results[ 0 ].fn ).to.equal( 0 );
            expect( results[ 0 ].tn ).to.equal( 2 );
            expect( results[ 0 ].f1 ).to.equal( 1 );
        } );

        it( 'includes all derived metrics including specificity and fpr', function () {
            const probs = new Float64Array( [ 0.3, 0.7 ] );
            const labels = [ 0, 1 ];
            const results = sweepThresholds( probs, labels, [ 0.5 ] );

            const r = results[ 0 ];
            expect( r ).to.have.all.keys(
                'threshold', 'tp', 'fp', 'fn', 'tn',
                'precision', 'recall', 'f1', 'specificity', 'fpr'
            );
        } );

        it( 'computes correct specificity and fpr', function () {
            // probs: [0.1, 0.3, 0.7, 0.9], labels: [0, 0, 1, 1]
            // At threshold 0.2: preds = [0, 1, 1, 1]
            //   TP=2, FP=1, FN=0, TN=1
            //   specificity = TN/(TN+FP) = 1/2 = 0.5
            //   fpr = FP/(TN+FP) = 1/2 = 0.5
            const probs = new Float64Array( [ 0.1, 0.3, 0.7, 0.9 ] );
            const labels = [ 0, 0, 1, 1 ];
            const results = sweepThresholds( probs, labels, [ 0.2 ] );

            expect( results[ 0 ].specificity ).to.be.closeTo( 0.5, 1e-10 );
            expect( results[ 0 ].fpr ).to.be.closeTo( 0.5, 1e-10 );
        } );

        it( 'throws on length mismatch', function () {
            const probs = new Float64Array( [ 0.5 ] );
            expect( () => sweepThresholds( probs, [ 0, 1 ], [ 0.5 ] ) )
                .to.throw( 'same length' );
        } );

        it( 'throws on non-binary labels', function () {
            const probs = new Float64Array( [ 0.5, 0.5 ] );
            expect( () => sweepThresholds( probs, [ 0, 2 ], [ 0.5 ] ) )
                .to.throw( 'expected 0 or 1' );
        } );
    } );
} );

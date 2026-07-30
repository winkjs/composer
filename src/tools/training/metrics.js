// src/tools/training/metrics.js

/**
 * @fileoverview Binary classification evaluation metrics.
 *
 * Provides confusion-matrix computation, standard derived metrics
 * (precision, recall, F1, specificity, FPR, accuracy), and a threshold
 * sweep utility for ROC-style analysis.
 *
 * All inputs are validated for binary values (exactly 0 or 1) to prevent
 * silent miscounts.
 */

import { validateBinaryArray } from './validate.js';

// ── Confusion Matrix ──────────────────────────────────────────────

/**
 * Count true positives, false positives, false negatives, and true negatives.
 *
 * @param {ArrayLike<number>} predictions — Binary predictions (0 or 1).
 * @param {ArrayLike<number>} labels      — Ground truth labels (0 or 1).
 * @returns {{ tp: number, fp: number, fn: number, tn: number }}
 */
const confusionMatrix = function ( predictions, labels ) {
    if ( predictions.length !== labels.length ) {
        throw new Error( 'confusionMatrix: predictions and labels must have the same length.' );
    }

    validateBinaryArray( predictions, 'predictions', 'confusionMatrix' );
    validateBinaryArray( labels, 'labels', 'confusionMatrix' );

    const n = predictions.length;
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;

    for ( let i = 0; i < n; i += 1 ) {
        const p = predictions[ i ];
        const l = labels[ i ];
        if ( p === 1 && l === 1 ) tp += 1;
        else if ( p === 1 && l === 0 ) fp += 1;
        else if ( p === 0 && l === 1 ) fn += 1;
        else tn += 1;
    }

    return { tp, fp, fn, tn };
}; // confusionMatrix()

// ── Derived Metrics ───────────────────────────────────────────────

/**
 * Derive standard classification metrics from a confusion matrix.
 *
 * @param {{ tp: number, fp: number, fn: number, tn: number }} cm
 * @returns {{ precision: number, recall: number, f1: number, specificity: number, fpr: number, accuracy: number }}
 */
const classificationMetrics = function ( cm ) {
    const { tp, fp, fn, tn } = cm;
    const total = tp + fp + fn + tn;

    const precision = ( tp + fp ) > 0 ? tp / ( tp + fp ) : 0;
    const recall = ( tp + fn ) > 0 ? tp / ( tp + fn ) : 0;
    const f1 = ( precision + recall ) > 0 ?
        ( 2 * precision * recall ) / ( precision + recall ) :
        0;
    const specificity = ( tn + fp ) > 0 ? tn / ( tn + fp ) : 0;
    const fpr = ( tn + fp ) > 0 ? fp / ( tn + fp ) : 0;
    const accuracy = total > 0 ? ( tp + tn ) / total : 0;

    return { precision, recall, f1, specificity, fpr, accuracy };
}; // classificationMetrics()

// ── Threshold Sweep ───────────────────────────────────────────────

/**
 * Evaluate classification at multiple probability thresholds.
 * Useful for ROC analysis and threshold selection.
 *
 * @param {Float64Array}  probabilities — Predicted probabilities.
 * @param {ArrayLike<number>} labels    — Ground truth labels (0 or 1).
 * @param {number[]}      thresholds    — Thresholds to evaluate.
 * @returns {Array<{ threshold: number, tp: number, fp: number, fn: number, tn: number, precision: number, recall: number, f1: number, specificity: number, fpr: number }>}
 */
const sweepThresholds = function ( probabilities, labels, thresholds ) {
    if ( probabilities.length !== labels.length ) {
        throw new Error( 'sweepThresholds: probabilities and labels must have the same length.' );
    }

    validateBinaryArray( labels, 'labels', 'sweepThresholds' );

    const n = probabilities.length;
    const results = new Array( thresholds.length );

    for ( let t = 0; t < thresholds.length; t += 1 ) {
        const thresh = thresholds[ t ];
        let tp = 0;
        let fp = 0;
        let fn = 0;
        let tn = 0;

        for ( let i = 0; i < n; i += 1 ) {
            const pred = ( probabilities[ i ] >= thresh ) ? 1 : 0;
            const label = labels[ i ];
            if ( pred === 1 && label === 1 ) tp += 1;
            else if ( pred === 1 && label === 0 ) fp += 1;
            else if ( pred === 0 && label === 1 ) fn += 1;
            else tn += 1;
        }

        const precision = ( tp + fp ) > 0 ? tp / ( tp + fp ) : 0;
        const recall = ( tp + fn ) > 0 ? tp / ( tp + fn ) : 0;
        const f1 = ( precision + recall ) > 0 ?
            ( 2 * precision * recall ) / ( precision + recall ) :
            0;
        const specificity = ( tn + fp ) > 0 ? tn / ( tn + fp ) : 0;
        const fpr = ( tn + fp ) > 0 ? fp / ( tn + fp ) : 0;

        results[ t ] = { threshold: thresh, tp, fp, fn, tn, precision, recall, f1, specificity, fpr };
    }

    return results;
}; // sweepThresholds()

export { confusionMatrix, classificationMetrics, sweepThresholds };

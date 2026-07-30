// src/tools/training/index.js

/**
 * @fileoverview Public API for the training utility.
 *
 * Re-exports scaling, logistic regression, and evaluation metrics
 * as a flat namespace. Intended for offline model training workflows —
 * the learned coefficients feed into flow configuration (e.g. the future
 * `infer` node).
 */

export {
    computeStandardParams,
    computeMinMaxParams,
    computeRobustParams,
    scale,
    standardize
} from './scale.js';

export { sigmoid, train, predict, classify } from './logistic.js';
export { confusionMatrix, classificationMetrics, sweepThresholds } from './metrics.js';

// src/tools/training/logistic.js

/**
 * @fileoverview Logistic regression via batch gradient descent with L2
 * regularization and class weighting.
 *
 * Implements the standard binary logistic model (Bishop, 2006, PRML §4.3):
 *     P(y=1 | x) = σ( wᵀx + b )
 *
 * Training minimises the weighted cross-entropy loss with optional L2
 * penalty (ridge). The data term is averaged by 1/n while the L2 penalty
 * is not — this makes lambda dataset-size-invariant: the same lambda
 * produces the same coefficients regardless of n (when data is replicated).
 * Class weights automatically balance imbalanced datasets by making the
 * effective sample count equal across classes.
 *
 * Convergence uses relative loss change: |Δloss| / max(1, |prevLoss|),
 * with a minimum iteration guard to avoid premature exit.
 *
 * Hot-path arrays (pHat, grad) are pre-allocated once — zero allocations
 * inside the training loop.
 *
 * Reference:
 *   Bishop, C. M. (2006). Pattern Recognition and Machine Learning.
 *   Springer. Chapter 4.3 — Probabilistic Discriminative Models.
 */

import { validateMatrix, validateBinaryLabels } from './validate.js';

// ── Sigmoid ───────────────────────────────────────────────────────

const SIGMOID_UPPER = 1 - 1e-15;
const SIGMOID_LOWER = 1e-15;

/**
 * Logistic sigmoid, clamped to [-500, 500] to prevent exp overflow.
 * Never returns exact 0 or 1 — prevents log(p) from producing -Infinity.
 *
 * @param {number} z — Linear predictor.
 * @returns {number} σ(z) ∈ (1e-15, 1 - 1e-15).
 */
const sigmoid = function ( z ) {
    if ( z > 500 ) return SIGMOID_UPPER;
    if ( z < -500 ) return SIGMOID_LOWER;
    return 1 / ( 1 + Math.exp( -z ) );
}; // sigmoid()

// ── Defaults ──────────────────────────────────────────────────────

const DEFAULTS = Object.freeze( {
    learningRate: 0.1,
    maxIter: 1000,
    minIter: 5,
    lambda: 0.01,
    classWeight: null,
    convergenceTol: 1e-6
} );

// ── Train ─────────────────────────────────────────────────────────

/**
 * Train a binary logistic regression model.
 *
 * @param {number[][]} X — Feature matrix (n × p), already scaled.
 * @param {number[]}   y — Label vector, each element exactly 0 or 1.
 * @param {object}     [options] — Training hyper-parameters.
 * @param {number}     [options.learningRate=0.1]
 * @param {number}     [options.maxIter=1000]
 * @param {number}     [options.minIter=5]         — Minimum iterations before convergence check.
 * @param {number}     [options.lambda=0.01]       — L2 regularization strength.
 * @param {string|null} [options.classWeight=null]  — 'auto' or null.
 * @param {number}     [options.convergenceTol=1e-6]
 * @returns {{ coefficients: Float64Array, intercept: number, loss: number, iterations: number }}
 */
const train = function ( X, y, options ) {
    // ── Validate ──────────────────────────────────────────────────
    const { n, p } = validateMatrix( X, 'train' );
    validateBinaryLabels( y, n, 'train' );

    // ── Options ───────────────────────────────────────────────────
    const opts = Object.assign( Object.create( null ), DEFAULTS, options );
    const alpha = opts.learningRate;
    const maxIter = opts.maxIter;
    const minIter = opts.minIter;
    const lambda = opts.lambda;
    const tol = opts.convergenceTol;

    // ── Class weights ─────────────────────────────────────────────
    // Auto-compute: w_k = n / (2 × n_k)  — equalises effective counts.
    const w = new Float64Array( 2 ); // w[0] = weight for class 0, w[1] for class 1
    if ( opts.classWeight === 'auto' ) {
        let n1 = 0;
        for ( let i = 0; i < n; i += 1 ) n1 += y[ i ];
        const n0 = n - n1;
        if ( n0 === 0 || n1 === 0 ) {
            throw new Error( 'winkComposer/train: y must contain both classes (0 and 1).' );
        }
        w[ 0 ] = n / ( 2 * n0 );
        w[ 1 ] = n / ( 2 * n1 );
    } else {
        w[ 0 ] = 1;
        w[ 1 ] = 1;
    }

    // ── Initialise ────────────────────────────────────────────────
    const coefficients = new Float64Array( p ); // zeros
    let intercept = 0;

    // Pre-allocated working arrays — zero allocations in the loop.
    const pHat = new Float64Array( n );
    const grad = new Float64Array( p );

    let prevLoss = Infinity;
    let loss = 0;
    let iterations = 0;

    // ── Gradient descent loop ─────────────────────────────────────
    for ( let iter = 0; iter < maxIter; iter += 1 ) {
        iterations = iter + 1;
        // ── Forward pass: z_i = wᵀx_i + b → pHat_i = σ(z_i) ─────
        for ( let i = 0; i < n; i += 1 ) {
            const row = X[ i ];
            let z = intercept;
            for ( let j = 0; j < p; j += 1 ) {
                z += coefficients[ j ] * row[ j ];
            }
            pHat[ i ] = sigmoid( z );
        }

        // ── Loss: weighted cross-entropy + L2 penalty ─────────────
        loss = 0;
        for ( let i = 0; i < n; i += 1 ) {
            const yi = y[ i ];
            const pi = pHat[ i ];
            const wi = w[ yi ];
            // Sigmoid never returns exact 0 or 1, so log is safe.
            loss -= wi * ( ( yi * Math.log( pi ) ) + ( ( 1 - yi ) * Math.log( 1 - pi ) ) );
        }
        loss /= n;
        // L2 penalty on coefficients (not intercept).
        let l2 = 0;
        for ( let j = 0; j < p; j += 1 ) {
            l2 += coefficients[ j ] * coefficients[ j ];
        }
        loss += ( lambda / 2 ) * l2;

        // ── Convergence check (relative, with minIter guard) ──────
        if ( iter >= minIter ) {
            const relChange = Math.abs( prevLoss - loss ) / Math.max( 1, Math.abs( prevLoss ) );
            if ( relChange < tol ) break;
        }
        prevLoss = loss;

        // ── Gradient ──────────────────────────────────────────────
        // Zero gradient accumulators.
        for ( let j = 0; j < p; j += 1 ) grad[ j ] = 0;
        let g0 = 0;

        for ( let i = 0; i < n; i += 1 ) {
            const row = X[ i ];
            const err = pHat[ i ] - y[ i ];
            const wi = w[ y[ i ] ];
            const we = wi * err;
            for ( let j = 0; j < p; j += 1 ) {
                grad[ j ] += we * row[ j ];
            }
            g0 += we;
        }
        // Normalise and add L2 penalty to coefficient gradient.
        for ( let j = 0; j < p; j += 1 ) {
            grad[ j ] = ( grad[ j ] / n ) + ( lambda * coefficients[ j ] );
        }
        g0 /= n; // intercept: no regularization

        // ── Update ────────────────────────────────────────────────
        for ( let j = 0; j < p; j += 1 ) {
            coefficients[ j ] -= alpha * grad[ j ];
        }
        intercept -= alpha * g0;
    }

    return {
        coefficients: coefficients,
        intercept: intercept,
        loss: loss,
        iterations: iterations
    };
}; // train()

// ── Predict ───────────────────────────────────────────────────────

/**
 * Compute predicted probabilities for a feature matrix.
 *
 * @param {number[][]}    X            — Feature matrix (n × p).
 * @param {Float64Array}  coefficients — Model weights.
 * @param {number}        intercept    — Model bias.
 * @returns {Float64Array} Probabilities, one per row.
 */
const predict = function ( X, coefficients, intercept ) {
    const n = X.length;
    const p = coefficients.length;
    const probs = new Float64Array( n );

    for ( let i = 0; i < n; i += 1 ) {
        const row = X[ i ];
        let z = intercept;
        for ( let j = 0; j < p; j += 1 ) {
            z += coefficients[ j ] * row[ j ];
        }
        probs[ i ] = sigmoid( z );
    }

    return probs;
}; // predict()

// ── Classify ──────────────────────────────────────────────────────

/**
 * Threshold probabilities into binary class labels.
 *
 * @param {Float64Array} probabilities — Output of predict().
 * @param {number}       [threshold=0.5]
 * @returns {Uint8Array} Binary labels (0 or 1).
 */
const classify = function ( probabilities, threshold ) {
    const t = ( threshold === undefined ) ? 0.5 : threshold;
    const n = probabilities.length;
    const labels = new Uint8Array( n );

    for ( let i = 0; i < n; i += 1 ) {
        labels[ i ] = ( probabilities[ i ] >= t ) ? 1 : 0;
    }

    return labels;
}; // classify()

export { sigmoid, train, predict, classify };

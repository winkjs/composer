// nodes/process-index/update.js

/**
 * @fileoverview Update function for processIndex node.
 *
 * Computes process capability/performance index from mean and stddev.
 * Supports two-sided specs (upperSpecLimit + lowerSpecLimit) and one-sided specs.
 */

/**
 * Clamp a value to [-maxIdx, maxIdx] range.
 * @param {number} value - Raw index value
 * @param {number} maxIdx - Maximum absolute value
 * @returns {number} Clamped value
 */
const clampIndex = function ( value, maxIdx ) {
    return Math.max( Math.min( value, maxIdx ), -maxIdx );
}; // clampIndex()

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;

    state.inputValidationFailed = false;

    const mean = msg[ state.x ];
    const stddev = msg[ state.y ];

    // Validate inputs: mean must be finite, stddev must be finite and positive
    if ( !Number.isFinite( mean ) || !Number.isFinite( stddev ) || stddev <= 0 ) {
        state.inputValidationFailed = true;
        return state;
    }

    const maxIdx = state.maxIndex;
    const denominator = 3 * stddev;

    // Compute upper index (if upperSpecLimit provided)
    if ( state.hasUpperSpecLimit ) {
        const rawUpper = ( state.upperSpecLimit - mean ) / denominator;
        state.upper = clampIndex( rawUpper, maxIdx );
    } else {
        state.upper = NaN;
    }

    // Compute lower index (if lowerSpecLimit provided)
    if ( state.hasLowerSpecLimit ) {
        const rawLower = ( mean - state.lowerSpecLimit ) / denominator;
        state.lower = clampIndex( rawLower, maxIdx );
    } else {
        state.lower = NaN;
    }

    // Combined index: explicit handling to avoid Math.min(NaN, value) = NaN
    if ( state.hasUpperSpecLimit && state.hasLowerSpecLimit ) {
        state.index = Math.min( state.upper, state.lower );
    } else if ( state.hasUpperSpecLimit ) {
        state.index = state.upper;
    } else {
        state.index = state.lower;
    }

    // Status classification based on combined index
    if ( state.index >= state.capableThreshold ) {
        state.status = 'capable';
    } else if ( state.index >= state.marginalThreshold ) {
        state.status = 'marginal';
    } else {
        state.status = 'incapable';
    }

    return state;
}; // update()

export default update;


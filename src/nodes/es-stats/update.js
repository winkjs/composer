/**
 * @fileoverview Hot-path dispatcher for the esStats node.
 *
 * Routes incoming values through first-sample initialization (seeds mean,
 * floor, ceiling), then delegates to updateWelford (mean, variance, SNR,
 * CV, zScore) and updateEnvelope (floor, ceiling, envScore) based on
 * computation-path flags resolved at init. Zero allocations; all
 * reads/writes via the pre-allocated state object.
 */
// nodes/es-stats/update.js

import updateEnvelope from './update-envelope.js';
import updateWelford from './update-welford.js';

/**
 * Update all requested statistics in a single pass.
 * Updates statistics using Welford's online algorithm
 * for numerical stability.
 *
 * @param {Object} state - Node state
 * @param {Object} msg - Message containing input value
 * @returns {Object} Updated state
 */
const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    const xVal = msg[ state.x ];
    // Reset on each update
    state.inputValidationFailed = false;
    // Handle faults gracefully: ensure their isolation
    if ( !Number.isFinite( xVal ) ) {
        // Signals publishing NaN for all demanded `stats` in publishTo.
        state.inputValidationFailed = true;
        return state;
    }

    // First sample initialization
    if ( state.sampleCount === 0 ) {
        state.mean = xVal;
        state.m2 = 0;
        state.variance = 0;
        state.stdev = 0;
        state.floor = xVal;
        state.ceiling = xVal;
        state.envelope = 0;
        state.mid = xVal;
        state.weightSum = state.alpha;
        state.sampleCount = 1;
        return state;
    }

    state.sampleCount += 1;

    if ( state.needsWelford ) updateWelford( state, xVal );
    if ( state.needsEnvelope ) updateEnvelope( state, xVal );

    return state;
}; // update()

export default update;

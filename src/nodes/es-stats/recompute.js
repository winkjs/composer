/**
 * @fileoverview Numerical stability handler for the esStats node.
 *
 * Floors negative m2 and variance to zero, corrects inverted floor/ceiling
 * order, and recomputes variance from m2 using the appropriate normalization
 * (biased or unbiased). On catastrophic NaN/Infinity in critical state fields,
 * triggers a full reset. Since exponentially weighted statistics have inherently
 * bounded state (each update is a weighted blend, not unbounded accumulation),
 * consistency corrections suffice — no sample buffer is available for full
 * recomputation.
 */
// nodes/es-stats/recompute.js

import reset from './reset.js';

/**
 * Recompute statistics from current state to ensure numerical consistency.
 * Handles numerical drift in long-running streams.
 *
 * @param {Object} state - Node state
 * @returns {boolean} Always true (successful recomputation)
 */
const recompute = function ( state ) {
    // Ensure m2 is non-negative (second moment)
    if ( state.m2 < 0 ) {
        state.m2 = 0;
    }

    // Ensure variance is non-negative
    if ( state.variance < 0 ) {
        state.variance = 0;
        state.stdev = 0;
    }

    const stats = state.stats;
    // Recompute variance from m2 to ensure consistency
    if ( state.sampleCount >= 2 && stats.variance !== undefined ) {
        if ( state.biased ) {
            state.variance = state.m2;
        } else {
            const w = state.weightSum;
            state.variance = ( w > 1e-12 ) ? ( state.m2 / w ) : state.m2;
        }
        state.stdev = Math.sqrt( state.variance );
    }

    // Ensure envelope consistency
    if ( stats.envelope !== undefined ) {
        // Floor should not exceed ceiling
        if ( state.floor > state.ceiling ) {
            const temp = state.floor;
            state.floor = state.ceiling;
            state.ceiling = temp;
        }

        // Recompute derived envelope metrics
        state.envelope = state.ceiling - state.floor;
        state.mid = ( state.floor + state.ceiling ) * 0.5;
    }

    // Check for NaN and reset if found
    if ( !Number.isFinite( state.mean ) ||
         !Number.isFinite( state.variance ) ||
         !Number.isFinite( state.floor ) ||
         !Number.isFinite( state.ceiling ) ) {
        // Catastrophic numerical failure - reset
        reset( state );
        return true;
    }

    return true;
}; // recompute()

export default recompute;

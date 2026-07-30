// nodes/lag/reset.js

/**
 * @fileoverview Resets the lag node state to initial conditions.
 *
 * Resets computed values to NaN. Without `hasCumDelta`, also clears the
 * ring buffer(s), which must refill before stats become valid. With
 * `hasCumDelta`, the ring buffer is preserved (ADR-008) so the first
 * post-reset delta bridges the reset without losing one interval.
 *
 * @see ADR-004
 */

import { reset as resetRing } from '../../windowing/count-sliding/index.js';

/**
 * Resets the node to its initial state.
 *
 * @param {Object} state - Node state to reset
 * @returns {boolean} Always returns true (success)
 */
const reset = function ( state ) {
    // ADR-008: cumDelta integrates a continuous signal; the ring buffer
    // is the reference point. Clearing it loses one delta per reset
    // (~1-3% systematic error in metered signals). Preserve the buffer
    // so the first post-reset delta bridges the boundary gap-free.
    // Without cumDelta, instantaneous stats (delta, ratio, roc, slope,
    // logReturn) need a clean startup to avoid cross-boundary artifacts.
    if ( !state.hasCumDelta ) {
        resetRing( state.ringX );
        if ( state.ringT !== null ) {
            resetRing( state.ringT );
        }
    }

    // Reset computed values to NaN (startup state)
    state.delta = NaN;
    state.ratio = NaN;
    state.roc = NaN;
    state.slope = NaN;
    state.logReturn = NaN;
    state.xLag = NaN;
    // cumDelta resets to 0 (new integration lower limit)
    state.cumDelta = 0;

    return true;
}; // reset()

export default reset;

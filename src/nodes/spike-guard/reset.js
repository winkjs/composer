// nodes/spike-guard/reset.js

/**
 * @fileoverview Reset spikeGuard node state.
 *
 * Clears the ring buffer and resets output values.
 */

import { reset as resetRing } from '../../windowing/count-sliding/index.js';

const reset = function ( state ) {
    resetRing( state.ring );
    state.clean = 0;
    state.detected = false;
    state.magnitude = 0;
    return true;
}; // reset()

export default reset;

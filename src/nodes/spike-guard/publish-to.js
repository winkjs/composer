// nodes/spike-guard/publish-to.js

/**
 * @fileoverview Publish spikeGuard outputs to message.
 *
 * Supports three stats:
 * - clean: Cleaned value (median of window)
 * - detected: Boolean indicating spike detected
 * - magnitude: Spike magnitude (0 if no spike)
 */

import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;

    // Propagate NaN if unhealthy
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    // Publish configured stats (only those requested in spec)
    if ( state.stats.clean ) {
        msg[ state.stats.clean.storeAs ] = state.clean;
    }
    if ( state.stats.detected ) {
        msg[ state.stats.detected.storeAs ] = state.detected;
    }
    if ( state.stats.magnitude ) {
        msg[ state.stats.magnitude.storeAs ] = state.magnitude;
    }
}; // publishTo()

export default publishTo;

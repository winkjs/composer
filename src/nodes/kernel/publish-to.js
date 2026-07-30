/**
 * @fileoverview Publish function for kernel node.
 *
 * Copies the convolution result to the outgoing message. Gates on warmup
 * (ring buffer not yet full) and input validation failure (publishes NaN).
 */

import { publishNaN } from '../../core/utils/node/index.js';
import { isNotFull } from '../../windowing/count-sliding/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;
    // Propagate NaN if unhealthy
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    // Ring is full (warmup complete) — publish the result
    if ( !isNotFull( state.ring ) ) {
        msg[ state.stats.filtered.storeAs ] = state.result;
    }
}; // publishTo()

export default publishTo;

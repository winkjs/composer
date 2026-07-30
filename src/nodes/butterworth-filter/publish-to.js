/**
 * @fileoverview Publish function for butterworth-filter node.
 *
 * Copies the filtered output to the message, or propagates NaN if the last
 * input was invalid. Skipped entirely when disabled.
 */

import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;
    // Propagate NaN if unhealthy
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    msg[ state.stats.filtered.storeAs ] = state.output;
}; // publishTo()

export default publishTo;

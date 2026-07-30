/**
 * @fileoverview Publish function for median3 node.
 *
 * Copies the computed median value to the output message, or propagates
 * NaN if the last input was invalid. Skipped entirely when disabled.
 */

import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;
    // Propagate NaN if unhealthy
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    msg[ state.stats.median3.storeAs ] = state.median3;
}; // publishTo()

export default publishTo;

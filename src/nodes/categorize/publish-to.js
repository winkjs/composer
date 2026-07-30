/**
 * @fileoverview Publish function for categorize node.
 *
 * Copies the assigned category name and/or index to the output message.
 * Propagates NaN via publishNaN when the last input was invalid.
 * Skipped entirely when the node is disabled.
 */

import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;
    // Propagate NaN if unhealthy
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    // Publish requested stats
    if ( state.stats.category ) {
        msg[ state.stats.category.storeAs ] = state.category;
    }

    if ( state.stats.index ) {
        msg[ state.stats.index.storeAs ] = state.categoryIndex;
    }
}; // publishTo()

export default publishTo;

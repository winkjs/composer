// nodes/accumulate/publish-to.js

/**
 * @fileoverview Publishes accumulated sum to output message.
 *
 * Copies state.sum to the configured output field. On validation failure,
 * publishes NaN for fault isolation downstream.
 *
 * @see ADR-004
 */

import { publishNaN } from '../../core/utils/node/index.js';

/**
 * Publishes the accumulated sum to the output message.
 *
 * @param {Object} state - Node state
 * @param {Object} msg - Output message to populate
 */
const publishTo = function ( state, msg ) {
    // Guard: skip if disabled
    if ( state.disable ) return;

    // Fault isolation: propagate NaN if input validation failed
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    // Publish sum
    msg[ state.stats.sum.storeAs ] = state.sum;
}; // publishTo()

export default publishTo;

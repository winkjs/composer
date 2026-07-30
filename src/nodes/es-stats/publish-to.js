/**
 * @fileoverview Copies requested esStats statistics onto the message for
 * downstream consumption.
 *
 * Propagates NaN for all configured stats when input validation has failed.
 * Gates output until the warmup period (3 samples) is complete to ensure
 * statistical meaningfulness. Iterates only over stats declared in the spec;
 * zero allocations on the hot path.
 */
// nodes/es-stats/publish-to.js

import { publishNaN } from '../../core/utils/node/index.js';

/**
 * Publish computed statistics to message.
 * Only publishes stats that were requested and after warmup.
 *
 * @param {Object} state - Node state with computed statistics
 * @param {Object} msg - Message to annotate with outputs
 */
const publishTo = function ( state, msg ) {
    if ( state.disable ) return;
    // Propagate NaN if unhealthy
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }
    // Only publish after at least 3 samples for statistical meaning
    if ( state.sampleCount < 3 ) {
        return;
    }

    // Iterate only over configured stats
    const stats = state.stats;
    for ( const statName in stats ) {
        if ( Object.prototype.hasOwnProperty.call( stats, statName ) ) {
            msg[ stats[ statName ].storeAs ] = state[ statName ];
        }
    }
}; // publishTo()

export default publishTo;

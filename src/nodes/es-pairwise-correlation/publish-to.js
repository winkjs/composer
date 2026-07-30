/**
 * @fileoverview Copies the current pairwise correlation estimates, covariances,
 * Fisher Z values, and/or pair labels onto the message for downstream consumption.
 * Propagates NaN when input validation has failed; gates output until minSamples
 * is reached.
 */
// nodes/es-pairwise-correlation/publish-to.js
import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;
    // Propagate NaN if unhealthy
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }
    // Don't publish until we have reliable estimates
    if ( state.sampleCount < state.minSamples ) {
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

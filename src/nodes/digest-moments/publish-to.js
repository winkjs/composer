// nodes/digest-moments/publish-to.js

/**
 * @fileoverview Publish function for digestMoments node.
 *
 * Publishes computed statistics to the message object.
 * Uses publishNaN for graceful fault isolation when inputValidationFailed.
 */

import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;

    // Propagate NaN if unhealthy (fault isolation)
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    // Publish only requested stats
    const stats = state.stats;
    if ( stats.n ) msg[ stats.n.storeAs ] = state.n;
    if ( stats.mean ) msg[ stats.mean.storeAs ] = state.mean;
    if ( stats.variance ) msg[ stats.variance.storeAs ] = state.variance;
    if ( stats.stddev ) msg[ stats.stddev.storeAs ] = state.stddev;
    if ( stats.cv ) msg[ stats.cv.storeAs ] = state.cv;
    if ( stats.skew ) msg[ stats.skew.storeAs ] = state.skew;
    if ( stats.kurtosis ) msg[ stats.kurtosis.storeAs ] = state.kurtosis;
    if ( stats.min ) msg[ stats.min.storeAs ] = state.min;
    if ( stats.max ) msg[ stats.max.storeAs ] = state.max;
}; // publishTo()

export default publishTo;

// nodes/vector-distance/publish-to.js

import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;
    // Propagate NaN if unhealthy
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    // Publish each configured statistic directly
    if ( state.stats.mad ) {
        msg[ state.stats.mad.storeAs ] = state.distances.mad;
    }

    if ( state.stats.rms ) {
        msg[ state.stats.rms.storeAs ] = state.distances.rms;
    }

    if ( state.stats.maximum ) {
        msg[ state.stats.maximum.storeAs ] = state.distances.maximum;
    }

    if ( state.stats.cosine ) {
        msg[ state.stats.cosine.storeAs ] = state.distances.cosine;
    }

    if ( state.stats.angular ) {
        msg[ state.stats.angular.storeAs ] = state.distances.angular;
    }
}; // publishTo()

export default publishTo;

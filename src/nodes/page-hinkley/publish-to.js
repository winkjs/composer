/**
 * @fileoverview Publishes Page-Hinkley results to the downstream message.
 *
 * Copies requested stats (phShift, phTestStatistic, phMean) from internal
 * state to the message. Gated by minWarmUpSamples — no output until the
 * baseline has accumulated enough observations. Propagates NaN downstream
 * when the input was invalid.
 */

import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;
    // Propagate NaN if unhealthy
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    // Require minimum samples before publishing results.
    if ( state.count < state.minWarmUpSamples ) return;
    // Publish whatever is asked for.
    if ( state.stats.phShift ) msg[ state.stats.phShift.storeAs ] = state.shiftDetected;
    if ( state.stats.phTestStatistic ) msg[ state.stats.phTestStatistic.storeAs ] = state.testStatistic;
    if ( state.stats.phMean ) msg[ state.stats.phMean.storeAs ] = state.mean;
}; // publishTo()

export default publishTo;

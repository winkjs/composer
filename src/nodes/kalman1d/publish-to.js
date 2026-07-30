/**
 * @fileoverview Publish function for kalman1d node.
 *
 * Copies computed state values to the output message, or propagates NaN
 * if the last input was invalid. Skipped entirely when disabled.
 *
 * All four stats (filtered, variance, innovation, innovationGate) are
 * published on every tick — including after outlier exclusion. This is
 * intentional: innovation reflects what reality looked like (measurement-
 * space), while filtered/variance reflect the predict-only state. Downstream
 * nodes (appraise, esStats, predict) need the innovation from excluded
 * measurements to detect model mismatch and build anomaly conviction.
 */

import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;

    // Propagate NaN if unhealthy (fault isolation)
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    // Publish only the stats the user requested
    const stats = state.stats;
    if ( stats.filtered ) msg[ stats.filtered.storeAs ] = state.xHat;
    if ( stats.variance ) msg[ stats.variance.storeAs ] = state.P;
    if ( stats.innovation ) msg[ stats.innovation.storeAs ] = state.innovation;
    if ( stats.innovationGate ) msg[ stats.innovationGate.storeAs ] = state.innovationGate;
}; // publishTo()

export default publishTo;

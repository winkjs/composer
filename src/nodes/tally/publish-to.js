/**
 * @fileoverview Copies the computed tally reductions onto the message, or
 * propagates NaN to every configured output when the last input was a NaN flag.
 * Skipped when disabled; still runs when paused so last values stay visible.
 */

import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    const stats = state.stats;
    if ( stats.any ) {
        msg[ stats.any.storeAs ] = state.any;
    }
    if ( stats.all ) {
        msg[ stats.all.storeAs ] = state.all;
    }
    if ( stats.count ) {
        msg[ stats.count.storeAs ] = state.count;
    }
}; // publishTo()

export default publishTo;

/**
 * @fileoverview Copies the computed unbalance stats onto the message, or
 * propagates NaN to every configured metric when the last input was invalid.
 * presentCount is written separately and always carries the real count, because
 * it describes the input, not the result. Skipped when disabled; still runs when
 * paused so last values stay visible.
 */

import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;

    const stats = state.stats;

    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
    } else {
        if ( stats.mean ) {
            msg[ stats.mean.storeAs ] = state.mean;
        }
        if ( stats.min ) {
            msg[ stats.min.storeAs ] = state.min;
        }
        if ( stats.max ) {
            msg[ stats.max.storeAs ] = state.max;
        }
        if ( stats.range ) {
            msg[ stats.range.storeAs ] = state.range;
        }
        if ( stats.maxDev ) {
            msg[ stats.maxDev.storeAs ] = state.maxDev;
        }
        if ( stats.unbalance ) {
            msg[ stats.unbalance.storeAs ] = state.unbalance;
        }
        if ( stats.worstIndex ) {
            msg[ stats.worstIndex.storeAs ] = state.worstIndex;
        }
        if ( stats.worstDev ) {
            msg[ stats.worstDev.storeAs ] = state.worstDev;
        }
    }

    // presentCount describes the input, so it carries the real count on every
    // tick — including a blanked one, where publishNaN above set it to NaN.
    if ( stats.presentCount ) {
        msg[ stats.presentCount.storeAs ] = state.presentCount;
    }
}; // publishTo()

export default publishTo;

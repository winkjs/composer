// nodes/lag/publish-to.js

/**
 * @fileoverview Publishes computed lag statistics to the output message.
 *
 * Only publishes requested stats. Uses publishNaN for fault isolation
 * when input validation has failed. Follows ADR-004 patterns.
 *
 * @see ADR-004
 */

import { publishNaN } from '../../core/utils/node/index.js';

/**
 * Copies computed statistics to the output message.
 *
 * @param {Object} state - Node state from update()
 * @param {Object} msg - Output message to enrich
 */
const publishTo = function ( state, msg ) {
    // Guard: skip if disabled
    if ( state.disable ) return;

    // Fault isolation: propagate NaN if input validation failed
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        // cumDelta preserves its value (accumulation skipped, but sum is valid)
        if ( state.hasCumDelta ) {
            msg[ state.stats.cumDelta.storeAs ] = state.cumDelta;
        }
        return;
    }

    // Publish only requested stats
    if ( state.hasXLag ) {
        msg[ state.stats.xLag.storeAs ] = state.xLag;
    }

    if ( state.hasDelta ) {
        msg[ state.stats.delta.storeAs ] = state.delta;
    }

    if ( state.hasRatio ) {
        msg[ state.stats.ratio.storeAs ] = state.ratio;
    }

    if ( state.hasRoc ) {
        msg[ state.stats.roc.storeAs ] = state.roc;
    }

    if ( state.hasSlope ) {
        msg[ state.stats.slope.storeAs ] = state.slope;
    }

    if ( state.hasLogReturn ) {
        msg[ state.stats.logReturn.storeAs ] = state.logReturn;
    }

    if ( state.hasCumDelta ) {
        msg[ state.stats.cumDelta.storeAs ] = state.cumDelta;
    }
}; // publishTo()

export default publishTo;

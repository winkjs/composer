// nodes/process-index/publish-to.js

/**
 * @fileoverview Publish function for processIndex node.
 *
 * Publishes computed index values and status to the message.
 * On inputValidationFailed, publishes NaN for numeric stats and 'incapable' for status.
 */

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;

    if ( state.inputValidationFailed ) {
        // Publish NaN for numeric stats, 'incapable' for status
        if ( state.stats.index ) msg[ state.stats.index.storeAs ] = NaN;
        if ( state.stats.upper ) msg[ state.stats.upper.storeAs ] = NaN;
        if ( state.stats.lower ) msg[ state.stats.lower.storeAs ] = NaN;
        if ( state.stats.status ) msg[ state.stats.status.storeAs ] = 'incapable';
        return;
    }

    if ( state.stats.index ) msg[ state.stats.index.storeAs ] = state.index;
    if ( state.stats.upper ) msg[ state.stats.upper.storeAs ] = state.upper;
    if ( state.stats.lower ) msg[ state.stats.lower.storeAs ] = state.lower;
    if ( state.stats.status ) msg[ state.stats.status.storeAs ] = state.status;
}; // publishTo()

export default publishTo;


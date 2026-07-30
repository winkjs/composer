/**
 * @fileoverview Publish-to function for the transform node.
 *
 * Copies the computed result to the output message. When input
 * validation failed, publishes NaN via the standard helper.
 * When the transform produced NaN (e.g. sqrt of negative),
 * the NaN flows through naturally — no flag, no special handling.
 */

import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;

    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    msg[ state.stats.result.storeAs ] = state.result;
}; // publishTo()

export default publishTo;

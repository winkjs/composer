/**
 * @fileoverview Copies the current EWMA estimate onto the message for
 * downstream consumption. Propagates NaN when input validation has failed,
 * ensuring downstream nodes see an explicit fault rather than stale data.
 */
import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;
    // Propagate NaN if unhealthy
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    msg[ state.stats.mean.storeAs ] = state.esmValue;
}; // publishTo()

export default publishTo;

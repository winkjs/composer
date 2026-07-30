// nodes/ratio/publish-to.js

import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;
    // Propagate NaN if unhealthy
    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }
    msg[ state.stats.ratio.storeAs ] = state.ratio;
}; // publishTo()

export default publishTo;

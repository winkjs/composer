// nodes/sw-stats/reset.js

import { reset as resetRing }  from '../../windowing/count-sliding/index.js';
const reset = function ( state ) {
    state.s1 = 0;
    state.s2 = state.need2 ? 0 : undefined;
    state.s3 = state.need3 ? 0 : undefined;
    state.s4 = state.need4 ? 0 : undefined;

    resetRing( state.ring );

    return true;
}; // reset()

export default reset;

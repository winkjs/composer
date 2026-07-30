// nodes/sw-stats/update.js

import { push } from '../../windowing/count-sliding/index.js';

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    const xVal = msg[ state.x ];
    // Reset on each update
    state.inputValidationFailed = false;
    // Handle faults gracefully: ensure their isolation
    if ( !Number.isFinite( xVal ) ) {
        // Signals publishing NaN for all demanded `stats` in publishTo.
        state.inputValidationFailed = true;
        return state;
    }

    const evicted = push( state.ring, xVal ) ?? 0;

    state.s1 += xVal - evicted;
    if ( state.need2 ) {
        const value2 = xVal * xVal;
        const evicted2 = evicted * evicted;
        state.s2 += value2 - evicted2;
        if ( state.need3 ) {
            const value3 = value2 * xVal;
            const evicted3 = evicted2 * evicted;
            state.s3 += value3 - evicted3;
            if ( state.need4 ) {
                const value4 = value3 * xVal;
                const evicted4 = evicted3 * evicted;
                state.s4 += value4 - evicted4;
            }
        }
    }

    return state;
}; // update()

export default update;

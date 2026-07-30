// nodes/sw-stats/recompute.js

const recompute = function ( state ) {
    // Reset accumulators first
    state.s1 = 0;
    state.s2 = state.need2 ? 0 : undefined;
    state.s3 = state.need3 ? 0 : undefined;
    state.s4 = state.need4 ? 0 : undefined;

    const buf = state.ring.buffer;
    // Only process actual values
    const used = state.ring.used;

    for ( let k = 0; k < used; k += 1 ) {
        const value = buf[ k ];
        state.s1 += value;
        if ( state.need2 || state.need3 || state.need4 ) {
            const value2 = value * value;
            if ( state.need2 ) state.s2 += value2;
            if ( state.need3 || state.need4 ) {
                const value3 = value2 * value;
                if ( state.need3 ) state.s3 += value3;
                if ( state.need4 ) {
                    const value4 = value3 * value;
                    state.s4 += value4;
                }
            }
        }
    }
    return true;
}; // recompute()

export default recompute;

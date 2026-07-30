/**
 * @fileoverview Update function for butterworth-filter node.
 *
 * Implements Direct Form II Transposed structure for a 2nd-order Butterworth
 * filter. Denormals are flushed to zero to avoid performance degradation on
 * x86 hardware.
 */

const DENORMAL_THRESHOLD = 1e-30;

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

    // Direct Form II implementation
    const output = ( state.b0 * xVal ) + state.z1;
    state.z1 = ( state.b1 * xVal ) - ( state.a1 * output ) + state.z2;
    state.z2 = ( state.b2 * xVal ) - ( state.a2 * output );

    // Flush denormals to zero (performance optimization)
    if ( Math.abs( state.z1 ) < DENORMAL_THRESHOLD ) state.z1 = 0;
    if ( Math.abs( state.z2 ) < DENORMAL_THRESHOLD ) state.z2 = 0;

    // Store output in state for publishTo() to access
    state.output = output;

    return state;
}; // update()

export default update;

/**
 * @fileoverview Reset for butterworth-filter node.
 *
 * Clears delay elements and output. When a DC estimate is configured,
 * restores steady-state z1/z2 and output to minimize transient on restart.
 */

const reset = function ( state ) {
    // Clear delay elements
    state.z1 = 0;
    state.z2 = 0;

    // Clear output
    state.output = 0;

    // Re-initialize to steady-state if DC estimate is known
    if ( state.config.dcEstimate !== undefined ) {
        const dcGain = ( state.b0 + state.b1 + state.b2 ) / ( 1 + state.a1 + state.a2 );
        if ( Math.abs( dcGain ) > 1e-10 ) {
            const steadyOutput = state.config.dcEstimate * dcGain;
            state.z1 = steadyOutput - ( state.b0 * state.config.dcEstimate );
            state.z2 = ( state.b2 * state.config.dcEstimate ) - ( state.a2 * steadyOutput );
            state.output = steadyOutput;
        }
    }

    return true;
}; // reset()

export default reset;

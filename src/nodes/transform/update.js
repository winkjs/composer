/**
 * @fileoverview Update function for the transform node.
 *
 * Applies the user-supplied pure function to the input value.
 * Input validation uses the standard `inputValidationFailed` flag.
 * Transform-produced NaN (e.g. sqrt of negative) is NOT flagged —
 * the node is healthy; the math produced NaN. Downstream nodes
 * catch it via their own input validation.
 */

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;

    state.inputValidationFailed = false;

    const xVal = msg[ state.x ];

    if ( !Number.isFinite( xVal ) ) {
        state.inputValidationFailed = true;
        return state;
    }

    try {
        state.result = state.using( xVal );
    } catch {
        state.result = NaN;
    }

    return state;
}; // update()

export default update;

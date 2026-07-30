/**
 * @fileoverview Update function for diff node.
 *
 * Computes the difference between two numeric message fields (x - y),
 * with optional absolute value mode.
 */

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

    const yVal = msg[ state.y ];
    // Handle faults gracefully: ensure their isolation
    if ( !Number.isFinite( yVal ) ) {
        // Signals publishing NaN for all demanded `stats` in publishTo.
        state.inputValidationFailed = true;
        return state;
    }

    // Compute difference
    const difference = xVal - yVal;

    // Apply absolute if configured
    state.diff = state.absolute ? Math.abs( difference ) : difference;

    return state;
}; // update()

export default update;

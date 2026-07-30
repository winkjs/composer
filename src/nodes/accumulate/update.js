// nodes/accumulate/update.js

/**
 * @fileoverview Hot path for accumulate node message processing.
 *
 * Simple running sum with zero allocation. When disabled, skips update
 * entirely — sum remains unchanged. No ring buffer, so no catch-up problem
 * when re-enabled after disabled period.
 *
 * @see ADR-004
 */

/**
 * Processes a message and accumulates the input value.
 *
 * @param {Object} state - Node state from init()
 * @param {Object} msg - Incoming message with field values
 * @returns {Object} Updated state
 */
const update = function ( state, msg ) {
    // Guard: skip if disabled or paused
    if ( state.disable || state.pause ) return state;

    // Extract input value
    const xVal = msg[ state.x ];

    // Reset health flag
    state.inputValidationFailed = false;

    // Validate input (catches NaN, Infinity, undefined)
    if ( !Number.isFinite( xVal ) ) {
        state.inputValidationFailed = true;
        return state;
    }

    // Accumulate
    state.sum += xVal;

    return state;
}; // update()

export default update;

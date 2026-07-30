// nodes/invert-flag/update.js

/**
 * @fileoverview Update function for invertFlag node.
 *
 * Inverts a boolean field using JavaScript's ! operator.
 * Accepts boolean and truthy/falsy values (e.g., 0/1).
 */

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;

    // Reset on each update
    state.inputValidationFailed = false;

    const value = msg[ state.x ];

    // Handle faults gracefully: null/undefined signals missing data
    if ( value === undefined || value === null ) {
        state.inputValidationFailed = true;
        return state;
    }

    // Invert the value using JavaScript's ! operator
    // Works with booleans (true/false) and truthy/falsy values (1/0)
    state.inverted = !value;

    return state;
}; // update()

export default update;


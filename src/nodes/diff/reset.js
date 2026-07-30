/**
 * @fileoverview Reset diff node state.
 *
 * Clears the computed difference value.
 */

const reset = function ( state ) {
    state.diff = 0;
    return true;
}; // reset()

export default reset;

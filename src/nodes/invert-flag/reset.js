/**
 * @fileoverview Reset invertFlag node state.
 *
 * Clears the inverted flag back to its initial value.
 */

const reset = function ( state ) {
    state.inverted = false;
    return true;
}; // reset()

export default reset;

/**
 * Disables a node by setting its disable flag to true
 * @param {Object} state - The node's state object
 * @returns {boolean} - Always returns true for consistency with control methods
 */
const disable = function ( state ) {
    state.disable = true;
    return true;
}; // disable()

export default disable;

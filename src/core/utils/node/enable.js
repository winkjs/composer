/**
 * Enables a node by setting its disable flag to false
 * @param {Object} state - The node's state object
 * @returns {boolean} - Always returns true for consistency with control methods
 */
const enable = function ( state ) {
    state.disable = false;
    return true;
}; // enable()

export default enable;

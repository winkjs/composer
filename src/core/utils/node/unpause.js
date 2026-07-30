/**
 * Resumes a paused node — update() runs again
 * @param {Object} state - The node's state object
 * @returns {boolean} - Always returns true for consistency with control methods
 */
const unpause = function ( state ) {
    state.pause = false;
    return true;
}; // unpause()

export default unpause;

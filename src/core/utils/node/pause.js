/**
 * Pauses a node — skips update() but still runs publishTo()
 * @param {Object} state - The node's state object
 * @returns {boolean} - Always returns true for consistency with control methods
 */
const pause = function ( state ) {
    state.pause = true;
    return true;
}; // pause()

export default pause;

// nodes/csv-source/reset.js
const reset = function ( state ) {
    // Reset to initial state
    state.currentIndex = 0;
    state.lastEmitTime = 0;
    state.isPaused = false;

    // Don't clear the data - just reset the reading position
    // This allows resuming from the beginning without reloading

    return true;
}; // reset()

export default reset;

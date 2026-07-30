const getReverseChronologicalIndex = function (state, position) {
    // Validate position
    if (position < 0 || position >= state.used) return -1;

    // Calculate buffer index based on fill status
    if (state.used === state.size) {
        // Buffer full: head points to oldest, newest is at (head - 1)
        let index = state.head - 1 - position;
        // Handle wrap-around
        if (index < 0) index += state.size;
        return index;
    }

    // Buffer partial: newest is at (used - 1), oldest at 0
    return state.used - 1 - position;

}; // getReverseChronologicalIndex()

export default getReverseChronologicalIndex;

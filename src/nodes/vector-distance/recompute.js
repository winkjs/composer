// nodes/vector-distance/recompute.js

const recompute = function ( _state ) {
    // For correlation distance, there's no accumulated state to recompute
    // Each update is independent
    // This function exists for API consistency

    return true;
}; // recompute()

export default recompute;

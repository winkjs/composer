// nodes/tw-stats/recompute.js

const recompute = function () {
    // Pébay moments are computed incrementally using a numerically stable
    // algorithm. No recomputation needed (no ring buffer to reconstruct from).
    return true;
}; // recompute()

export default recompute;

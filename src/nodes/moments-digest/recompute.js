// nodes/moments-digest/recompute.js

const recompute = function () {
    // Stats digest doesn't need recomputation
    // Moments are computed incrementally using numerically stable algorithm
    return true;
}; // recompute()

export default recompute;

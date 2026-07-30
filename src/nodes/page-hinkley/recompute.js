/**
 * @fileoverview Recompute handler for Page-Hinkley — intentional no-op.
 *
 * The PHT cumulative sum depends on the entire history of observations.
 * Unlike ring-buffer nodes (es-stats, kernel), there is no stored window
 * to recompute from. The no-op is the correct implementation.
 */

const recompute = function () {
    // Page-Hinkley is inherently sequential — cannot recompute from stored values
    return true;
}; // recompute()

export default recompute;

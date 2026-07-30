// nodes/spike-guard/recompute.js

/**
 * @fileoverview Recompute for numerical stability.
 *
 * spikeGuard has no numerical drift - it only computes medians
 * and absolute differences. No accumulation that could drift.
 */

const recompute = function () {
    return true;
}; // recompute()

export default recompute;

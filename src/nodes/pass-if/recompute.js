// nodes/pass-if/recompute.js

/**
 * @fileoverview Recompute function for passIf node
 *
 * No-op — counter is a simple integer with no numerical
 * stability concerns.
 */

const recompute = function () {
    // Nothing to recompute - counter is a simple integer
    return true;
}; // recompute()

export default recompute;

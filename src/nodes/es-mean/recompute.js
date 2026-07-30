/**
 * @fileoverview Recompute handler for the esMean node (intentional no-op).
 *
 * EWMA cannot be recomputed without the full observation history. The
 * incremental update form is already numerically stable and bounded by
 * the input range, so precision drift is not a concern.
 */

const recompute = function () {
    // It cannot be recomputed without full historical data.
    // The incremental update form used is already numerically stable
    // and bounded by input range, preventing unbounded error growth.
    return true;
}; // recompute()

export default recompute;

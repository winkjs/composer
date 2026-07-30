/**
 * @fileoverview Recompute for kernel node.
 *
 * No-op — returns true. The convolution result is computed fresh from ring
 * buffer contents on every message, so there is no accumulator drift to
 * correct. Unlike recursive filters (e.g., Kalman), FIR convolution is
 * inherently stable.
 */

const recompute = function () {
    return true;
}; // recompute()

export default recompute;

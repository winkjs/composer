/**
 * @fileoverview Recompute for butterworth-filter node.
 *
 * No-op: stable 2nd-order IIR — state variables z1/z2 are bounded by
 * exponential decay. No accumulated statistics susceptible to drift.
 */

const recompute = function ( _state ) {
    // Stable 2nd-order IIR: z1/z2 bounded by exponential decay; no drift.
    return true;
}; // recompute()

export default recompute;

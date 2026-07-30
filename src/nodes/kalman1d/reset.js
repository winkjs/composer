/**
 * @fileoverview Reset for kalman1d node.
 *
 * Clears all accumulated state to pre-first-measurement condition. The next
 * valid measurement will auto-initialize the filter (xHat = z/H, P = R/H²).
 *
 * Idempotent: multiple reset() calls produce the same state as a single call.
 * Model parameters (R, Q, F, G, H, thresholds) are preserved — only the
 * estimation state is cleared.
 */

const reset = function ( state ) {
    // ── Estimation state ────────────────────────────────────────────────
    state.xHat = 0;
    state.P = 0;
    state.isInitialized = false;

    // ── Innovation outputs ──────────────────────────────────────────────
    state.innovation = 0;
    state.innovationGate = 0;

    // ── Diagnostics ─────────────────────────────────────────────────────
    state.updateCount = 0;
    state.outlierCount = 0;

    return true;
}; // reset()

export default reset;

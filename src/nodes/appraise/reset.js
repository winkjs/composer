// nodes/appraise/reset.js

/**
 * @fileoverview Resets the two-layer SNN appraise node state.
 *
 * Clears all L1 state (membranes, spikes, fired, charges, rates) and L2
 * state (membrane, combined, classification). Zeros the timestamp so the
 * next message behaves as a cold start (no decay on first message after reset).
 *
 * Preserves Theta if already calibrated — the learned baseline does not
 * change on analytical reset. Same principle as lag node ADR-008.
 * Only re-enters calibration if warmup was still in progress.
 *
 * @see ADR-004
 */

/**
 * Resets all appraise computation state to initial values.
 * Preserves l2Theta and calibrating=false if calibration was complete.
 *
 * @param {Object} state - Node state to reset
 * @returns {boolean} Always returns true (success)
 */
const reset = function ( state ) {
    // ── L1 State ────────────────────────────────────────────────────────────
    state.membranes.fill( 0 );
    state.spikes.fill( 0 );
    state.fired.fill( 0 );
    state.charges.fill( 0 );
    state.rates.fill( 0 );

    // ── L2 State ────────────────────────────────────────────────────────────
    state.l2Membrane = 0;

    // ── Calibration ─────────────────────────────────────────────────────────
    // Preserve Theta if already calibrated; reset warmup counter if still calibrating
    if ( state.calibrating ) {
        state.messageCount = 0;
    }

    // ── Combined Score & Classification ─────────────────────────────────────
    state.combined = 0;
    state.stateName = 'Normal';

    // ── Timing ──────────────────────────────────────────────────────────────
    state.lastTimestamp = 0;
    state.hasReceivedMessage = false;
    state.inputValidationFailed = false;

    return true;
}; // reset()

export default reset;

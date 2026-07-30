// nodes/appraise/calibrate.js

/**
 * @fileoverview Burn-in calibration for the L2 decision neuron's Theta parameter.
 *
 * During warmup, the system observes baseline membrane activity and derives
 * Theta such that steady-state conviction sits at c_target (monitor.at / 3).
 * Uses a deterministic sample count — same pattern as esCorrelation and trend
 * warmup (halfLifeToWarmupSamples equivalent).
 *
 * Formula: Theta = V2 * ( 1 - c_target ) / c_target
 *   When V2 = 0 at warmup end, Theta defaults to 1.0 (conservative fallback).
 */

/**
 * Computes the number of warmup messages needed for calibration.
 * Five L2 time constants ensures the membrane has reached steady-state
 * (~99.3% settled).
 *
 * @param {number} l2Tau - L2 time constant tau2
 * @param {number} messageRate - Messages per timestamp unit
 * @returns {number} Warmup sample count (integer >= 1)
 */
const computeWarmupSamples = function ( l2Tau, messageRate ) {
    return Math.max( 1, Math.ceil( 5 * l2Tau * messageRate ) );
}; // computeWarmupSamples()

/**
 * Derives the calibration target conviction from the monitor threshold.
 * Steady-state baseline should sit at one-third of the monitor threshold —
 * close enough for sensitivity, far enough to avoid false triggers.
 *
 * @param {number} monitorAt - Monitor threshold value
 * @returns {number} c_target in (0, 1)
 */
const deriveCTarget = function ( monitorAt ) {
    return monitorAt / 3;
}; // deriveCTarget()

/**
 * Checks whether calibration is complete and derives Theta if so.
 * Called once per message during the warmup phase. No-op before
 * the warmup boundary, no-op after calibration is complete.
 *
 * @param {Object} state - Node state (mutated: l2Theta, calibrating)
 */
const checkCalibration = function ( state ) {
    if ( state.messageCount < state.warmupSamples ) return;

    // Derive Theta from observed steady-state membrane potential
    const v2 = state.l2Membrane;

    if ( v2 <= 0 ) {
        // No activity during warmup — use conservative default
        state.l2Theta = 1.0;
    } else {
        // Theta = V2 * ( 1 - c_target ) / c_target
        state.l2Theta = v2 * ( ( 1 - state.cTarget ) / state.cTarget );
    }

    state.calibrating = false;
}; // checkCalibration()

export { computeWarmupSamples, deriveCTarget, checkCalibration };

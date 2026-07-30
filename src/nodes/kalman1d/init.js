/**
 * @fileoverview Initialization for kalman1d node.
 *
 * Validates the spec, resolves field-keyed parameters, computes derived
 * Kalman coefficients, and returns fully initialized state.
 *
 * **Q and R parameterization:**
 * `processVariance` is the process noise variance Q in absolute units
 * (state²). `sensorVariance` is the measurement noise variance R in
 * absolute units (measurement²). Both are independent — neither is
 * computed from the other. This matches the textbook 1-D Kalman filter
 * (Bar-Shalom, Welch & Bishop) and the upstream `winkjs/wink-statistics/
 * src/streaming-1d-kalman-filter.js` from which this node was ported.
 *
 * **Auto-initialization:**
 * State starts uninitialized (isInitialized = false). The first valid
 * measurement sets xHat = z/H and P = R/H², bootstrapping the filter
 * without requiring a prior estimate. Innovation is 0 on the first tick
 * (no prediction to compare against).
 *
 * **Variance floor (Pmin):**
 * Prevents P from collapsing to zero, which would cause the filter to
 * ignore all future measurements — a known Kalman failure mode called
 * "filter lock." Pmin = 1e-10 × R is small enough to never affect
 * normal operation but catches the degenerate case.
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { resolveScalar } from '../../core/utils/options/resolve-field-keyed.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    const state = Object.create( null );

    // ── Standard flags (all nodes) ──────────────────────────────────────
    state.inputValidationFailed = false;
    state.disable = false;
    state.pause = false;

    // ── Input field ─────────────────────────────────────────────────────
    state.x = spec.from.x;

    // ── Control input (optional) ────────────────────────────────────────
    // Any causal influence: heater power → temperature, fuel rate → tank
    // level, motor current → bearing temperature. When absent, the
    // prediction step simplifies to xPred = F·xHat (zero-control Kalman).
    state.controlField = spec.control ?? null;

    // ── Resolve field-keyed tunables (per-sensor differentiation) ────────
    const sensorVarianceSpec = resolveScalar( spec.sensorVariance, state.x );
    const processVarianceSpec = resolveScalar( spec.processVariance, state.x );
    const chi2ThresholdSpec = resolveScalar( spec.chi2Threshold, state.x );
    const controlModelSpec = resolveScalar( spec.controlModel, state.x );

    // ── Apply defaults ──────────────────────────────────────────────────
    const R = sensorVarianceSpec ?? introspect.DEFAULT_OPTIONS.sensorVariance;
    const Q = processVarianceSpec ?? introspect.DEFAULT_OPTIONS.processVariance;

    // ── Core Kalman parameters ──────────────────────────────────────────
    // State-space model: x(k+1) = F·x(k) + G·u(k) + w, z(k) = H·x(k) + v
    // Q (process noise variance) and R (measurement noise variance) are
    // independent absolute values. Q is in state² units, R in measurement².
    state.R = R;
    state.Q = Q;
    state.F = spec.stateTransition ?? introspect.DEFAULT_OPTIONS.stateTransition;
    state.G = controlModelSpec ?? introspect.DEFAULT_OPTIONS.controlModel;
    state.H = spec.measurement ?? introspect.DEFAULT_OPTIONS.measurement;

    // ── Outlier detection ───────────────────────────────────────────────
    // Innovation gate: chi-squared(1) test on (innovation²/S).
    // 6.63 = 99% confidence → 1% false alarm rate.
    state.chi2Threshold = chi2ThresholdSpec ?? introspect.DEFAULT_OPTIONS.chi2Threshold;
    state.followMode = spec.followMode ?? introspect.DEFAULT_OPTIONS.followMode;

    // ── Numerical safeguards ────────────────────────────────────────────
    const varLimit = spec.varianceLimit ?? introspect.DEFAULT_OPTIONS.varianceLimit;
    state.Pmax = varLimit * R;
    state.Pmin = 1e-10 * R;

    // ── State variables (pre-first-measurement) ─────────────────────────
    state.xHat = 0;
    state.P = 0;
    state.isInitialized = false;

    // ── Innovation outputs ──────────────────────────────────────────────
    // Always available, even on excluded outlier measurements.
    state.innovation = 0;
    state.innovationGate = 0;

    // ── Diagnostics ─────────────────────────────────────────────────────
    state.updateCount = 0;
    state.outlierCount = 0;

    // ── Output configuration ────────────────────────────────────────────
    state.stats = spec.stats;
    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;

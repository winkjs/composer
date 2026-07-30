/**
 * @fileoverview Core Kalman filter algorithm for kalman1d node (hot path).
 *
 * Implements the standard 1-D Kalman filter: predict → innovate → gate →
 * update/exclude/follow. Zero allocations — all scalar arithmetic.
 *
 * **Why innovation is stored BEFORE the gate branch:**
 *
 * Innovation (prediction error) is a measurement-space signal about reality,
 * not a filter-state signal about the filter's decision. When the filter
 * excludes an outlier, the innovation that triggered the exclusion is itself
 * valuable diagnostic information for downstream nodes:
 *
 * 1. **innovation → appraise**: "Temperature is SURPRISING given the heater
 *    power" — the Kalman model accounts for expected heating; only the
 *    UNEXPLAINED component triggers appraise conviction. Excluded outlier
 *    innovation tells appraise about a real event the filter chose to ignore.
 *
 * 2. **innovation → esStats → threshold**: Sustained mean(|innovation|)
 *    detects model mismatch. If we suppressed innovation on excluded
 *    measurements, esStats would underestimate the mismatch.
 *
 * 3. **innovation → predict (fault classification)**: Classify the PATTERN
 *    of surprises across multiple Kalman-filtered signals. Missing the
 *    outlier innovation breaks the pattern.
 *
 * 4. **ghost + innovation**: In shadow partitions running degradation
 *    scenarios, innovation grows as the perturbation diverges from the
 *    real model — enabling data-driven prognosis without a physics model.
 *
 * 5. **Signed innovation + control direction**: "Positive innovation with
 *    negative control input = external heat source" — directional
 *    diagnostics require the raw signed innovation even on excluded ticks.
 *
 * References:
 * - Bar-Shalom, Li, Kirubarajan, "Estimation with Applications to Tracking
 *   and Navigation" (Wiley, 2001), Ch. 5: 1-D Kalman filter, innovation gate.
 * - Mahalanobis distance ≡ |innovation|/√S; innovationGate = D² ~ χ²(1).
 */

const DENORMAL_THRESHOLD = 1e-30;

const update = function ( state, msg ) {
    // ── Guard ───────────────────────────────────────────────────────────
    if ( state.disable || state.pause ) return state;

    const z = msg[ state.x ];

    // Reset health flag on each update
    state.inputValidationFailed = false;

    // ── Fault handling: NaN, Infinity, undefined ────────────────────────
    // Missing data → prediction-only: covariance grows (via the predict
    // step on the next valid measurement), innovation is NaN downstream.
    if ( !Number.isFinite( z ) ) {
        state.inputValidationFailed = true;
        return state;
    }

    // ── Control input (optional, defaults to 0) ─────────────────────────
    // When absent or invalid, no control influence this tick.
    // "Control" = any measurable causal influence, not just actuators:
    // fuel rate → tank level, occupancy → CO₂, current → temperature.
    const u = state.controlField ? ( msg[ state.controlField ] ?? 0 ) : 0;
    const uSafe = Number.isFinite( u ) ? u : 0;

    // ── Auto-initialize from first measurement ──────────────────────────
    // No prior estimate needed: x₀ = z/H, P₀ = R/H².
    // Innovation is 0 (no prediction to compare against).
    if ( !state.isInitialized ) {
        state.xHat = z / state.H;
        state.P = state.R / ( state.H * state.H );
        state.innovation = 0;
        state.innovationGate = 0;
        state.isInitialized = true;
        state.updateCount += 1;
        return state;
    }

    // ── PREDICT ─────────────────────────────────────────────────────────
    // State prediction:  x̂(k|k-1) = F·x̂(k-1) + G·u(k)
    // Covariance prediction: P(k|k-1) = F·P(k-1)·F + Q
    const xPred = ( state.F * state.xHat ) + ( state.G * uSafe );
    let PPred = ( state.F * state.P * state.F ) + state.Q;

    // Clamp covariance to valid range
    if ( PPred > state.Pmax ) PPred = state.Pmax;
    if ( PPred < state.Pmin ) PPred = state.Pmin;

    // ── INNOVATE (always computed, always stored) ───────────────────────
    // Innovation: ν = z - H·x̂(k|k-1)
    // Innovation covariance: S = H·P(k|k-1)·H + R
    // Innovation gate: ν²/S ~ χ²(1) when model is correct
    const innovation = z - ( state.H * xPred );
    const S = ( state.H * PPred * state.H ) + state.R;
    const innovationGate = ( innovation * innovation ) / S;

    // Store BEFORE branching — downstream always sees what reality
    // looked like, regardless of the filter's gate decision.
    state.innovation = innovation;
    state.innovationGate = innovationGate;

    // ── OUTLIER GATE ────────────────────────────────────────────────────
    // Mahalanobis distance² > χ²(1) threshold → statistically unlikely
    if ( innovationGate > state.chi2Threshold ) {
        state.outlierCount += 1;

        if ( state.followMode ) {
            // Follow mode: reset estimate to track the jump.
            // Use case: systems with legitimate step changes (valve
            // positions, load changes, operating mode switches).
            state.xHat = z / state.H;
            state.P = state.R / ( state.H * state.H );
        } else {
            // Exclude mode: reject measurement, advance with prediction.
            // Time marches on — xHat and P reflect the predict-only state.
            // Innovation IS published (stored above) so downstream sees
            // the anomalous measurement even though the filter ignored it.
            // Use case: continuous processes where outliers are sensor
            // glitches (temperature, pressure, tank level).
            state.xHat = xPred;
            state.P = PPred;
            state.updateCount += 1;
            return state;
        }
    } else {
        // ── NORMAL KALMAN UPDATE ────────────────────────────────────
        // Kalman gain: K = P(k|k-1)·H / S
        // State update: x̂(k) = x̂(k|k-1) + K·ν
        // Covariance update: P(k) = (1 - K·H)·P(k|k-1)
        const K = ( PPred * state.H ) / S;
        state.xHat = xPred + ( K * innovation );
        state.P = ( 1 - ( K * state.H ) ) * PPred;
    }

    // ── Denormal flushing ───────────────────────────────────────────────
    // Prevents 100x slowdown on x86/ARM when P approaches zero.
    if ( Math.abs( state.P ) < DENORMAL_THRESHOLD ) state.P = 0;

    state.updateCount += 1;
    return state;
}; // update()

export default update;

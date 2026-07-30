/**
 * @fileoverview Recompute for kalman1d node.
 *
 * Clamps the estimation error covariance P to [Pmin, Pmax]. The update()
 * function already clamps after prediction, but recompute provides a periodic
 * safety net for very long-running pipelines where floating-point drift could
 * push P outside its valid bounds.
 *
 * Unlike butterworth-filter (which is a no-op), Kalman's recompute is active
 * because the covariance evolves recursively and is susceptible to long-term
 * drift in edge cases (e.g., extended prediction-only periods with near-zero
 * process noise).
 */

const recompute = function ( state ) {
    // Clamp covariance to valid range
    if ( state.P > state.Pmax ) state.P = state.Pmax;
    if ( state.P < state.Pmin ) state.P = state.Pmin;

    return true;
}; // recompute()

export default recompute;

/**
 * @fileoverview Leaky envelope follower with fast-attack / slow-release
 * semantics for the esStats node.
 *
 * New extremes are adopted immediately (fast attack); non-extreme values
 * relax floor/ceiling toward the current value at rate alpha (slow release).
 * Computes envelope width (ceiling - floor), midpoint, and envScore
 * (normalized distance from midpoint, unclamped to preserve severity).
 *
 * Zero allocations; all reads/writes via the pre-allocated state object.
 */
// nodes/es-stats/update-envelope.js

const updateEnvelope = function ( state, xVal ) {
    // Envelope Score: Normalized distance from range midpoint
    // Score = (value - mid) / halfRange; 0=center, ±1=bounds, >1=outside
    // Computed BEFORE update to detect range breakouts
    // Unclamped to preserve severity (e.g., score=3 means 3x beyond normal)
    if ( state.stats.envScore ) {
        const halfEnv = state.envelope * 0.5;
        state.envScore = ( halfEnv > state.EPS ) ?
            ( ( xVal - state.mid ) / halfEnv ) : 0;
        // optional clamp:
        // state.envScore = Math.max( -1, Math.min( 1, state.envScore ) );
    }

    // NOW update envelope with fast-attack/slow-release
    if ( xVal < state.floor ) {
        state.floor = xVal;
    } else {
        state.floor += ( state.alpha * ( xVal - state.floor ) );
    }

    if ( xVal > state.ceiling ) {
        state.ceiling = xVal;
    } else {
        state.ceiling -= ( state.alpha * ( state.ceiling - xVal ) );
    }

    state.envelope = state.ceiling - state.floor;
    state.mid = ( state.floor + state.ceiling ) * 0.5;
}; // updateEnvelope()

export default updateEnvelope;

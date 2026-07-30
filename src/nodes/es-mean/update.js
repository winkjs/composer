/**
 * @fileoverview Hot-path EWMA computation for the esMean node.
 *
 * Applies the numerically stable incremental form: esmValue += α·(x − esmValue).
 * When adaptive half-life is enabled, alpha is modulated per-message based on
 * surprise — |innovation| relative to a MAD-estimated σ (σ ≈ 1.2533·E[|inno|],
 * the normal-equivalence relation). A bounded boost keeps alpha within [base, 0.95],
 * preventing degeneration to passthrough. Zero allocations; all reads from state.
 */

// Sensible fixed constants (hot path reads only)
const adaptGain = 0.2;     // sensitivity of alpha to surprise (bounded map)
const epsilon = 1e-12;     // numerical floor

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    const xVal = msg[ state.x ];
    // Reset on each update
    state.inputValidationFailed = false;
    // Handle faults gracefully: ensure their isolation
    if ( !Number.isFinite( xVal ) ) {
        // Signals publishing NaN for all demanded `stats` in publishTo.
        state.inputValidationFailed = true;
        return state;
    }

    if ( state.isInitialized ) {
        // Optional adaptive half-life
        if ( state.adaptiveHalfLife ) {
            // Innovation relative to current estimate
            const innovation = xVal - state.esmValue;

            // Exponential smoothing of |innovation| (MAD-ish); using precomputed alpha for hot path
            const absInnovation = Math.abs( innovation );
            state.esAbsInnovation = ( state.esAbsInnovation === null ) ?
                absInnovation :
                state.esAbsInnovation + ( state.madAlpha * ( absInnovation - state.esAbsInnovation ) );

            // σ ≈ 1.2533 * E[ |innovation| ] (normal equivalence), robust & sqrt-free
            const sigma = ( 1.2533 * state.esAbsInnovation ) + epsilon;

            // Surprise (unitless)
            const z = Math.abs( innovation ) / sigma;

            // Bounded boost of alpha: base * ( 1 + gain * z / ( 1 + z ) )
            const targetAlpha = state.alpha * ( 1 + ( adaptGain * ( z / ( 1 + z ) ) ) );

            // Preserve Exponential smoothing behavior (never degenerate to passthrough)
            state.currentAlpha = ( targetAlpha > 0.95 ) ? 0.95 : targetAlpha;
        }

        // Numerically stable update
        state.esmValue += state.currentAlpha * ( xVal - state.esmValue );
    } else {
        // Initialize
        state.esmValue = xVal;
        state.isInitialized = true;

        // Initialize MAD tracker lazily when adaptive is enabled
        if ( state.adaptiveHalfLife ) {
            state.esAbsInnovation = 0;
        }
    }

    state.lastValue = xVal;
    return state;
}; // update()

export default update;

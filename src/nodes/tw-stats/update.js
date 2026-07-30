// nodes/tw-stats/update.js

/**
 * @fileoverview TW Stats Update — Pébay incremental moment accumulation
 * with selective tier gating and tumbling window management.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Execution Flow (per message)
 *
 * 1) Prelude
 *    • Clear planPublish from last tick.
 *    • If flush is latched and n > 0: snapshot → planPublish → reset.
 *      The current message becomes the first sample of the next window.
 *
 * 2) Core update
 *    • Guard: disabled, invalid input (skip and return).
 *    • Pébay accumulation with tier gates (maxMoment 1–4).
 *    • Critical: update order is M4 → M3 → M2 → M1 because each
 *      formula uses the previous values of lower moments.
 *
 * 3) Epilogue
 *    • Increment valid sample counter.
 *    • If window complete and no flush snapshot already planned:
 *      snapshot → planPublish → reset.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Invalid input handling
 *    • Non-finite samples are skipped (not counted).
 *    • currentCount only increments on valid samples.
 *    • A flush snapshot planned in prelude still publishes this tick.
 *
 * ────────────────────────────────────────────────────────────────────────
 * References
 * [1] Pébay, P. (2008). Formulas for robust, one-pass parallel computation
 *     of covariances and arbitrary-order statistical moments.
 *     Sandia Report SAND2008-6212.
 */

/* eslint-disable camelcase */
import { copyFrom } from './copy-from.js';
import reset from './reset.js';

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;

    // ── Prelude ─────────────────────────────────────────────────────────
    state.planPublish = false;

    if ( state.flushLatched ) {
        if ( state.n > 0 ) {
            copyFrom( state, state.snapshot );
            state.planPublish = true;
            reset( state );
        }
        state.flushLatched = false;
    }

    // ── Core update ─────────────────────────────────────────────────────
    state.inputValidationFailed = false;

    const xVal = msg[ state.x ];

    if ( !Number.isFinite( xVal ) ) {
        state.inputValidationFailed = true;
        return state;
    }

    // Pébay single-value update with selective tier gating
    const n1 = state.n;
    state.n += 1;

    const delta = xVal - state.M1;
    const delta_n = delta / state.n;
    const delta_n2 = delta_n * delta_n;
    const term1 = delta * delta_n * n1;

    // Update order: M1, then M4 → M3 → M2 (matches momentsDigest).
    // M4 and M3 formulas use the previous values of M2 and M3;
    // none depend on M1 (delta_n is already computed from old M1).
    state.M1 += delta_n;

    if ( state.maxMoment >= 4 ) {
        state.M4 += ( term1 * delta_n2 * ( ( state.n * state.n ) - ( 3 * state.n ) + 3 ) ) +
                    ( 6 * delta_n2 * state.M2 ) - ( 4 * delta_n * state.M3 );
    }

    if ( state.maxMoment >= 3 ) {
        state.M3 += ( term1 * delta_n * ( state.n - 2 ) ) - ( 3 * delta_n * state.M2 );
    }

    if ( state.maxMoment >= 2 ) {
        state.M2 += term1;
    }

    // Min/max tracking
    if ( state.needsMinMax ) {
        if ( xVal < state.min ) state.min = xVal;
        if ( xVal > state.max ) state.max = xVal;
    }

    // ── Epilogue ────────────────────────────────────────────────────────
    state.currentCount += 1;

    if ( ( state.currentCount >= state.windowSize ) && !state.planPublish ) {
        copyFrom( state, state.snapshot );
        state.planPublish = true;
        reset( state );
    }

    return state;
}; // update()

export default update;

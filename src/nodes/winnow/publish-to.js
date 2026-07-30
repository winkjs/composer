/**
 * @fileoverview Publish winnow outputs to the message.
 *
 * Copies deviation, predicted, and significant to the message for
 * downstream consumption. All three are always computed by update()
 * — publishTo iterates only over stats the user configured.
 *
 * When input validation has failed, publishes NaN for numeric stats
 * and false for significant — downstream nodes see invalid data,
 * not stale values.
 */

import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;

    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    const stats = state.stats;

    if ( stats.deviation ) {
        msg[ stats.deviation.storeAs ] = state.deviation;
    }

    if ( stats.predicted ) {
        msg[ stats.predicted.storeAs ] = state.predicted;
    }

    if ( stats.significant ) {
        msg[ stats.significant.storeAs ] = state.significant;
    }

    // ── Buffer-backed stats (conditional on gate-fire keep) ─────────
    // xPrev/tPrev are published as the buffered (k-1) values only when
    // the current sample was kept by Check 2 (chi-squared gate fire).
    // On non-gate keeps and on non-kept messages, they publish NaN —
    // signalling "no lookback anchor for this sample." This prevents
    // noisy non-gate prevValues from degrading the kfSmoothed trajectory.
    if ( state.hasXPrev ) {
        msg[ stats.xPrev.storeAs ] = state.keptByGate ? state.xPrev : NaN;
    }
    if ( state.hasTPrev ) {
        msg[ stats.tPrev.storeAs ] = state.keptByGate ? state.tPrev : NaN;
    }
}; // publishTo()

export default publishTo;

// @fileoverview
// publish-to.js — copy computed completion fields to the output message.
//
// Follows the momentsDigest output-scrubbing convention: on non-completion
// ticks, detail fields (birthValue, birthLag, persistence) are explicitly
// set to `undefined` — not left as stale values from a previous tick. This
// prevents downstream nodes from acting on outdated event data.
//
// The completion booleans (dipCompleted, peakCompleted) are always published
// so downstream can branch on them. Diagnostic fields (swingsThisTick,
// swingRate) are always published when the window is full.
//
// Guard order (per ADR-004):
//   1. disable → skip entirely (node invisible downstream)
//   2. inputValidationFailed → publishNaN for all stats (fault isolation)
//   3. isNotFull → skip (warmup, no meaningful output yet)

import { isNotFull } from '../../windowing/count-sliding/index.js';
import { publishNaN } from '../../core/utils/node/index.js';

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;

    if ( state.inputValidationFailed ) {
        publishNaN( state, msg );
        return;
    }

    // Do not publish during warmup (window not yet full)
    if ( isNotFull( state.ring ) ) return;

    const s = state.stats;

    // ── Completion booleans (always published) ────────────────
    if ( s.dipCompleted )  msg[ s.dipCompleted.storeAs ]  = state.dipCompleted;
    if ( s.peakCompleted ) msg[ s.peakCompleted.storeAs ] = state.peakCompleted;

    // ── Dip detail fields (scrubbed to undefined on non-completion ticks) ─
    if ( s.dipValue ) msg[ s.dipValue.storeAs ] = state.dipCompleted ? state.dipValue : undefined;
    if ( s.dipLag )   msg[ s.dipLag.storeAs ]   = state.dipCompleted ? state.dipLag   : undefined;
    if ( s.dipSize )  msg[ s.dipSize.storeAs ]  = state.dipCompleted ? state.dipSize  : undefined;

    // ── Peak detail fields (scrubbed to undefined on non-completion ticks) ─
    if ( s.peakValue ) msg[ s.peakValue.storeAs ] = state.peakCompleted ? state.peakValue : undefined;
    if ( s.peakLag )   msg[ s.peakLag.storeAs ]   = state.peakCompleted ? state.peakLag   : undefined;
    if ( s.peakSize )  msg[ s.peakSize.storeAs ]  = state.peakCompleted ? state.peakSize  : undefined;

    // ── Diagnostics (always published when window is full) ───
    if ( s.swingsThisTick ) msg[ s.swingsThisTick.storeAs ] = state.swingsThisTick;
    if ( s.swingRate )      msg[ s.swingRate.storeAs ]      = state.swingRate;
}; // publishTo()

export default publishTo;

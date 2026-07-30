// @fileoverview
// reset.js — idempotent reset per ADR-004.
//
// Clears the ring buffer, all pair storage (current and previous tick),
// completion event slots, and diagnostic counters. After reset, the node
// re-enters the warmup phase (isNotFull returns true) and will not publish
// until the window fills again.
//
// Multiple calls produce the same state as a single call (idempotent).

import { reset as resetRing } from '../../windowing/count-sliding/index.js';

const reset = function ( state ) {
    // Clear the ring buffer — head, used, and buffer contents all zeroed
    resetRing( state.ring );

    // Clear current tick's pair counts (typed arrays contents are irrelevant
    // when count is 0 — no need to zero the arrays themselves)
    state.minPairCount = 0;
    state.maxPairCount = 0;

    // Clear previous tick's pair counts (forces fresh diff on next tick —
    // all pairs in the first full-window tick will appear as "new")
    state.prevMinPairCount = 0;
    state.prevMaxPairCount = 0;

    // Clear the accounted-emission flags (exactly-once rule c) — after a
    // reset every vertex of the refilled window may emit afresh
    state.minEmitFlag.fill( 0 );
    state.maxEmitFlag.fill( 0 );

    // Clear completion event slots
    state.dipCompleted  = false;
    state.peakCompleted = false;
    state.dipValue      = NaN;
    state.peakValue     = NaN;
    state.dipLag        = 0;
    state.peakLag       = 0;
    state.dipSize       = NaN;
    state.peakSize      = NaN;

    // Clear diagnostics
    state.received       = 0;
    state.emitted        = 0;
    state.swingsThisTick = 0;
    state.swingRate      = 0;

    // Clear health and tunable error flags
    state.inputValidationFailed = false;
    state.tunableErrorLogged    = false;

    return true;
}; // reset()

export default reset;

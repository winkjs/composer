// @fileoverview
// recompute.js — re-establish numerical ground truth per ADR-004.
//
// Unlike incremental-accumulator nodes (esMean, swStats) where floating-point
// drift can compound over millions of updates, swingWatch recomputes the
// entire persistence diagram from scratch on every tick (the windowed batch
// sweep sorts and sweeps the full window). There is no accumulated state that
// can drift.
//
// The only action needed is to clear the previous-tick pair storage, which
// forces the next tick's diff to re-derive every current pair as unmatched.
// The accounted-emission flags (exactly-once rule c in update.js) survive
// recompute deliberately: every re-derived pair's birth vertex is still
// flagged as accounted, so recompute causes no spurious re-emission burst.

const recompute = function ( state ) {
    state.prevMinPairCount = 0;
    state.prevMaxPairCount = 0;
    return true;
}; // recompute()

export default recompute;

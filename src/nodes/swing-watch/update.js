// @fileoverview
// update.js — hot path for swingWatch.
//
// ## What this file does
//
// On each new sample, this function maintains a sliding window (ring buffer)
// of the last W samples, then ranks every local extremum inside that window
// by its **topological persistence** — the peak-to-trough amplitude required
// to "kill" the feature. Only NEWLY-APPEARED persistence pairs (compared to
// the previous tick's diagram) are emitted as completion events. This design
// ensures downstream nodes like `appraise` see each significant event exactly
// once, on the tick it first becomes resolvable.
//
// ## Algorithm — Huber/Persistence1D, windowed batch
//
// The algorithm is the standard 1D sublevel-set persistence sweep, originally
// described for peak detection by Stefan Huber and implemented in Persistence1D
// by Kozlov & Weinkauf. It proceeds in three stages:
//
//   1. SORT the window's sample indices by value (ascending for minima,
//      descending for maxima). This defines the order in which a rising
//      "water level" sweeps through the signal.
//
//   2. SWEEP through the sorted indices. Each sample either:
//      - Seeds a new connected component (if neither neighbour is processed)
//      - Extends an existing component (if exactly one neighbour is processed)
//      - Merges two components (if both neighbours are processed) — this is
//        the "killing" event. The Elder Rule determines which component dies:
//        the one whose birth value is HIGHER (= younger in the sublevel sweep).
//        Persistence = merge height − dying component's birth value.
//
//   3. DIFF the resulting persistence diagram against the previous tick's
//      diagram. Pairs that appear for the first time are emitted as completion
//      events. Pairs that were already present (same physical samples, shifted
//      by one in the window) are suppressed — and so are pairs minted by
//      either window boundary (eviction re-formations at the left edge,
//      provisional in-progress extrema at the right edge). See Section 3
//      for the four suppression rules that guard the exactly-once contract.
//
// For maxima detection, the same algorithm runs on the negated signal — but
// instead of negating and re-sorting, we iterate the SAME sorted indices in
// reverse order (descending value = ascending in −f) and flip the Elder Rule.
//
// ## Performance
//
// - Complexity: O(W log W) per tick, dominated by the sort. V8's Timsort on
//   a nearly-sorted array (one element changed per tick) approaches O(W).
//   The union-find sweep is O(W α(W)) ≈ O(W).
// - At W=100 on M4 Max: ~11 µs/tick. On RPi (est. 6× slower): ~66 µs/tick.
//   Headroom: 15K msg/sec on RPi, vs WiFi's 0.33 msg/sec or SCADA's 50.
//
// ## Zero allocation
//
// Every typed array is pre-allocated in init.js. This file creates no objects,
// arrays, or strings in the hot path. The single module-level object `mergeResult` is
// allocated once at import time and rewritten in-place on each merge — safe
// because the sweep is single-threaded and synchronous.
//
// ## References
//
//   Huber, S. "Persistent Topology for Peak Detection."
//     https://www.sthu.org/blog/13-perstopology-peakdetection/index.html
//   Edelsbrunner, Letscher & Zomorodian (2002). "Topological Persistence
//     and Simplification." Discrete & Computational Geometry, 28, 511–533.
//   Kozlov & Weinkauf (2014). Persistence1D.
//     https://github.com/weinkauf/Persistence1D

import { push, isNotFull } from '../../windowing/count-sliding/index.js';


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: UNION-FIND
//
// The union-find (disjoint-set) data structure tracks connected components
// during the sweep. Each component is identified by a representative vertex.
// The representative carries the component's "birth value" — the value of
// the deepest local extremum that seeded it.
//
// Three parallel typed arrays (pre-allocated in init):
//   ufParent[i]   — parent pointer (self-referential for roots)
//   ufBirthVal[i] — birth value of the component rooted at i
//   ufBirthIdx[i] — birth index of the component rooted at i
//
// Path compression in find() ensures amortized near-O(1) per operation.
// No allocation: find() and merge write only to the pre-allocated arrays.
// ═══════════════════════════════════════════════════════════════════════════

// Module-level merge result object. Allocated once at import time, rewritten
// in-place by mergeSublevel/mergeSuperlevel. The caller reads the fields
// immediately before any subsequent merge call could overwrite them.
const mergeResult = { diedBirthVal: 0, diedBirthIdx: 0, persistence: 0, merged: false };

// Find the representative of the component containing vertex i.
// Uses path compression: after find(), every vertex on the path points
// directly to the root, making subsequent finds O(1).
const find = function ( parent, i ) {
    let r = i;
    while ( parent[ r ] !== r ) r = parent[ r ];
    // Compress: point every visited node directly to root
    let c = i;
    while ( parent[ c ] !== r ) {
        const next = parent[ c ];
        parent[ c ] = r;
        c = next;
    }
    return r;
}; // find()

// Merge two components WITHOUT emitting a persistence pair.
// Used for the "extension" case: when the current vertex has exactly one
// processed neighbour, it simply joins that neighbour's component. No
// component dies, so no pair is emitted.
//
// The Elder Rule still applies to decide which representative survives.
// For sublevel (ascending): lower birth value = older = survives.
// For superlevel (descending): higher birth value = older = survives.
// Ties are broken by birth index: earlier (smaller index) survives.

// Sublevel extension: higher birth value dies (younger in ascending sweep).
// Called as (p, p±1) from sweepMin. Only the `bVal[ra] > bVal[rb]` branch
// and the plateau tie-break's `bIdx[ra] > bIdx[rb]` branch fire in 1D:
//   - ra = current vertex p (being processed), bVal[ra] = f(p).
//   - rb = already-processed neighbor's root, bVal[rb] ≤ f(p).
//   - Equal values only on plateaus, where extension always goes left-to-right
//     (sublevel sorts ascending by idx within ties), so bIdx[ra]=p > bIdx[rb].
const mergeNoEmitSub = function ( parent, birthVal, birthIdx, a, b ) {
    const ra = find( parent, a );
    const rb = find( parent, b );

    /* c8 ignore next -- defensive: left and right components are spatially disjoint in 1D sweep, so ra !== rb */
    if ( ra === rb ) return;
    if ( birthVal[ ra ] > birthVal[ rb ] ) {
        parent[ ra ] = rb;

    /* c8 ignore next 2 -- defensive: in 1D sublevel sweep, current vertex always has bVal ≥ processed neighbor's bVal */
    } else if ( birthVal[ rb ] > birthVal[ ra ] ) {
        parent[ rb ] = ra;
    } else if ( birthIdx[ ra ] > birthIdx[ rb ] ) {
        parent[ ra ] = rb;

    /* c8 ignore next 3 -- defensive: sublevel plateau extension always has bIdx[ra]=p > bIdx[rb] */
    } else {
        parent[ rb ] = ra;
    }
}; // mergeNoEmitSub()

// Superlevel extension: lower birth value dies (younger in descending sweep).
// Called as (p, p±1) from sweepMax, which iterates sortedIndices backward.
// Only the `bVal[ra] < bVal[rb]` branch and the plateau tie-break's ELSE
// branch fire in 1D:
//   - Current vertex always has bVal ≤ processed neighbor.
//   - Equal values only on plateaus, where backward iteration makes highest
//     idx the seed; subsequent lower-idx extensions go right, giving
//     bIdx[ra]=p < bIdx[rb].
const mergeNoEmitSup = function ( parent, birthVal, birthIdx, a, b ) {
    const ra = find( parent, a );
    const rb = find( parent, b );

    /* c8 ignore next -- defensive: left and right components are spatially disjoint in 1D sweep */
    if ( ra === rb ) return;
    if ( birthVal[ ra ] < birthVal[ rb ] ) {
        parent[ ra ] = rb;

    /* c8 ignore next 3 -- defensive: in 1D superlevel sweep, current vertex always has bVal ≤ processed neighbor's bVal */
    } else if ( birthVal[ rb ] < birthVal[ ra ] ) {
        parent[ rb ] = ra;

    /* c8 ignore next 3 -- defensive: superlevel plateau extension always has bIdx[ra]=p < bIdx[rb] (backward iteration) */
    } else if ( birthIdx[ ra ] > birthIdx[ rb ] ) {
        parent[ ra ] = rb;
    } else {
        parent[ rb ] = ra;
    }
}; // mergeNoEmitSup()

// Merge two components WITH pair emission — SUBLEVEL sweep (ascending).
//
// This is called at a "merge point" where both neighbours of the current
// vertex are already processed. Two distinct components meet for the first
// time. The Elder Rule kills the younger component (higher birth value).
// The dying component's birth is paired with the current vertex (the merge
// height). Persistence = mergeHeight − dyingBirthValue.
//
// The result is written to the module-level mergeResult object (no allocation).
const mergeSublevel = function ( parent, birthVal, birthIdx, a, b, h ) {
    const ra = find( parent, a );
    const rb = find( parent, b );

    /* c8 ignore next 4 -- defensive: LEFT and RIGHT components are disjoint in 1D before this merge point p, so ra !== rb */
    if ( ra === rb ) {
        mergeResult.merged = false;
        return;
    }
    let loser;
    let winner;
    if ( birthVal[ ra ] > birthVal[ rb ] ) {
        loser = ra;
        winner = rb;
    } else if ( birthVal[ rb ] > birthVal[ ra ] ) {
        loser = rb;
        winner = ra;

    /* c8 ignore next 3 -- defensive: ra roots the LEFT component (bIdx in [0, p-1]), rb roots the RIGHT (bIdx in [p+1, W-1]), so bIdx[ra] < bIdx[rb] always */
    } else if ( birthIdx[ ra ] > birthIdx[ rb ] ) {
        loser = ra;
        winner = rb;
    } else {
        loser = rb;
        winner = ra;
    }
    mergeResult.diedBirthVal = birthVal[ loser ];
    mergeResult.diedBirthIdx = birthIdx[ loser ];
    mergeResult.persistence = h - birthVal[ loser ];
    mergeResult.merged = true;
    parent[ loser ] = winner;
}; // mergeSublevel()

// Merge two components WITH pair emission — SUPERLEVEL sweep (descending).
//
// Symmetric to sublevel: here we sweep from the highest value downward
// (equivalently, we run a sublevel sweep on the negated signal). The Elder
// Rule is flipped: the component with the LOWER birth value (= younger in
// the descending sweep, born later as the water drains) dies.
// Persistence = dyingBirthValue − mergeHeight (positive because birth > merge).
const mergeSuperlevel = function ( parent, birthVal, birthIdx, a, b, h ) {
    const ra = find( parent, a );
    const rb = find( parent, b );

    /* c8 ignore next 4 -- defensive: LEFT and RIGHT components are disjoint in 1D before this merge point p, so ra !== rb */
    if ( ra === rb ) {
        mergeResult.merged = false;
        return;
    }
    let loser;
    let winner;
    // Descending sweep: higher birthVal = older. Lower birthVal dies.
    if ( birthVal[ ra ] < birthVal[ rb ] ) {
        loser = ra;
        winner = rb;
    } else if ( birthVal[ rb ] < birthVal[ ra ] ) {
        loser = rb;
        winner = ra;

    /* c8 ignore next 3 -- defensive: ra roots the LEFT component (bIdx in [0, p-1]), rb roots the RIGHT (bIdx in [p+1, W-1]), so bIdx[ra] < bIdx[rb] always */
    } else if ( birthIdx[ ra ] > birthIdx[ rb ] ) {
        loser = ra;
        winner = rb;
    } else {
        loser = rb;
        winner = ra;
    }
    mergeResult.diedBirthVal = birthVal[ loser ];
    mergeResult.diedBirthIdx = birthIdx[ loser ];
    mergeResult.persistence = birthVal[ loser ] - h;
    mergeResult.merged = true;
    parent[ loser ] = winner;
}; // mergeSuperlevel()


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: PERSISTENCE SWEEPS
//
// Two sweep functions: sweepMin (sublevel, detects significant local minima)
// and sweepMax (superlevel, detects significant local maxima).
//
// Both follow the same structure — the Huber/Persistence1D algorithm:
//
//   For each vertex p in sorted order:
//     Check which of its immediate neighbours (p-1, p+1) are already
//     processed. Four cases:
//
//     NEITHER processed → p seeds a new component. Its birth value is f(p).
//
//     ONE processed → p extends that neighbour's component. No pair is
//       emitted because no two distinct components are meeting.
//
//     BOTH processed → p is a merge point where two components meet. First
//       extend p into the left component (mergeNoEmit), then merge the
//       combined left+p component with the right component (merge with emit).
//       The second merge produces the persistence pair.
//
// sweepMin iterates sortedIndices forward (ascending value).
// sweepMax iterates sortedIndices backward (descending value) — this is
// equivalent to sorting by −f ascending, without negating or re-sorting.
// The union-find arrays (ufParent, ufBirthVal, ufBirthIdx) and processed
// flags are cleared between the two sweeps and reused.
//
// Pairs whose persistence < threshold (eps) are filtered in-place. Surviving
// pairs are stored in the pre-allocated state.min*Arr / state.max*Arr typed
// arrays (parallel arrays instead of object arrays — zero allocation).
// ═══════════════════════════════════════════════════════════════════════════

// Sublevel sweep — detects significant local MINIMA.
// A local minimum is "born" when the water level first touches it (its value
// is the birth). It "dies" when the rising water level connects it to an
// older (deeper) minimum at a local maximum between them (the merge height).
// Persistence = merge height − birth value = amplitude of the oscillation
// this minimum participates in.
const sweepMin = function ( state, lin, W, eps ) {
    const sorted    = state.sortedIndices;
    const parent    = state.ufParent;
    const bVal      = state.ufBirthVal;
    const bIdx      = state.ufBirthIdx;
    const processed = state.processed;

    processed.fill( 0 );
    state.minPairCount = 0;

    for ( let k = 0; k < W; k += 1 ) {
        const p  = sorted[ k ];
        const fP = lin[ p ];

        // Check which neighbours are already in the processed set
        const leftOK  = p > 0 && processed[ p - 1 ] === 1;
        const rightOK = p < ( W - 1 ) && processed[ p + 1 ] === 1;

        // Initialize this vertex as its own component in the union-find
        parent[ p ] = p;
        bVal[ p ]   = fP;
        bIdx[ p ]   = p;

        if ( !leftOK && !rightOK ) {
            // SEED: no processed neighbours → new component born at f(p).
            // Nothing to merge. The component will grow as neighbours are
            // processed later in the sweep.
        } else if ( leftOK && !rightOK ) {
            // EXTEND LEFT: only the left neighbour is processed. p joins
            // that component. No second component is involved, so no pair.
            mergeNoEmitSub( parent, bVal, bIdx, p, p - 1 );
        } else if ( !leftOK && rightOK ) {
            // EXTEND RIGHT: symmetric to extend-left.
            mergeNoEmitSub( parent, bVal, bIdx, p, p + 1 );
        } else {
            // MERGE: both neighbours are processed. Two distinct components
            // meet at p. First extend p into the left component (no pair),
            // then merge the combined {left ∪ p} with the right component.
            // The second merge is where the Elder Rule applies and the
            // dying component's pair is recorded.
            mergeNoEmitSub( parent, bVal, bIdx, p, p - 1 );
            mergeSublevel( parent, bVal, bIdx, p, p + 1, fP );
            if ( mergeResult.merged && mergeResult.persistence >= eps ) {
                const i = state.minPairCount;
                if ( i < state.maxPairs ) {
                    state.minBirthValArr[ i ] = mergeResult.diedBirthVal;
                    state.minBirthIdxArr[ i ] = mergeResult.diedBirthIdx;
                    state.minDeathValArr[ i ] = fP;
                    state.minDeathIdxArr[ i ] = p;
                    state.minPersArr[ i ]     = mergeResult.persistence;
                    state.minPairCount = i + 1;
                }
            }
        }
        processed[ p ] = 1;
    }
}; // sweepMin()

// Superlevel sweep — detects significant local MAXIMA.
// Symmetric to sweepMin but iterates in REVERSE through sortedIndices
// (descending value = the water level dropping from above). A local maximum
// is "born" when the draining water first exposes it. It "dies" when the
// water drops low enough to connect it to an older (higher) maximum.
// Persistence = birth value − merge height.
//
// Implementation note: instead of negating the signal and re-sorting, we
// reuse the same ascending sort and iterate backward. This halves the sort
// cost and avoids allocating a negated copy of the signal. The Elder Rule
// comparison is flipped (lower birth dies), and persistence is computed as
// birthVal − h (instead of h − birthVal) to keep it positive.
const sweepMax = function ( state, lin, W, eps ) {
    const sorted    = state.sortedIndices;
    const parent    = state.ufParent;
    const bVal      = state.ufBirthVal;
    const bIdx      = state.ufBirthIdx;
    const processed = state.processed;

    processed.fill( 0 );
    state.maxPairCount = 0;

    for ( let k = W - 1; k >= 0; k -= 1 ) {
        const p  = sorted[ k ];
        const fP = lin[ p ];

        const leftOK  = p > 0 && processed[ p - 1 ] === 1;
        const rightOK = p < ( W - 1 ) && processed[ p + 1 ] === 1;

        parent[ p ] = p;
        bVal[ p ]   = fP;
        bIdx[ p ]   = p;

        if ( !leftOK && !rightOK ) {
            // SEED
        } else if ( leftOK && !rightOK ) {
            mergeNoEmitSup( parent, bVal, bIdx, p, p - 1 );
        } else if ( !leftOK && rightOK ) {
            mergeNoEmitSup( parent, bVal, bIdx, p, p + 1 );
        } else {
            // MERGE — Elder Rule flipped for superlevel
            mergeNoEmitSup( parent, bVal, bIdx, p, p - 1 );
            mergeSuperlevel( parent, bVal, bIdx, p, p + 1, fP );
            if ( mergeResult.merged && mergeResult.persistence >= eps ) {
                const i = state.maxPairCount;
                if ( i < state.maxPairs ) {
                    state.maxBirthValArr[ i ] = mergeResult.diedBirthVal;
                    state.maxBirthIdxArr[ i ] = mergeResult.diedBirthIdx;
                    state.maxDeathValArr[ i ] = fP;
                    state.maxDeathIdxArr[ i ] = p;
                    state.maxPersArr[ i ]     = mergeResult.persistence;
                    state.maxPairCount = i + 1;
                }
            }
        }
        processed[ p ] = 1;
    }
}; // sweepMax()


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: PAIR DIFFING
//
// The persistence diagram changes incrementally as the window slides: one
// sample enters on the right, one sample exits on the left. Most pairs
// persist between ticks (same physical samples, shifted by one position in
// the linearized window). Only NEWLY-APPEARED pairs should fire completion
// events — otherwise downstream nodes like `appraise` would see the same
// event re-emitted on every tick.
//
// The diffing works by comparing each current-tick pair (birthIdx, deathIdx)
// against the previous tick's pairs with an INDEX SHIFT correction:
//
//   Previous tick's linearized index I → current tick's index (I − 1)
//
// because the oldest sample (at index 0 in the previous tick) has been
// evicted, and all other samples have shifted left by one position.
//
// A pair is "same" if prev.birthIdx − 1 === cur.birthIdx AND
// prev.deathIdx − 1 === cur.deathIdx. Pairs where either shifted index < 0
// have fallen off the window and are not candidates.
//
// BOUNDARY ARTIFACTS. Index-shift matching alone under-suppresses: both
// window edges mint pairs that are not new physical events. At the left
// edge, evicting the oldest sample can re-form a pair for a swing that was
// already reported, with different indices, so a matcher calls it "new"
// (confirmed on real plant data, 2026-07-20 value study: 46–78% of raw
// completions were such re-fires). At the right edge, a descent in progress
// births a provisional pair at the newest sample on every tick, re-reporting
// the same still-deepening swing. Emission is therefore flag-based — a pair
// emits exactly when its birth vertex has never been accounted — under four
// rules:
//
//   (a) LEFT-BOUNDARY BIRTH — a pair whose birth vertex is window index 0
//       never emits. The swing's left half is cut off by the window, so the
//       birth can never be certified as a real extremum. This also stops
//       the every-tick "walk" where an evicted deep swing's shoulder keeps
//       re-forming a boundary pair as it slides out.
//   (b) REBIRTH — a pair that inherits its death vertex from a
//       previous-tick pair whose birth vertex was just evicted (previous
//       birthIdx 0) is the same swing re-formed around a surviving ripple,
//       not a new swing.
//   (c) PER-VERTEX ACCOUNTING — each birth vertex drives at most one
//       emission while it lives in the window. A per-ring-slot flag records
//       vertices already accounted (emitted, or recognized as a duplicate);
//       the flag clears when the slot is overwritten by a new sample. This
//       catches re-pairings that (a) and (b) cannot see (e.g. a completed
//       minimum re-pairing at a different death vertex after an elder
//       eviction) and skips persisting pairs without index matching.
//   (d) RIGHT-BOUNDARY BIRTH — a pair whose birth vertex is the newest
//       sample (index W−1) is provisional: the extremum cannot be certified
//       until its right neighbour arrives. It stays stored but unaccounted;
//       it emits one tick after the true turning point, when the re-derived
//       pair has birth index < W−1 and a still-clear flag.
//
// The STORED pair arrays remain the full finite-domain persistence diagram
// of the window (matching the GUDHI golden truth); the rules govern only
// which pairs surface as completion events.
//
// Deliberate consequences of these rules:
//   - A genuine swing spanning the entire window (birth exactly at index 0
//     when first resolvable) is never emitted — the price of (a). Size
//     windowSize with margin over the slowest swing of interest.
//   - Completions surface one sample after the extremum is confirmed — the
//     price of (d), and the semantics a streaming consumer wants (no
//     retractions of provisional events).
//   - A swing revealed by truncation (an elder's interior ripple that flips
//     younger after the elder's bottom evicts) still emits, once. It was
//     never reported before, so this is not a duplicate.
//
// For each NEW pair, we select the one with the largest persistence as
// the completion event for this tick. If multiple new pairs appear (rare
// but possible when the new sample triggers a cascade of merges), only
// the deepest one drives the completion slots; `swingsThisTick` records
// the total count of genuinely new pairs.
// ═══════════════════════════════════════════════════════════════════════════

// Diff one direction's current pairs against previous tick and fire
// completion events for genuinely new pairs only, applying the three
// eviction-artifact suppression rules documented in the section banner.
// curBirthIdx/curDeathIdx/curPersist/curBirthVal are the current tick's
// parallel arrays; prevBirthIdx/prevDeathIdx/prevCount are previous tick's.
// keys is state.fieldKeys.min or state.fieldKeys.max (pre-built at init) —
// avoids per-tick string concatenation for the four target field names.
// flagArr is the direction's per-ring-slot accounted flag (rule c); head is
// the ring's oldest-sample slot, so window index i maps to ring slot
// (head + i) mod W.
// Account one current-tick pair (guard-clause form). Applies the four
// suppression rules and writes the completion slots for a genuinely new
// pair. Returns nothing; all effects land on state and flagArr.
//
// Emission is flag-based, not match-based: a pair emits exactly when its
// birth vertex has never been accounted (flag clear) and no rule blocks
// it. Persisting pairs are skipped by their standing flag, so no explicit
// same-pair index matching is needed.
const accountPair = function ( state, W, cb, cd, birthVal, pers,
    prevBirthIdx, prevDeathIdx, prevCount, keys, flagArr, head ) {
    // Rule (a): left-boundary birth — the swing's left half is cut off by
    // the window, so the extremum can never be certified. Never emits and
    // never flags (the slot is overwritten next tick anyway).
    if ( cb === 0 ) return;

    // Rule (d): right-boundary birth — the newest sample cannot yet be
    // certified as an extremum because its right neighbour has not arrived.
    // The pair stays stored but unaccounted; once a confirming sample
    // lands, the re-derived pair (birth index < W−1, flag still clear)
    // emits through the normal path below.
    if ( cb === ( W - 1 ) ) return;

    // Rule (b): a pair inheriting its death vertex from a previous-tick
    // pair whose birth vertex was just evicted (previous birthIdx 0) is
    // the same swing re-formed around a surviving ripple, not a new swing.
    let rebirth = false;
    for ( let j = 0; j < prevCount; j += 1 ) {
        if ( ( ( prevDeathIdx[ j ] - 1 ) === cd ) && ( prevBirthIdx[ j ] === 0 ) ) {
            rebirth = true;
            break;
        }
    }

    // Map the birth's window index to its ring slot (avoids %).
    let slot = head + cb;
    if ( slot >= W ) slot -= W;

    if ( rebirth || ( flagArr[ slot ] === 1 ) ) {
        // Rules (b)/(c): a duplicate of an already-accounted swing. Mark
        // the vertex so later re-pairings stay suppressed; emit nothing.
        flagArr[ slot ] = 1;
        return;
    }

    // Genuinely new, certified completion.
    flagArr[ slot ] = 1;
    state.swingsThisTick += 1;
    if ( !state[ keys.completed ] || ( pers > state[ keys.persistence ] ) ) {
        state[ keys.completed ]   = true;
        state[ keys.birthValue ]  = birthVal;
        state[ keys.birthLag ]    = ( W - 1 ) - cb;
        state[ keys.persistence ] = pers;
    }
}; // accountPair()

const diffOneSide = function ( state, W, curCount, curBirthIdxArr, curDeathIdxArr,
    curBirthValArr, curPersArr, prevBirthIdx, prevDeathIdx, prevCount, keys,
    flagArr, head ) {
    for ( let i = 0; i < curCount; i += 1 ) {
        accountPair( state, W, curBirthIdxArr[ i ], curDeathIdxArr[ i ],
            curBirthValArr[ i ], curPersArr[ i ],
            prevBirthIdx, prevDeathIdx, prevCount, keys, flagArr, head );
    }
}; // diffOneSide()

const diffAndEmit = function ( state, W ) {
    const head = state.ring.head;
    if ( state.direction === 'both' || state.direction === 'dips' ) {
        diffOneSide( state, W, state.minPairCount,
            state.minBirthIdxArr, state.minDeathIdxArr,
            state.minBirthValArr, state.minPersArr,
            state.prevMinBirthIdx, state.prevMinDeathIdx,
            state.prevMinPairCount, state.fieldKeys.min,
            state.minEmitFlag, head );
    }
    if ( state.direction === 'both' || state.direction === 'peaks' ) {
        diffOneSide( state, W, state.maxPairCount,
            state.maxBirthIdxArr, state.maxDeathIdxArr,
            state.maxBirthValArr, state.maxPersArr,
            state.prevMaxBirthIdx, state.prevMaxDeathIdx,
            state.prevMaxPairCount, state.fieldKeys.max,
            state.maxEmitFlag, head );
    }
    if ( state.dipCompleted )  state.emitted += 1;
    if ( state.peakCompleted ) state.emitted += 1;
}; // diffAndEmit()

// Copy current tick's pair indices to previous-tick storage for the next
// tick's diff comparison. Only indices are needed (not values or persistence)
// because the diff compares by position, not by magnitude.
const copyToPrev = function ( state ) {
    for ( let i = 0; i < state.minPairCount; i += 1 ) {
        state.prevMinBirthIdx[ i ] = state.minBirthIdxArr[ i ];
        state.prevMinDeathIdx[ i ] = state.minDeathIdxArr[ i ];
    }
    state.prevMinPairCount = state.minPairCount;

    for ( let i = 0; i < state.maxPairCount; i += 1 ) {
        state.prevMaxBirthIdx[ i ] = state.maxBirthIdxArr[ i ];
        state.prevMaxDeathIdx[ i ] = state.maxDeathIdxArr[ i ];
    }
    state.prevMaxPairCount = state.maxPairCount;
}; // copyToPrev()


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: MAIN UPDATE
//
// The per-message entry point. Called by the wiring layer for every sample.
//
// Flow:
// Resolve the adaptive threshold from the tunable, applying the absolute floor.
// The try/catch pattern with log suppression follows the threshold node's
// convention for handling tunable errors gracefully.
const resolveThreshold = function ( state, msg ) {
    try {
        state.currentThreshold = state.thresholdFn( msg );
        if ( state.tunableErrorLogged ) {
            state.tunableErrorLogged = false;
        }
    } catch ( error ) {
        if ( !state.tunableErrorLogged ) {
            state.tunableErrorLogged = true;
            const errMsg = 'WinkComposer/' + state.nodeType + ': tunable threw: ' + error.message;
            console.error( errMsg );
        }
    }
    const epsBase = state.currentThreshold;
    // Apply the absolute floor: effective ε = max(resolved, minAbsoluteThreshold).
    // Required for quiet signals where adaptive σ drops below the measurement
    // noise floor — empirically validated on WiFi RSSI (see feasibility study).
    return ( epsBase < state.minAbsoluteThreshold ) ? state.minAbsoluteThreshold : epsBase;
}; // resolveThreshold()

//   1. Guard (disable / pause)
//   2. Reset per-tick output slots (output scrubbing)
//   3. Extract and validate input
//   4. Resolve adaptive threshold
//   5. Push sample to ring buffer
//   6. Wait for warmup (window not yet full)
//   7. Linearize the circular ring buffer into a contiguous array
//   8. Sort sample indices by value (ascending)
//   9. Run sublevel sweep for minima (if direction allows)
//  10. Run superlevel sweep for maxima (if direction allows)
//  11. Diff current diagram against previous tick's diagram
//  12. Copy current pairs to previous-tick storage
//  13. Update diagnostics
//
// Steps 7–12 are the "batch per window" core. Their combined cost is
// O(W log W) dominated by the sort, with O(W) for the sweeps and O(P²)
// for the diff where P is the pair count (typically 5–20, negligible).
// ═══════════════════════════════════════════════════════════════════════════

const update = function ( state, msg ) {
    // ── 1. Control guard ─────────────────────────────────────
    if ( state.disable || state.pause ) return state;

    // ── 2. Reset per-tick completion slots ───────────────────
    // Output scrubbing: downstream must never read stale completion data
    // from a previous tick. Set all slots to their "no event" state. The
    // momentsDigest node establishes this convention — non-event ticks
    // publish `undefined` for detail fields, not stale values.
    state.dipCompleted   = false;
    state.peakCompleted  = false;
    state.dipValue       = NaN;
    state.peakValue      = NaN;
    state.dipLag         = 0;
    state.peakLag        = 0;
    state.dipSize        = NaN;
    state.peakSize       = NaN;
    state.swingsThisTick = 0;

    // ── 3. Extract and validate input ────────────────────────
    const xVal = msg[ state.x ];
    state.inputValidationFailed = false;

    if ( !Number.isFinite( xVal ) ) {
        state.inputValidationFailed = true;
        return state;
    }

    // ── 4. Resolve adaptive threshold ────────────────────────
    const eps = resolveThreshold( state, msg );

    // ── 5. Push to ring buffer ───────────────────────────────
    // The slot being overwritten is the ring's head (next write position =
    // oldest sample). Clear its accounted-emission flags so the incoming
    // sample starts life unflagged (rule c bookkeeping).
    const evictSlot = state.ring.head;
    push( state.ring, xVal );
    state.minEmitFlag[ evictSlot ] = 0;
    state.maxEmitFlag[ evictSlot ] = 0;
    state.received += 1;

    // ── 6. Warmup gate ───────────────────────────────────────
    // Do not run the sweep until the ring buffer is full. During warmup,
    // completion slots remain in their "no event" state and publishTo
    // will return without writing any fields to the message.
    if ( isNotFull( state.ring ) ) return state;

    const W = state.windowSize;

    // ── 7. Linearize ring → contiguous array ─────────────────
    // The ring buffer is circular: ring.head points to the next write
    // position, which is also the OLDEST sample (it will be overwritten
    // next tick). We need a contiguous array where index 0 = oldest and
    // index W−1 = newest, because the sort and sweep operate on contiguous
    // indices.
    //
    // Manual indexed loops avoid subarray()'s per-call view-object
    // allocation. At W ≤ 256 the two loops iterate at most W elements
    // total on typed arrays — V8 vectorizes trivially, zero allocation.
    const buf  = state.ring.buffer;
    const head = state.ring.head;
    const lin  = state.linear;
    const firstLen = W - head;
    for ( let i = 0; i < firstLen; i += 1 ) lin[ i ]            = buf[ head + i ];
    for ( let i = 0; i < head;     i += 1 ) lin[ firstLen + i ] = buf[ i ];

    // ── 8. Sort indices by value ─────────────────────────────
    // Initialize sortedIndices to [0, 1, 2, ..., W−1], then sort by
    // linear[i] ascending. V8's Timsort detects existing runs — since the
    // window changes by only one sample per tick, most of the sorted order
    // is preserved, and Timsort approaches O(W) in practice.
    //
    // Tie-breaking by index (a − b) ensures deterministic results and
    // matches Persistence1D's convention: earlier samples process first
    // when values are equal. Comparator is pre-built in init to avoid
    // per-tick closure allocation.
    for ( let i = 0; i < W; i += 1 ) state.sortedIndices[ i ] = i;
    state.sortedIndices.sort( state.compareIndices );

    // ── 9. Sweep for minima ──────────────────────────────────
    if ( state.direction === 'both' || state.direction === 'dips' ) {
        sweepMin( state, lin, W, eps );
    }

    // ── 10. Sweep for maxima ─────────────────────────────────
    // Uses the SAME sortedIndices (iterated backward) and resets the same
    // uf* and processed arrays. No re-sort needed.
    if ( state.direction === 'both' || state.direction === 'peaks' ) {
        sweepMax( state, lin, W, eps );
    }

    // ── 11. Diff and emit ────────────────────────────────────
    diffAndEmit( state, W );

    // ── 12. Copy current → prev ──────────────────────────────
    copyToPrev( state );

    // ── 13. Update diagnostic ────────────────────────────────
    // Cumulative swings per received sample. Can exceed 1.0 in
    // direction='both' when ticks complete both a dip and a peak.
    // The ternary's `: 0` branch is unreachable — received was incremented
    // earlier in this function (step 3) and is therefore ≥ 1 here.
    /* c8 ignore next 3 -- defensive: received ≥ 1 by line 561 */
    state.swingRate = ( state.received > 0 ) ?
        state.emitted / state.received :
        0;

    return state;
}; // update()

export default update;

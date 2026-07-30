// @fileoverview
// init.js — pre-allocates all state for the swingWatch node.
//
// Every typed array, ring buffer, and accumulator is allocated here and never
// again during the hot path (update / publishTo). Total memory per instance
// at W=100 is ~7.9 KB — fits comfortably in L1 cache.

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { create } from '../../windowing/count-sliding/index.js';
import { resolveScalar } from '../../core/utils/options/resolve-field-keyed.js';
import { asTunable } from '../../core/tunable/index.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    const state = Object.create( null );

    // ── Standard flags ───────────────────────────────────────
    state.inputValidationFailed = false;
    state.disable = false;
    state.pause = false;

    // ── Configuration from spec ──────────────────────────────
    state.x = spec.from.x;
    state.stats = Object.assign( Object.create( null ), spec.stats );
    state.direction = spec.direction ?? introspect.DEFAULT_OPTIONS.direction;
    state.minAbsoluteThreshold = spec.minAbsoluteThreshold ?? introspect.DEFAULT_OPTIONS.minAbsoluteThreshold;

    // ── Window size (field-keyed support) ─────────────────────
    const windowSizeSpec = resolveScalar( spec.windowSize, state.x );
    const W = windowSizeSpec ?? introspect.DEFAULT_OPTIONS.windowSize;
    state.windowSize = W;

    // ── Ring buffer (reuse composer's count-sliding module) ──
    state.ring = create( W );

    // ── Threshold tunable ────────────────────────────────────
    state.thresholdFn = asTunable( spec.threshold );
    state.currentThreshold = 0;
    state.tunableErrorLogged = false;

    // ── Pre-allocated typed arrays (zero allocation in hot path) ─

    // Linearized copy of ring buffer (contiguous for sort)
    state.linear = new Float64Array( W );

    // Sort workspace: indices [0..W-1] sorted by linear[i]
    state.sortedIndices = new Int32Array( W );

    // Pre-built comparator — avoids per-tick closure allocation at the
    // .sort() call site. Captures state.linear by reference; its contents
    // are overwritten in place each tick but the binding is stable.
    state.compareIndices = ( a, b ) => {
        const d = state.linear[ a ] - state.linear[ b ];
        if ( d !== 0 ) return d;
        return a - b;
    };

    // Union-find arrays (reused for both min and max sweeps)
    state.ufParent   = new Int32Array( W );
    state.ufBirthVal = new Float64Array( W );
    state.ufBirthIdx = new Int32Array( W );

    // Processed flags for sweep (cleared between min/max sweeps)
    state.processed = new Uint8Array( W );

    // Accounted-emission flags, one byte per ring slot per direction
    // (exactly-once rule c in update.js Section 3). A set byte means the
    // sample in that slot has already driven — or been recognized as a
    // duplicate of — a completion emission. Cleared per-slot on overwrite.
    state.minEmitFlag = new Uint8Array( W );
    state.maxEmitFlag = new Uint8Array( W );

    // Pair storage — parallel typed arrays, max pairs = floor(W/2)
    const maxPairs = Math.floor( W / 2 );
    state.maxPairs = maxPairs;

    // Current tick's min pairs
    state.minBirthValArr = new Float64Array( maxPairs );
    state.minBirthIdxArr = new Int32Array( maxPairs );
    state.minDeathValArr = new Float64Array( maxPairs );
    state.minDeathIdxArr = new Int32Array( maxPairs );
    state.minPersArr     = new Float64Array( maxPairs );
    state.minPairCount   = 0;

    // Current tick's max pairs
    state.maxBirthValArr = new Float64Array( maxPairs );
    state.maxBirthIdxArr = new Int32Array( maxPairs );
    state.maxDeathValArr = new Float64Array( maxPairs );
    state.maxDeathIdxArr = new Int32Array( maxPairs );
    state.maxPersArr     = new Float64Array( maxPairs );
    state.maxPairCount   = 0;

    // Previous tick's pairs (for diffing — only need indices to compare)
    state.prevMinBirthIdx = new Int32Array( maxPairs );
    state.prevMinDeathIdx = new Int32Array( maxPairs );
    state.prevMinPairCount = 0;

    state.prevMaxBirthIdx = new Int32Array( maxPairs );
    state.prevMaxDeathIdx = new Int32Array( maxPairs );
    state.prevMaxPairCount = 0;

    // ── Completion event slots (Mode A) ──────────────────────
    state.dipCompleted  = false;
    state.dipValue      = NaN;
    state.dipLag        = 0;
    state.dipSize       = NaN;

    state.peakCompleted = false;
    state.peakValue     = NaN;
    state.peakLag       = 0;
    state.peakSize      = NaN;

    // ── Pre-built field-key maps (zero string-concat in diff hot path) ──
    // diffOneSide writes to state[ keys.completed ] etc. using these
    // pre-built strings instead of runtime concatenation. The min/max keys
    // name the sweep side (signal minima/maxima); the values are the
    // published dip/peak stat fields those sides feed.
    state.fieldKeys = Object.create( null );
    state.fieldKeys.min = Object.create( null );
    state.fieldKeys.min.completed   = 'dipCompleted';
    state.fieldKeys.min.birthValue  = 'dipValue';
    state.fieldKeys.min.birthLag    = 'dipLag';
    state.fieldKeys.min.persistence = 'dipSize';
    state.fieldKeys.max = Object.create( null );
    state.fieldKeys.max.completed   = 'peakCompleted';
    state.fieldKeys.max.birthValue  = 'peakValue';
    state.fieldKeys.max.birthLag    = 'peakLag';
    state.fieldKeys.max.persistence = 'peakSize';

    // ── Diagnostic counters ──────────────────────────────────
    state.received       = 0;
    state.emitted        = 0;
    state.swingsThisTick = 0;
    state.swingRate      = 0;

    // ── Metadata ─────────────────────────────────────────────
    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;

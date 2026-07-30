/**
 * @fileoverview Initialisation for the winnow node.
 *
 * Creates per-partition state: anchor tracking, slope projection,
 * and adaptive threshold configuration. All allocations happen here
 * — update() and publishTo() are zero-allocation hot paths.
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { resolveScalar } from '../../core/utils/options/resolve-field-keyed.js';
import { asTunable } from '../../core/tunable/index.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    const state = Object.create( null );

    // ── Standard flags (all nodes) ──────────────────────────────────
    state.disable = false;
    state.pause = false;
    state.inputValidationFailed = false;

    // ── Configuration from spec ─────────────────────────────────────
    state.x = spec.from.x;
    state.stats = spec.stats;

    // Pre-built field names — no string ops in hot path
    state.slopeField = spec.slopeField ?? introspect.DEFAULT_OPTIONS.slopeField;
    state.noiseField = spec.noiseField ?? introspect.DEFAULT_OPTIONS.noiseField;
    state.dirField = spec.dirField ?? introspect.DEFAULT_OPTIONS.dirField;
    state.gateField = spec.gateField ?? introspect.DEFAULT_OPTIONS.gateField;

    // Scalar options (support field-keyed specification)
    state.chi2Threshold = resolveScalar( spec.chi2Threshold, state.x ) ??
        introspect.DEFAULT_OPTIONS.chi2Threshold;
    state.tightenBase = resolveScalar( spec.tightenBase, state.x ) ??
        introspect.DEFAULT_OPTIONS.tightenBase;
    state.maxGap = resolveScalar( spec.maxGap, state.x ) ??
        introspect.DEFAULT_OPTIONS.maxGap;

    // ── Pre-compiled tunable ────────────────────────────────────────
    const resolvedK = resolveScalar( spec.K, state.x ) ?? introspect.DEFAULT_OPTIONS.K;
    state.KFn = asTunable( resolvedK );
    state.K = typeof resolvedK === 'number' ? resolvedK : introspect.DEFAULT_OPTIONS.K;
    state.tunableErrorLogged = false;

    // ── Accumulated state (per-partition core) ──────────────────────
    state.anchor = null;
    state.anchorSlope = 0;
    state.anchorTime = 0;
    state.lastPassedAt = 0;
    state.prevDirection = null;
    state.counter = 0;

    // ── Outputs ─────────────────────────────────────────────────────
    state.deviation = 0;
    state.predicted = 0;
    state.significant = false;

    // ── 1-sample buffer for spike-region anchoring ──────────────────
    // When bufferPrev is true, winnow holds the previous tick's input
    // value and timestamp. On Check 2 (chi-squared gate fire), it
    // publishes xPrev/tPrev — providing the (k-1) anchor that
    // eliminates linear-interpolation overshoot around spikes.
    state.bufferPrev = spec.bufferPrev ?? introspect.DEFAULT_OPTIONS.bufferPrev;
    state.timestampField = spec.timestampField ?? null;
    state.bufferedX = NaN;
    state.bufferedT = NaN;
    state.keptByGate = false;
    state.xPrev = NaN;
    state.tPrev = NaN;
    state.hasXPrev = spec.stats.xPrev !== undefined;
    state.hasTPrev = spec.stats.tPrev !== undefined;

    // ── Metadata ────────────────────────────────────────────────────
    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;

// nodes/lag/init.js

/**
 * @fileoverview Initializes the lag node state.
 *
 * Creates pre-allocated ring buffer(s) and pre-computes stat flags for
 * zero-allocation hot path execution. Follows ADR-004 patterns.
 *
 * @see ADR-004
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { create } from '../../windowing/count-sliding/index.js';
import { resolveScalar } from '../../core/utils/options/resolve-field-keyed.js';

/**
 * Initializes the lag node state from a validated spec.
 *
 * @param {Object} spec - Node specification
 * @param {string} spec.name - Unique node identifier
 * @param {Object} spec.from - Input field configuration
 * @param {string} spec.from.x - Input field name for values
 * @param {string} [spec.timestamp] - Input field name for timestamps (required for slope)
 * @param {number|Object} [spec.lag=1] - Lag window size (supports field-keyed)
 * @param {boolean} [spec.absolute=false] - Apply Math.abs to delta and slope
 * @param {Object} spec.stats - Output statistics configuration
 * @returns {Object} Initialized state object
 */
const init = function ( spec ) {
    validateSpec( spec, introspect );

    // Create state with null prototype (ADR-004: avoid prototype pollution)
    const state = Object.create( null );

    // ── Standard Flags ─────────────────────────────────────────────────────
    state.inputValidationFailed = false;
    state.disable = false;
    state.pause = false;

    // ── Configuration from Spec ────────────────────────────────────────────
    state.x = spec.from.x;
    state.timestamp = spec.timestamp ?? null;
    state.stats = spec.stats;

    // Resolve lag (supports field-keyed specification)
    const lagSpec = resolveScalar( spec.lag, state.x );
    state.lag = lagSpec ?? introspect.DEFAULT_OPTIONS.lag;

    // Apply defaults for optional parameters
    state.absolute = spec.absolute ?? introspect.DEFAULT_OPTIONS.absolute;

    // ── Pre-allocated Ring Buffers ─────────────────────────────────────────
    // Primary ring buffer for x values (always allocated)
    state.ringX = create( state.lag );

    // Secondary ring buffer for timestamps (only if slope is requested)
    state.ringT = ( spec.stats.slope === undefined ) ? null : create( state.lag );

    // ── Pre-computed Stat Flags (zero-branch hot path) ─────────────────────
    // These flags avoid object property iteration in update()
    state.hasDelta = spec.stats.delta !== undefined;
    state.hasRatio = spec.stats.ratio !== undefined;
    state.hasRoc = spec.stats.roc !== undefined;
    state.hasSlope = spec.stats.slope !== undefined;
    state.hasLogReturn = spec.stats.logReturn !== undefined;
    state.hasCumDelta = spec.stats.cumDelta !== undefined;
    state.hasXLag = spec.stats.xLag !== undefined;

    // ── Computed Values (output storage) ───────────────────────────────────
    // Initialize to NaN (startup state before buffer fills)
    state.delta = NaN;
    state.ratio = NaN;
    state.roc = NaN;
    state.slope = NaN;
    state.logReturn = NaN;
    state.xLag = NaN;
    // cumDelta initializes to 0 (integral from a to a = 0)
    state.cumDelta = 0;

    // ── Metadata ───────────────────────────────────────────────────────────
    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;

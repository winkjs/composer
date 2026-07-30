// nodes/accumulate/init.js

/**
 * @fileoverview Initializes the accumulate node state.
 *
 * Creates state object with running sum initialized to zero.
 * No ring buffer needed — simple accumulation with disable/enable support.
 *
 * @see ADR-004
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';

/**
 * Initializes the accumulate node state from a validated spec.
 *
 * @param {Object} spec - Node specification
 * @param {string} spec.name - Unique node identifier
 * @param {Object} spec.from - Input field configuration
 * @param {string} spec.from.x - Input field name for values to accumulate
 * @param {Object} spec.stats - Output statistics configuration
 * @returns {Object} Initialized state object
 */
const init = function ( spec ) {
    validateSpec( spec, introspect );

    const state = Object.create( null );

    // ── Standard Flags ─────────────────────────────────────────────────────
    state.inputValidationFailed = false;
    state.disable = false;
    state.pause = false;

    // ── Configuration from Spec ────────────────────────────────────────────
    state.x = spec.from.x;
    state.stats = spec.stats;

    // ── Accumulated Value ──────────────────────────────────────────────────
    state.sum = 0;

    // ── Metadata ───────────────────────────────────────────────────────────
    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;

/**
 * @fileoverview Initializes unbalance node state from a validated spec.
 * Pre-resolves the field-name list, the missing-channel policy, and which stats
 * need the deviation step. Keeps state.stats so publishNaN() can target every
 * configured output. Stateless: no buffers, no temporal state.
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';

/** Mean magnitudes below this make the percentage undefined. */
const EPSILON = 1e-12;

const init = function ( spec ) {
    validateSpec( spec, introspect );

    const state = Object.create( null );
    state.inputValidationFailed = false;
    state.disable = false;
    state.pause = false;

    state.fields = spec.from.x.slice( 0 );
    state.n = state.fields.length;
    state.stats = spec.stats;
    state.epsilon = EPSILON;

    // Missing-channel policy, resolved once. With skipOnNaN off (the default) any
    // non-finite input blanks the tick, so the floor is the full width n. With
    // skipOnNaN on, the metric is computed over the present channels, down to
    // minPresent ( default 2, the fewest where a spread is defined ). The hot path
    // only compares the present count against state.minPresent.
    state.skipOnNaN = spec.skipOnNaN ?? introspect.DEFAULT_OPTIONS.skipOnNaN;
    state.minPresent = state.skipOnNaN ?
        ( spec.minPresent ?? introspect.DEFAULT_OPTIONS.minPresent ) :
        state.n;

    // The deviation step is only needed for these four stats.
    state.needDev = Boolean(
        spec.stats.maxDev || spec.stats.unbalance ||
        spec.stats.worstIndex || spec.stats.worstDev
    );

    // Computed outputs (fixed shape, overwritten each tick).
    state.mean = 0;
    state.min = 0;
    state.max = 0;
    state.range = 0;
    state.maxDev = 0;
    state.unbalance = 0;
    state.worstIndex = 0;
    state.worstDev = 0;
    state.presentCount = 0;

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;

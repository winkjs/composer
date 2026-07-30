/**
 * @fileoverview Initializes esMean node state from a validated spec.
 *
 * Derives the smoothing factor (alpha) from the configured half-life,
 * pre-computes the MAD alpha for adaptive tracking (half-life × 1.5 to
 * dampen flapping), and allocates all state properties up-front on a
 * prototype-free object — no allocations occur on the hot path.
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { halfLifeToAlpha } from '../../core/utils/half-life/index.js';
import { resolveScalar } from '../../core/utils/options/resolve-field-keyed.js';

const init = function ( spec ) {
    // Validate against (updated) schema
    validateSpec( spec, introspect );

    const state = Object.create( null );
    // Standard input parameter health flag during update: false means healthy
    state.inputValidationFailed = false;
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Required
    state.x = spec.from.x;

    // Config copy
    state.stats = spec.stats;

    // half-life based configuration (samples)
    // Supports both direct: { halfLife: 20 } and field-keyed: { halfLife: { temp: 5, pressure: 20 } }
    const halfLifeSpec = resolveScalar( spec.halfLife, state.x );
    state.halfLife = ( typeof halfLifeSpec === 'number' ) ? halfLifeSpec : introspect.DEFAULT_OPTIONS.halfLife;

    // Derive base alpha from half-life for hot-path math
    state.alpha = halfLifeToAlpha( state.halfLife );
    state.currentAlpha = state.alpha;

    // New: adaptive half-life flag (renamed)
    state.adaptiveHalfLife = !!spec.adaptiveHalfLife;

    // Exponential smoothing of |innovation| (MAD-ish); alpha derived from main half-life
    // Using a slightly longer half-life (×1.5) to avoid flapping under noise
    state.madAlpha = halfLifeToAlpha( state.halfLife * 1.5 );
    state.esAbsInnovation = null;

    // State
    state.esmValue = null;
    state.isInitialized = false;
    state.lastValue = null;

    state.nodeType = introspect.getNodeType();
    return state;
}; // init()

export default init;

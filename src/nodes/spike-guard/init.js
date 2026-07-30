// nodes/spike-guard/init.js

/**
 * @fileoverview Initialize spikeGuard node state.
 *
 * Uses count-sliding ring buffer for 3-sample window.
 * Unlike failed glitchGuard, stores VALUES not message references.
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { create } from '../../windowing/count-sliding/index.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    // Create state after validation passes
    const state = Object.create( null );

    // Standard input parameter health flag during update: false means healthy
    state.inputValidationFailed = false;

    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Extract field name and threshold
    state.x = spec.from.x;
    state.threshold = spec.threshold;

    // Ring buffer for 3 values (reuses count-sliding)
    state.ring = create( 3 );

    // Config copy for publishTo
    state.stats = spec.stats;

    // Output state variables
    state.clean = 0;
    state.detected = false;
    state.magnitude = 0;

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;

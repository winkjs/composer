/**
 * @fileoverview Initialization for median3 node.
 *
 * Validates the spec, creates state with a 3-element ring buffer,
 * and returns the fully initialized state object.
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

    // Extract field name
    state.x = spec.from.x;

    // Underlying ring buffer storing the last 3 values
    state.ring = create( 3 );

    // Config copy
    state.stats = spec.stats;

    // State variables
    state.median3 = 0;

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;

// nodes/pass-if/init.js

/**
 * @fileoverview Initialization for passIf node
 *
 * Validates spec via standard pipeline, creates state with
 * counter, predicate reference, and control flags.
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    // Create state after validation passes
    const state = Object.create( null );
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Extract validated predicate
    state.predicate = spec.predicate;

    // Initialize counter
    state.counter = 0;

    // Store node type for debugging
    state.nodeType = introspect.getNodeType();

    // Log suppression: one log per error episode; reset on recovery.
    state.predicateErrorLogged = false;

    return state;
}; // init()

export default init;

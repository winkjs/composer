/**
 * @fileoverview Initialization for diff node.
 *
 * Validates the spec, extracts field names and the absolute option,
 * and returns the fully initialized state object.
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    const state = Object.create( null );
    // Standard input parameter health flag during update: false means healthy
    state.inputValidationFailed = false;
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Extract field name & option.
    state.x = spec.from.x;
    state.y = spec.from.y;
    state.absolute = spec.absolute ?? introspect.DEFAULT_OPTIONS.absolute;

    // Config copy.
    state.stats = spec.stats;

    // State variables.
    state.diff = 0;

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;

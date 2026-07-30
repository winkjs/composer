/**
 * @fileoverview Initialization for invertFlag node.
 *
 * Validates the spec, extracts the input field name, and returns
 * the fully initialized state object.
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

    // Extract field name
    state.x = spec.from.x;

    // Config copy
    state.stats = spec.stats;

    // State variable
    state.inverted = false;

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;


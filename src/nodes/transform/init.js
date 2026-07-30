/**
 * @fileoverview Initialization for the transform node.
 *
 * Validates the spec and creates a minimal state object. The user-supplied
 * function (`using`) is stored as a direct reference — it is fixed at init
 * time and not wrapped as a tunable.
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    const state = Object.create( null );

    // Standard flags
    state.inputValidationFailed = false;
    state.disable = false;
    state.pause = false;

    // Configuration from spec
    state.x = spec.from.x;
    state.stats = spec.stats;
    state.using = spec.using;

    // Pre-allocate output slot
    state.result = 0;

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;

// nodes/ratio/init.js

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    // Create state after validation passes
    const state = Object.create( null );
    // Standard input parameter health flag during update: false means healthy
    state.inputValidationFailed = false;
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Extract field names - x is numerator, y is denominator.
    state.x = spec.from.x;
    state.y = spec.from.y;

    // Config copy.
    state.stats = spec.stats;

    // Apply defaults from introspect (validation doesn't enforce them)
    state.logScale = spec.logScale ?? introspect.DEFAULT_OPTIONS.logScale;
    state.minY = spec.minY ?? introspect.DEFAULT_OPTIONS.minY;
    state.scaleBy = spec.scaleBy ?? introspect.DEFAULT_OPTIONS.scaleBy;

    // State variables.
    state.ratio = 0;

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;

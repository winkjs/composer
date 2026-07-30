// nodes/process-index/init.js

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { DEFAULT_OPTIONS } from './introspect.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    const state = Object.create( null );
    // Standard input parameter health flag during update: false means healthy
    state.inputValidationFailed = false;
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Input fields
    state.x = spec.from.x;  // mean field
    state.y = spec.from.y;  // stddev field

    // Spec limits (at least one required, validated by specSchema)
    state.hasUpperSpecLimit = spec.upperSpecLimit !== undefined;
    state.hasLowerSpecLimit = spec.lowerSpecLimit !== undefined;
    state.upperSpecLimit = state.hasUpperSpecLimit ? spec.upperSpecLimit : NaN;
    state.lowerSpecLimit = state.hasLowerSpecLimit ? spec.lowerSpecLimit : NaN;

    // Options
    state.epsilon = spec.epsilon ?? DEFAULT_OPTIONS.epsilon;
    state.maxIndex = spec.maxIndex ?? DEFAULT_OPTIONS.maxIndex;
    state.capableThreshold = spec.capableThreshold ?? DEFAULT_OPTIONS.capableThreshold;
    state.marginalThreshold = spec.marginalThreshold ?? DEFAULT_OPTIONS.marginalThreshold;

    // Config copy
    state.stats = spec.stats;

    // Output values
    state.index = NaN;
    state.upper = NaN;
    state.lower = NaN;
    state.status = 'incapable';

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;


// nodes/vector-distance/init.js

/* eslint-disable no-bitwise */
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

    // Vector source configuration - following standard pattern
    state.x = spec.from.x;
    state.y = spec.from.y;

    state.accumulator = new Float64Array( 6 );
    state.accumulator.fill( 0 );

    // Distance values - pre-allocate all even if not used
    state.distances = Object.create( null );
    state.distances.mad = 0;
    state.distances.rms = 0;
    state.distances.maximum = 0;
    state.distances.cosine = 0;
    state.distances.angular = 0;

    // Track if we've computed at least once i.e. downstream
    // node has warmed up!
    state.computed = false;

    // Output configuration
    state.stats = spec.stats;

    state.mask = 0;
    if ( state.stats.mad || state.stats.maximum ) state.mask |= 1;
    if ( state.stats.rms ) state.mask |= 2;
    if ( state.stats.cosine || state.stats.angular ) state.mask |= 4;

    // Optimization flags based on requested stats
    state.needsAbs = state.stats.mad || state.stats.maximum;
    state.needsSquare = state.stats.rms;
    state.needsDotProduct = state.stats.cosine || state.stats.angular;

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;

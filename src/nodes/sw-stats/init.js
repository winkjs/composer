// nodes/sw-stats/init.js

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { create } from '../../windowing/count-sliding/index.js';
import { resolveScalar } from '../../core/utils/options/resolve-field-keyed.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    // Create state after validation passes
    const state = Object.create( null );
    // Standard input parameter health flag during update: false means healthy
    state.inputValidationFailed = false;
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Extract field name.
    state.x = spec.from.x;

    // Apply defaults from introspect (validation doesn't enforce them)
    // Supports both direct and field-keyed specification
    const windowSizeSpec = resolveScalar( spec.windowSize, state.x );
    const windowSize = windowSizeSpec ?? introspect.DEFAULT_OPTIONS.windowSize;

    // Underlying ring buffer storing the windowed values.
    state.ring = create( windowSize );

    // Config copy.
    state.stats = Object.assign( Object.create( null ), spec.stats );

    // Which of the SUPPORTED_STATS the user actually requested.
    const statsList = Object.keys( state.stats );
    // Determine which moments we need to compute and save it as state constants
    state.need2 = statsList.some( ( m ) => [ 'variance', 'stdev', 'skewness', 'kurtosis', 'rms' ].includes( m ) );
    state.need3 = statsList.some( ( m ) => [ 'skewness', 'kurtosis' ].includes( m ) );
    state.need4 = statsList.includes( 'kurtosis' );

    // State variables for incremental computation (s=sum, n=power).
    state.s1 = 0;
    state.s2 = ( state.need2 ) ? 0 : undefined;
    state.s3 = ( state.need3 ) ? 0 : undefined;
    state.s4 = ( state.need4 ) ? 0 : undefined;

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;

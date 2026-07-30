// nodes/tw-stats/init.js

/**
 * @fileoverview Initialization for twStats node.
 *
 * Resolves the selective accumulation tier (maxMoment 1–4) from demanded
 * stats at init time. All allocations happen here; update() is zero-alloc.
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { resolveScalar } from '../../core/utils/options/resolve-field-keyed.js';

// Stats that require M2 accumulation
const NEEDS_M2 = [ 'variance', 'stddev', 'cv', 'skew', 'kurtosis', 'rms', 'crestFactor' ];

const init = function ( spec ) {
    validateSpec( spec, introspect );

    const state = Object.create( null );

    // Standard flags (all nodes)
    state.inputValidationFailed = false;
    state.disable = false;
    state.pause = false;

    // Preserve node's name — used for msg[name] = true on publish
    state.name = spec.name;

    // Input field name
    state.x = spec.from.x;

    // Resolve options (field-keyed support for windowSize)
    const windowSizeSpec = resolveScalar( spec.windowSize, state.x );
    state.windowSize = windowSizeSpec ?? introspect.DEFAULT_OPTIONS.windowSize;
    state.biased = spec.biased || introspect.DEFAULT_OPTIONS.biased;
    state.epsilon = spec.epsilon ?? introspect.DEFAULT_OPTIONS.epsilon;

    // Copy stats config (Object.create(null) for clean prototype)
    state.stats = Object.assign( Object.create( null ), spec.stats );

    // Determine selective accumulation tier from demanded stats
    const statsList = Object.keys( state.stats );
    const needsM2 = statsList.some( ( s ) => NEEDS_M2.includes( s ) );
    const needsM3 = statsList.includes( 'skew' ) || statsList.includes( 'kurtosis' );
    const needsM4 = statsList.includes( 'kurtosis' );

    if ( needsM4 ) {
        state.maxMoment = 4;
    } else if ( needsM3 ) {
        state.maxMoment = 3;
    } else if ( needsM2 ) {
        state.maxMoment = 2;
    } else {
        state.maxMoment = 1;
    }

    state.needsMinMax = !!( state.stats.min || state.stats.max || state.stats.crestFactor );
    state.needsRms = !!( state.stats.rms || state.stats.crestFactor );

    // Pébay algorithm accumulators
    state.n = 0;
    state.M1 = 0;
    state.M2 = 0;
    state.M3 = 0;
    state.M4 = 0;
    state.min = Infinity;
    state.max = -Infinity;

    // Window management
    state.currentCount = 0;

    // Publish control
    state.planPublish = false;
    state.flushLatched = false;

    // Snapshot: holds moments at window completion for publishTo to read
    state.snapshot = Object.create( null );

    // Pre-compute scrubKeys for efficient non-publish scrubbing
    state.scrubKeys = [];
    // eslint-disable-next-line guard-for-in
    for ( const stat in state.stats ) {
        state.scrubKeys.push( state.stats[ stat ].storeAs );
    }

    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;

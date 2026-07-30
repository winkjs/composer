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

    // Extract field names and count
    state.fieldNames = spec.from.x;
    state.fieldCount = state.fieldNames.length;

    // Guards (apply defaults from introspect)
    const defaults = introspect.DEFAULT_OPTIONS;
    state.debounce = spec.debounce ?? defaults.debounce;

    // Change detection mode (store as boolean for performance)
    const changeMode = spec.changeMode ?? defaults.changeMode;
    state.changeMode = ( changeMode === 'all' );  // true='all', false='any'

    // Timestamp handling
    state.useTimestampField = spec.timestampField !== undefined;
    state.timestampField = spec.timestampField || null;

    // Stats configuration
    state.stats = spec.stats;

    // Pre-allocate state tracking (NO allocations in hot path)
    state.prevValues = Object.create( null );
    for ( let i = 0; i < state.fieldCount; i += 1 ) {
        const field = state.fieldNames[ i ];
        state.prevValues[ field ] = null;
    }

    // Debounce and timing state
    state.debounceCount = 0;
    state.stateStartTime = null;
    state.samplesInState = 0;

    // stats to be published
    state.dwellTime = null;
    state.dwellSamples = null;

    // Node metadata
    state.nodeType = introspect.getNodeType();
    state.resolvedTriggers = [];

    return state;
}; // init()

export default init;

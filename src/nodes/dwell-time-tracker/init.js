// nodes/dwell-time-tracker/init.js

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

    // Extract configuration
    state.predicate = spec.predicate;
    state.timestampField = spec.timestampField || null;

    // Config copy
    state.stats = spec.stats;

    // Track if we need duration tracking
    state.needsDurationTracking = Boolean(
        spec.stats.dwellTime ||
        spec.stats.dwellSamples ||
        spec.stats.dutyCycle
    );

    // State variables - clear boolean semantics
    state.active = false;       // Current state
    state.wasActive = false;    // Previous state (for edge detection)

    // Duration tracking state
    state.stateEnteredAt = null;  // When current state was entered (milliseconds)
    state.dwellTime = null;          // Duration of previous state (milliseconds)
    state.dwellSamples = null;       // Samples in the previous state
    state.sampleCount = 0;
    // Duty cycle tracking mechanism
    state.dutyCycleTracker = Object.create( null );
    // It is indexed by `wasActive` state as dwellTime is always for wasActive state (see update.js)
    state.dutyCycleTracker.true = null;
    state.dutyCycleTracker.false = null;
    state.dutyCycle = null;         // Used for publish duty cycle

    // First message flag
    state.hasSeenFirstValue = false;

    state.nodeType = introspect.getNodeType();
    state.inControlPhase = false;

    // Log suppression: one log per error episode; reset on recovery.
    state.predicateErrorLogged = false;

    return state;
}; // init()

export default init;

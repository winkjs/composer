// nodes/threshold/init.js

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { resolveScalar } from '../../core/utils/options/resolve-field-keyed.js';
import { asTunable } from '../../core/tunable/index.js';

// Mode handler functions - pure functions for threshold checking
const MODE_HANDLERS = {
    above: function (value, state) {
        if (state.hasHysteresis) {
            // With hysteresis: different thresholds for activation/deactivation
            return state.active ?
                value >= (state.threshold - state.hysteresis) :   // Stay active until below reset point (inclusive)
                value >= state.threshold;                       // Activate at threshold
        }
        // Simple threshold
        return value >= state.threshold;
    },

    below: function (value, state) {
        if (state.hasHysteresis) {
            // With hysteresis: opposite direction from 'above'
            return state.active ?
                value <= (state.threshold + state.hysteresis) : // Stay active until above reset point (inclusive)
                value <= state.threshold;                       // Activate at threshold
        }
        // Simple threshold
        return value <= state.threshold;
    },

    outside: function (value, state) {
        if (state.hasHysteresis) {
            // With hysteresis: need to come further inside to deactivate
            if (state.active) {
                // Currently active (outside) - need to come well inside to deactivate
                return value <= (state.min + state.hysteresis) || value >= (state.max - state.hysteresis);
            }
            // Currently inactive (inside) - activate when going outside original bounds
            return value < state.min || value > state.max;
        }
        // Simple range check
        return value < state.min || value > state.max;
    },

    inside: function (value, state) {
        if (state.hasHysteresis) {
            // With hysteresis: expand range for deactivation
            return state.active ?
                value >= (state.min - state.hysteresis) && value <= (state.max + state.hysteresis) :
                value >= state.min && value <= state.max;
        }
        // Simple range check
        return value >= state.min && value <= state.max;
    }
};

const init = function (spec) {
    validateSpec( spec, introspect );

    // Create state after validation passes
    const state = Object.create(null);
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Extract common configuration
    state.x = spec.from.x;
    state.mode = spec.mode;

    // Apply defaults from introspect (validation doesn't enforce them)
    // Supports direct, field-keyed, and tunable specification
    const hysteresisSpec = resolveScalar( spec.hysteresis, state.x );
    state.hysteresisFn = asTunable( hysteresisSpec ?? introspect.DEFAULT_OPTIONS.hysteresis );

    // Store mode-specific parameters (supports field-keying and tunables)
    if ( spec.mode === 'above' || spec.mode === 'below' ) {
        const thresholdSpec = resolveScalar( spec.threshold, state.x );
        state.thresholdFn = asTunable( thresholdSpec );
    } else {
        const minSpec = resolveScalar( spec.min, state.x );
        const maxSpec = resolveScalar( spec.max, state.x );
        state.minFn = asTunable( minSpec );
        state.maxFn = asTunable( maxSpec );
    }

    // Seed tunable state fields — overwritten on every successful update().
    // hysteresis has a DEFAULT_OPTIONS entry; threshold/min/max are required
    // user values with no defaults — undefined keeps node inactive until
    // first successful resolve (value >= undefined → false in all modes).
    state.hysteresis = introspect.DEFAULT_OPTIONS.hysteresis;
    state.hasHysteresis = false;
    if ( spec.mode === 'above' || spec.mode === 'below' ) {
        state.threshold = undefined;
    } else {
        state.min = undefined;
        state.max = undefined;
    }
    // Log suppression: one log per error episode; reset on recovery.
    state.tunableErrorLogged = false;

    // Config copy
    state.stats = spec.stats;

    // State variables - clear boolean semantics
    state.active = false;       // Current state
    state.wasActive = false;    // Previous state (for trigger detection)

    // For hysteresis, we need to know if we've seen any values yet
    state.hasSeenValue = false;

    // Assign the appropriate handler function based on mode (no allocation, just reference)
    state.checkActive = MODE_HANDLERS[spec.mode];

    state.nodeType = introspect.getNodeType();
    state.inControlPhase = false;

    return state;
}; // init()

export default init;

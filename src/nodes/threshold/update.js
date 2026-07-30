// nodes/threshold/update.js

import { executeTriggers } from '../../core/utils/node/index.js';

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    // Extract value using field name
    const xVal = msg[ state.x ];

    // Skip if not a valid number (different from regular NaN publishing)
    if ( !Number.isFinite( xVal ) ) return state;

    // Guard tunable resolve — on throw, state retains previous good value
    // (JS: RHS evaluated first; failed RHS ⇒ assignment never executes).
    try {
        state.hysteresis = state.hysteresisFn( msg );
        state.hasHysteresis = state.hysteresis > 0;
        if ( state.thresholdFn ) {
            state.threshold = state.thresholdFn( msg );
        } else {
            state.min = state.minFn( msg );
            state.max = state.maxFn( msg );
        }
        // Recovery: clear log-suppression flag on success
        if ( state.tunableErrorLogged ) state.tunableErrorLogged = false;
    } catch ( error ) {
        // Log first error per episode; suppress subsequent until recovery
        if ( !state.tunableErrorLogged ) {
            state.tunableErrorLogged = true;
            console.error( `WinkComposer/${state.nodeType}: tunable threw: ${error.message}` );
        }
    }

    // Remember previous state for trigger detection
    state.wasActive = state.active;

    // Update threshold state using mode-specific handler
    if ( state.hasSeenValue ) {
        state.active = state.checkActive( xVal, state );
    } else {
        // First value - compute initial state
        state.active = state.checkActive( xVal, state );
        state.hasSeenValue = true;
    }

    // Trigger controls on activation if configured (rising edge only)
    if ( state.active && !state.wasActive ) {
        executeTriggers( state );
    }

    return state;
}; // update()

export default update;

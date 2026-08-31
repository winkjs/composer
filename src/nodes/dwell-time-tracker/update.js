// nodes/dwell-time-tracker/update.js

import { executeTriggers } from '../../core/utils/node/index.js';
import { logger } from '../../core/logger/index.js';

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    // Reset on each update
    state.inputValidationFailed = false;

    // Evaluate the predicate to compute the value
    let value;

    try {
        value = state.predicate( msg );
        // Recovery: clear log-suppression flag on success
        if ( state.predicateErrorLogged ) state.predicateErrorLogged = false;
    } catch ( error ) {
        // Signals publishing NaN for all demanded `stats` in publishTo.
        state.inputValidationFailed = true;
        // Log first error per episode; suppress subsequent until recovery
        if ( !state.predicateErrorLogged ) {
            state.predicateErrorLogged = true;
            logger.error( `winkComposer/dwellTimeTracker: predicate threw exception: ${error.message}` );
        }
        return state;
    }
    // Skip if not a valid boolean
    if ( typeof value !== 'boolean' ) {
        // Signals publishing NaN for all demanded `stats` in publishTo.
        state.inputValidationFailed = true;
        return state;
    }

    // Get timestamp (from message or current time)
    const now = state.timestampField ? msg[ state.timestampField ] : Date.now();
    // Handle time related faults gracefully: ensure their isolation
    if ( !Number.isFinite( now ) ) {
        // Signals publishing NaN for all demanded `stats` in publishTo.
        state.inputValidationFailed = true;
        return state;
    }

    // Remember previous state for edge detection
    state.wasActive = state.active;

    // Clear edge flags (they're momentary - true for one cycle only)
    state.dwellTime = null;        // Clear duration (only set on state change)
    state.dwellSamples = null;     // Clear samples.
    state.dutyCycle = null;        // Clear duty cycle

    // Update active state (passthrough)
    if ( state.hasSeenFirstValue ) {
        state.active = value;
    } else {
        // First value - set initial state
        state.active = value;
        state.hasSeenFirstValue = true;
        state.sampleCount = 1; // Seeing the very first sample
        // Initialize state entry time ONLY for first value so that
        // on change the first known value of time can be published
        if ( state.needsDurationTracking ) {
            state.stateEnteredAt = now;
        }
        // Since this is the first message, no need to check transition: simply return.
        return state;
    }

    // Detect edges and calculate duration
    if ( state.active !== state.wasActive ) { // eslint-disable-line no-negated-condition
        // Calculate duration and save entry timestamp
        if ( state.needsDurationTracking ) {
            if ( state.stateEnteredAt !== null ) {
                state.dwellTime = now - state.stateEnteredAt;
                if ( state.dwellTime < 0 ) state.dwellTime = 0;
                // Save for publishing
                state.dwellSamples = state.sampleCount;

                // Store current dwell time FIRST: Update the tracker by `wasActive` index.
                state.dutyCycleTracker[ state.wasActive ] = state.dwellTime;

                if ( state.dutyCycleTracker.true !== null && state.dutyCycleTracker.false !== null ) {
                    // Both on and off times accumulated - compute duty cycle for complete cycle
                    const totalDuration = state.dutyCycleTracker.true + state.dutyCycleTracker.false;
                    // Guard: zero total duration (identical timestamps) — NaN signals invalid computation
                    state.dutyCycle = ( totalDuration > 0 ) ? ( state.dutyCycleTracker.true / totalDuration ) : NaN;
                    // Reset tracker
                    state.dutyCycleTracker.true = null;
                    state.dutyCycleTracker.false = null;
                }
            }
            state.stateEnteredAt = now;  // Update for new state
        }

        // First sample in the changed state
        state.sampleCount = 1;
        // Trigger controls on state change
        executeTriggers( state );
    } else state.sampleCount += 1; // Count samples as long as state is unchanged

    return state;
}; // update()

export default update;

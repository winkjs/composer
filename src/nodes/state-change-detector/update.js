import { executeTriggers } from '../../core/utils/node/index.js';
import { validateCategoricalFields } from './helpers.js';

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    // Reset on each update
    state.inputValidationFailed = false;
    // Validate all required fields are present and categorical
    if ( !validateCategoricalFields( msg, state.fieldNames, state.fieldCount ) ) {
        state.inputValidationFailed = true;
        return state;
    }

    // These will be set only and only if change is spotted && debounced;
    // otherwise they will remain null.
    state.dwellTime = null;
    state.dwellSamples = null;

    // Get timestamp once for this message
    const timestamp = state.useTimestampField ? msg[ state.timestampField ] : Date.now();

    // ADR-004 fault handling: a message-supplied timestamp is a
    // numerical input, so a missing or non-numeric value faults this
    // ONE message and leaves the measurement in progress untouched
    // (same guard as dwellTimeTracker). The device clock never fails
    // this check.
    if ( state.useTimestampField && !Number.isFinite( timestamp ) ) {
        state.inputValidationFailed = true;
        return state;
    }

    // First message initialization
    if ( state.prevValues[ state.fieldNames[ 0 ] ] === null ) {
        // Initialize prevValues and timing
        for ( let i = 0; i < state.fieldCount; i += 1 ) {
            const field = state.fieldNames[ i ];
            state.prevValues[ field ] = msg[ field ];
        }
        state.stateStartTime = timestamp;
        state.samplesInState = 1;
        return state;
    }

    // Count fields that differ from last confirmed state
    let changedFieldCount = 0;
    for ( let i = 0; i < state.fieldCount; i += 1 ) {
        const field = state.fieldNames[ i ];
        if ( state.prevValues[ field ] !== msg[ field ] ) {
            changedFieldCount += 1;
        }
    }

    // Apply changeMode logic
    const changeSpotted = state.changeMode ?
        ( changedFieldCount === state.fieldCount ) :  // 'all': every field changed
        ( changedFieldCount > 0 );                    // 'any': at least one changed

    if ( changeSpotted ) {
        // Different from last confirmed state
        state.debounceCount += 1;

        // Check if debounce threshold reached
        if ( state.debounceCount >= state.debounce ) {
            // Change CONFIRMED!
            // Calculate stats BEFORE updating prevValues
            state.dwellTime = timestamp - state.stateStartTime;
            // A dwell can never be negative. A backward clock step
            // (an NTP correction landing mid-measurement) would make
            // the subtraction negative — publish 0 instead, matching
            // dwellTimeTracker's guard (its update.js:74).
            if ( state.dwellTime < 0 ) state.dwellTime = 0;
            state.dwellSamples = state.samplesInState;

            // Commit new state - update prevValues
            for ( let i = 0; i < state.fieldCount; i += 1 ) {
                const field = state.fieldNames[ i ];
                state.prevValues[ field ] = msg[ field ];
            }

            // Reset counters for next transition
            state.debounceCount = 0;
            state.stateStartTime = timestamp;
            state.samplesInState = 1;

            // Execute triggers
            executeTriggers( state );
        }
    } else {
        // Matches last confirmed state - reset debounce
        state.debounceCount = 0;
        state.samplesInState += 1;
    }

    return state;
}; // update()

export default update;

// nodes/dwell-time-tracker/reset.js

const reset = function ( state ) {
    // Reset to initial conditions
    state.active = false;
    state.wasActive = false;
    state.hasSeenFirstValue = false;
    state.stateEnteredAt = null;
    state.dwellTime = null;
    state.dwellSamples = null;
    state.sampleCount = 0;

    state.dutyCycleTracker.true = null;
    state.dutyCycleTracker.false = null;
    state.dutyCycle = null;

    // Clear error suppression so next error episode is logged
    state.predicateErrorLogged = false;

    return true;
}; // reset()

export default reset;

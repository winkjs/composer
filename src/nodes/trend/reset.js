// nodes/trend/reset.js

const reset = function ( state ) {
    state.previousValue = null;

    state.rocMean = 0;
    state.rocVariance = 0;

    if ( state.stats.accelerationHint ) {
        state.rocSmoothedFast = 0;
        state.accelerationHint = null;
    }

    state.samples = 0;
    state.consistentSamples = 0;

    state.previousTrend = 'learning';
    state.trend = 'learning';
    state.confidence = 0;
    // Clear error suppression so next error episode is logged
    state.tunableErrorLogged = false;

    return true;
}; // reset()

export default reset;

// nodes/controller/reset.js

const reset = function ( state ) {
    // Reset observability counters
    state.lastMatchedCondition = -1;
    state.matchCount = 0;
    state.errorCount = 0;
    state.lastError = null;
    // Clear error suppression so next error episode is logged
    state.predicateErrorLogged = false;

    // Note: We don't reset logic or resolvedTriggers
    // as they are structural, not runtime state
    return true;
}; // reset()

export default reset;

/**
 * @fileoverview Update function for categorize node.
 *
 * Extracts the input value, resolves tunable thresholds for the current
 * message, and finds the matching category via linear search. For typical
 * threshold counts (3–5), linear search outperforms binary search.
 */

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    const xVal = msg[ state.x ];
    // Reset on each update
    state.inputValidationFailed = false;
    // Handle faults gracefully: ensure their isolation
    if ( !Number.isFinite( xVal ) ) {
        // Signals publishing NaN for all demanded `stats` in publishTo.
        state.inputValidationFailed = true;
        return state;
    }

    // Resolve thresholds tunable for this message
    try {
        state.resolvedThresholds = state.thresholdsFn( msg );
        if ( state.tunableErrorLogged ) state.tunableErrorLogged = false;
    } catch ( error ) {
        if ( !state.tunableErrorLogged ) {
            state.tunableErrorLogged = true;
            console.error( `WinkComposer/${state.nodeType}: tunable threw: ${error.message}` );
        }
    }

    if ( !state.resolvedThresholds ) {
        state.inputValidationFailed = true;
        return state;
    }

    // Find category using linear search
    // For typical threshold counts (3-5), this is faster than binary search
    // Convention: value >= threshold belongs to upper category
    let categoryIndex = 0;

    for ( categoryIndex = 0; categoryIndex < state.resolvedThresholds.length; categoryIndex += 1 ) {
        if ( xVal < state.resolvedThresholds[ categoryIndex ] ) break;
    }

    // Update state
    state.categoryIndex = categoryIndex;
    state.category = state.categories[ categoryIndex ];

    return state;
}; // update()

export default update;

// Helper: Check value against range
const checkRange = function ( state, value, rangeSpec ) {
    if ( !state.hasRange || !rangeSpec ) {
        return true;  // No range configured, pass through
    }

    return value >= rangeSpec.min && value <= rangeSpec.max;
}; // checkRange()

// Helper: Check value against list
const checkValueList = function ( state, value ) {
    if ( !state.valueSet ) {
        return true;  // No list configured, pass through
    }

    const isInList = state.valueSet.has( value );
    // If containsValidValues is true, value must be in list (allow list)
    // If containsValidValues is false, value must NOT be in list (deny list)
    return state.containsValidValues ? isInList : !isInList;
}; // checkValueList()

// Helper: Check custom predicate
const checkPredicate = function ( state, value, msg ) {
    if ( !state.predicate ) {
        return true;  // No predicate configured, pass through
    }

    try {
        const result = state.predicate( value, msg ) === true;
        // Recovery: clear log-suppression flag on success
        if ( state.predicateErrorLogged ) state.predicateErrorLogged = false;
        return result;
    } catch ( error ) {
        // Log first error per episode; suppress subsequent until recovery
        if ( !state.predicateErrorLogged ) {
            state.predicateErrorLogged = true;
            console.error( `winkComposer/sanitize: predicate threw exception: ${error.message}` );
        }
        return false;
    }
}; // checkPredicate()

// Main update function
const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;

    const key = state.x;
    const value = msg[ key ];

    // Use self compare NaN NaN check first and not the Number.isFinite(),
    // as incoming value may not be number type
    if ( value !== value ) { // eslint-disable-line no-self-compare
        // Assume it to be a value related failure!
        state.failureReason = state.REASON_VALUE_LIST;
        state.failedValue = value;
        return state;
    }

    // Resolve range tunable for this message (if configured)
    if ( state.rangesFn ) {
        try {
            state.resolvedRangeSpec = state.rangesFn( msg );
            if ( state.tunableErrorLogged ) state.tunableErrorLogged = false;
        } catch ( error ) {
            if ( !state.tunableErrorLogged ) {
                state.tunableErrorLogged = true;
                console.error( `winkComposer/${state.nodeType}: tunable threw: ${error.message}` );
            }
        }
    }

    // Check range first (most common validation)
    if ( !checkRange( state, value, state.resolvedRangeSpec ) ) {
        state.failureReason = state.REASON_RANGE;
        state.failedValue = value;
        msg[ key ] = NaN;
        return state;
    }

    // Check value list
    if ( !checkValueList( state, value ) ) {
        state.failureReason = state.REASON_VALUE_LIST;
        state.failedValue = value;
        msg[ key ] = NaN;
        return state;
    }

    // Check predicate
    if ( !checkPredicate( state, value, msg ) ) {
        state.failureReason = state.REASON_PREDICATE;
        state.failedValue = value;
        msg[ key ] = NaN;
        return state;
    }

    // Value is valid, pass through unchanged
    state.failureReason = null;
    state.failedValue = null;
    return state;
}; // update()

export default update;

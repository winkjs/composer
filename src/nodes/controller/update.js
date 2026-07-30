// nodes/controller/update.js

import { executeTriggers } from '../../core/utils/node/index.js';

const update = function ( state, msg ) {
    // Track whether any predicate threw during this pass
    let anyError = false;

    // Iterate through conditions in order
    for ( let i = 0; i < state.logic.length; i += 1 ) {
        const condition = state.logic[ i ];

        // Evaluate predicate with error handling
        let predicateResult = false;
        try {
            predicateResult = condition.when( msg );
        } catch ( error ) {
            anyError = true;
            // Track predicate errors
            state.errorCount += 1;
            state.lastError = error.message;
            // Log first error per episode; suppress subsequent until recovery
            if ( !state.predicateErrorLogged ) {
                state.predicateErrorLogged = true;
                console.error( `WinkComposer/controller: predicate threw exception: ${error.message}` );
            }
            // Skip to next condition
            continue;  // eslint-disable-line no-continue
        }

        // Check if condition matches
        if ( predicateResult === true ) {
            // Recovery: clear flag only when entire pass is exception-free
            if ( !anyError && state.predicateErrorLogged ) state.predicateErrorLogged = false;

            // Update observability
            state.lastMatchedCondition = i;
            state.matchCount += 1;

            // Check for resolved triggers
            if ( !condition.resolvedTriggers || condition.resolvedTriggers.length === 0 ) {
                return state;  // No triggers to execute
            }

            // Point to this condition's triggers; it is an executeTriggers' requirement.
            state.resolvedTriggers = condition.resolvedTriggers;

            // Execute triggers with re-entrancy protection
            executeTriggers( state );

            // First match wins - stop processing
            return state;
        }
    }

    // Recovery: clear flag only when entire pass is exception-free
    if ( !anyError && state.predicateErrorLogged ) state.predicateErrorLogged = false;

    // No conditions matched
    return state;
}; // update()

export default update;

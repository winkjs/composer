// nodes/persistence-check/update.js

import { executeTriggers } from '../../core/utils/node/index.js';

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;

    let predicateResult;
    try {
        predicateResult = state.predicate( msg );
        // Recovery: clear log-suppression flag on success
        if ( state.predicateErrorLogged ) state.predicateErrorLogged = false;
    } catch ( error ) {
        // Assume it to be a case of predicate evaluating to false
        predicateResult = false;
        // Log first error per episode; suppress subsequent until recovery
        if ( !state.predicateErrorLogged ) {
            state.predicateErrorLogged = true;
            console.error( `winkComposer/persistenceCheck: predicate threw exception: ${error.message}` );
        }
    }

    // Update vote counts
    if ( predicateResult ) {
        state.voteCount += 1;
    } else {
        state.unvoteCount += 1;
    }

    // Check for success
    if ( state.voteCount >= state.minVotes ) {
        state.voteCount = 0;
        state.unvoteCount = 0;
        state.persistenceConfirmed = true;

        // Trigger controls
        executeTriggers( state );

        return state;  // Early return on success
    }

    // Check for window completion or mathematical impossibility
    const totalProcessed = state.voteCount + state.unvoteCount;
    const remaining = state.outOfTotal - totalProcessed;

    if ( totalProcessed >= state.outOfTotal || // Window completition check
         ( state.voteCount + remaining ) < state.minVotes ) { // Mathematical impossibility check
        // Window complete or success impossible - reset
        state.voteCount = 0;
        state.unvoteCount = 0;
        state.persistenceConfirmed = false;
    }

    return state;
}; // update()

export default update;

// nodes/pass-if/update.js

/**
 * @fileoverview Update function for passIf node
 *
 * Hot path — evaluates user-supplied predicate with message and
 * counter. Returns null to stop downstream flow when predicate
 * is false. Predicate errors are caught and tracked per-episode.
 */

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;

    // Increment counter for this message
    state.counter += 1;

    let shouldPass;
    try {
        // Evaluate predicate with message and current counter
        shouldPass = state.predicate( msg, state.counter );
        // Recovery: clear log-suppression flag on success
        if ( state.predicateErrorLogged ) state.predicateErrorLogged = false;
    } catch ( error ) {
        // Assume it to be a case of predicate evaluating to false
        shouldPass = false;
        // Log first error per episode; suppress subsequent until recovery
        if ( !state.predicateErrorLogged ) {
            state.predicateErrorLogged = true;
            console.error( `WinkComposer/passIf: predicate threw exception: ${error.message}` );
        }
    }

    // Return null to stop flow, state to continue
    return shouldPass ? state : null;
}; // update()

export default update;

/**
 * @fileoverview Helper functions for emitIf node
 *
 * Status signal emission for predicate error state transitions, and the
 * shared publish-failure recording used by both the data path (update.js)
 * and the status-signal path below.
 */

/**
 * Static fallback error the framework substitutes when an adapter breaks
 * the return contract — no result object at all, or `{ ok: false }` with
 * no `error` (ADR-018 error vocabulary). A module-level singleton, so the
 * hot path allocates nothing. Mirrors persist-if.
 */
const MALFORMED_RESULT_ERROR = {
    code: 'MALFORMED_RESULT',
    message: 'emitter returned a malformed publish result (expected { ok, error? })'
};

/**
 * Throws when an annotate return is not a plain object — arrays pass a
 * bare typeof check but are just as wrong. A flow-authoring bug surfaces
 * in the node's own error episode (the predicate/annotate try in
 * update.js), never downstream where it would masquerade as an adapter
 * failure. Mirrors persist-if.
 *
 * @param {*} record - The annotate return value
 * @throws {Error} Naming the offending type
 */
const assertAnnotateReturn = function ( record ) {
    const got = record === null ? 'null' :
        ( Array.isArray( record ) ? 'array' : typeof record );
    if ( got === 'object' ) {
        return;
    }
    throw new Error( `annotate must return an object, got ${got}` );
}; // assertAnnotateReturn()

/**
 * Records a failed publish into the node's failure episode: updates the
 * last* fields, and on the first failure of an episode captures the first*
 * fields and logs one console.error (repeats stay quiet until a successful
 * publish closes the episode — see update.js).
 *
 * @param {Object} state - Node state
 * @param {Object} error - The `{ code, message }` from the emitter's
 *   `{ ok: false }` return (ADR-018 sink return contract)
 */
const recordEmissionFailure = function ( state, error ) {
    state.emissionErrors += 1;
    state.lastEmissionError = error.message;
    state.lastEmissionErrorCode = error.code;
    if ( !state.emitErrorLogged ) {
        state.emitErrorLogged = true;
        state.firstEmissionError = error.message;
        state.firstEmissionErrorCode = error.code;
        console.error( state.emitErrorLogPrefix + error.code + '): ' + error.message );
    }
}; // recordEmissionFailure()

/**
 * Emits disable/enable status signal to the wired emitter. Published
 * unconditionally (no connectivity pre-check per ADR-018 — during a
 * disconnect the signal is still accepted into the emitter's in-process
 * buffer); a failed publish rides the same failure episode as data
 * emissions.
 *
 * @param {Object} state - Node state containing emitter and topic
 * @param {boolean} disable - Whether to disable (true) or enable (false)
 * @param {string} reason - Reason for disable
 */
const emitStatusSignal = function ( state, disable, reason ) {
    if ( !state.emitter ) {
        return;
    }

    const signal = {
        $disable: disable,
        $reason: reason,
        $timestamp: Date.now()
    };

    // Guarded read: this path runs inside update()'s catch block, so a
    // TypeError here would escape update() and kill the pipeline. A
    // malformed result counts as a failure with the static fallback
    // error instead.
    const result = state.emitter.publishNow( state.topic, signal );
    if ( result && result.ok ) {
        return;
    }
    recordEmissionFailure( state, ( result && result.error ) || MALFORMED_RESULT_ERROR );
}; // emitStatusSignal()

export { assertAnnotateReturn, emitStatusSignal, recordEmissionFailure, MALFORMED_RESULT_ERROR };

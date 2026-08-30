// nodes/persist-if/helpers.js

/**
 * @fileoverview Helper functions for persistIf node
 *
 * The shared write-failure recording used by update.js, and the static
 * fallback error for adapters that break the return contract. Mirrors
 * emit-if/helpers.js — the two output gates share one failure model.
 */

/**
 * Static fallback error the framework substitutes when an adapter breaks
 * the return contract — no result object at all, or `{ ok: false }` with
 * no `error` (ADR-018 error vocabulary). A module-level singleton, so the
 * hot path allocates nothing. Mirrors emit-if.
 */
const MALFORMED_RESULT_ERROR = {
    code: 'MALFORMED_RESULT',
    message: 'storage returned a malformed write result (expected { ok, error? })'
};

/**
 * Throws when an annotate return is not a plain object — arrays pass a
 * bare typeof check but are just as wrong. A flow-authoring bug surfaces
 * in the node's own error episode (the predicate/annotate try in
 * update.js), never downstream where it would masquerade as an adapter
 * failure. Mirrors emit-if.
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
 * Warns, once per gate, about invented keys in an annotate record.
 *
 * An invented key is one the annotate function added that is neither a
 * declared column nor a field of the message. Such a key is almost always
 * a typo, and today it fails silently: the persist plan writes only
 * declared columns, so the value never reaches storage. Keys that also
 * exist in the message are skipped on purpose — a `...msg` spread carries
 * many working fields, and naming those would bury the real finding.
 *
 * Runs once per gate. The `checked` flag lives on the wiring-stamped sweep
 * object that every partition shares, and it flips before the comparison,
 * so the check cannot repeat. The Object.keys call and the warning string
 * allocate — once, on this single firing, inside the per-event allocation
 * the function-form annotate already makes. Later firings never reach this
 * function (update.js short-circuits on the flag), so the steady-state hot
 * path stays allocation-free per ADR-004.
 *
 * @param {Object} state - Node state (name, insightType, annotateSweep)
 * @param {Object} record - The record the annotate function returned
 * @param {Object} msg - The message that produced it
 */
const sweepAnnotateKeys = function ( state, record, msg ) {
    const sweep = state.annotateSweep;
    sweep.checked = true;

    const recordKeys = Object.keys( record );
    const invented = [];
    for ( let i = 0; i < recordKeys.length; i += 1 ) {
        const key = recordKeys[ i ];
        if ( !sweep.declaredColumns.has( key ) && !( key in msg ) ) {
            invented.push( key );
        }
    }

    if ( invented.length > 0 ) {
        console.warn(
            `winkComposer/persistIf: annotate for node '${state.name}' ` +
            `(insightType '${state.insightType}') returned keys that are not declared columns: ` +
            `${invented.join( ', ' )}. These values are never stored, because the persist plan ` +
            'writes only declared columns. Check the key names against the asset class. ' +
            'Reported once per gate.'
        );
    }
}; // sweepAnnotateKeys()

/**
 * Records a failed write into the node's failure episode: updates the
 * last* fields, and on the first failure of an episode captures the first*
 * fields and logs one console.error (repeats stay quiet until a successful
 * write closes the episode — see update.js). The first* fields keep the
 * episode-opening error (the cause; later failures in a cascade are
 * symptoms).
 *
 * @param {Object} state - Node state
 * @param {Object} error - The `{ code, message }` from the storage's
 *   `{ ok: false }` return (ADR-018 sink return contract)
 */
const recordPersistFailure = function ( state, error ) {
    state.persistErrors += 1;
    state.lastPersistError = error.message;
    state.lastPersistErrorCode = error.code;
    if ( !state.writeErrorLogged ) {
        state.writeErrorLogged = true;
        state.firstPersistError = error.message;
        state.firstPersistErrorCode = error.code;
        console.error( state.writeErrorLogPrefix + error.code + '): ' + error.message );
    }
}; // recordPersistFailure()

/**
 * Substituted error for a storage adapter that THREW from write() —
 * the other face of a broken return contract (ADR-018: the hot path
 * never throws; a sink answers { ok }). Same code as the
 * malformed-result face: the remediation is identical (fix the
 * non-conforming adapter), and the message names the difference.
 * Allocates on the failure path only. Mirrors emit-if.
 *
 * @param {Error} error - The thrown value
 * @returns {Object} `{ code, message }` for the failure episode
 */
const thrownSinkError = function ( error ) {
    return {
        code: 'MALFORMED_RESULT',
        message: `storage write threw instead of returning { ok, error? }: ${error.message}`
    };
}; // thrownSinkError()

/**
 * Writes one record to the wired storage with the sink call fully
 * guarded. A conforming adapter never throws; a throwing one is a
 * broken adapter, recorded in the persist episode — never escaped
 * into the pipeline where it would also cost the message's other
 * outputs. Returns true only on `{ ok: true }`. Mirrors emit-if's
 * deliverToEmitter.
 *
 * @param {Object} state - Node state containing storage, insightType,
 *   and partitionId
 * @param {Object} record - Record to persist
 * @returns {boolean} True when the storage accepted the record
 */
const writeToStorage = function ( state, record ) {
    try {
        const result = state.storage.write(
            state.insightType,
            record,
            state.partitionId
        );
        if ( result && result.ok ) {
            return true;
        }
        recordPersistFailure( state, ( result && result.error ) || MALFORMED_RESULT_ERROR );
    } catch ( sinkError ) {
        recordPersistFailure( state, thrownSinkError( sinkError ) );
    }
    return false;
}; // writeToStorage()

export {
    assertAnnotateReturn,
    sweepAnnotateKeys,
    recordPersistFailure,
    writeToStorage,
    MALFORMED_RESULT_ERROR
};

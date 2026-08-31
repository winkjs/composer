// nodes/persist-if/update.js

/**
 * @fileoverview Update function for persistIf node
 *
 * Hot path - zero allocation after first message (annotate, when configured,
 * allocates only on the ticks that actually persist - the same per-event
 * asymmetry as emitIf's annotate).
 * Evaluates predicate, optionally shapes the record via annotate, and writes
 * it to the storage buffer if the predicate passed.
 */

import { assertAnnotateReturn, sweepAnnotateKeys, writeToStorage } from './helpers.js';
import { logger } from '../../core/logger/index.js';

/**
 * Process incoming message.
 *
 * @param {Object} state - Node state
 * @param {Object} msg - Incoming message
 * @returns {Object} Updated state (always returns state for pass-through)
 */
const update = function ( state, msg ) {
    // Always increment pass count for observability
    state.passCount += 1;

    // Early exit if storage not available
    if ( !state.storage ) {
        return state;
    }

    // Evaluate predicate, then shape the record when persisting. Annotate
    // mirrors emitIf: both run inside one try, so predicate and annotate
    // share the same error episode (tracking, log suppression, recovery).
    let shouldPersist = false;
    let record = msg;
    try {
        shouldPersist = state.predicate( msg );
        if ( shouldPersist && state.annotate ) {
            record = state.annotate( msg );
            // A flow-authoring bug (non-object return) throws here, into
            // this node's error episode — never into storage.write where
            // it would masquerade as a storage failure (SEND_FAILED).
            assertAnnotateReturn( record );
            // First firing only: warn about invented record keys — typos
            // that would otherwise vanish silently (the persist plan writes
            // only declared columns). Every later firing takes this
            // two-read short-circuit; nothing allocates here.
            if ( state.annotateSweep && !state.annotateSweep.checked ) {
                sweepAnnotateKeys( state, record, msg );
            }
        }

        // Clear error state on successful evaluation
        if ( state.inErrorState ) {
            state.inErrorState = false;
        }
        // Recovery: clear log-suppression flag on success
        if ( state.predicateErrorLogged ) state.predicateErrorLogged = false;
    } catch ( error ) {
        // Handle predicate/annotate errors (semantic — tracks error state)
        if ( !state.inErrorState ) {
            state.inErrorState = true;
        }
        // Log first error per episode; suppress subsequent until recovery
        if ( !state.predicateErrorLogged ) {
            state.predicateErrorLogged = true;
            logger.error( `winkComposer/persistIf: predicate threw exception: ${error.message}` );
        }
        state.persistErrors += 1;
        state.lastPersistError = error.message;
        // Predicate exceptions are persist-if-internal, not part of the
        // ADR-018 adapter err.code vocabulary. Clear the code so the two
        // fields stay in sync (a stale code from a prior storage error
        // would mislead readers).
        state.lastPersistErrorCode = null;
        return state;
    }

    // Write to storage if predicate returned true
    if ( shouldPersist ) {
        // storage.write() is synchronous per ADR-013; the actual I/O happens
        // asynchronously via the storage adapter's background flush.
        // Per the ADR-018 sink return contract, the storage answers
        // { ok: true } on success or
        // { ok: false, error: { code, message } } on failure.
        // writeToStorage guards the call itself too: a THROWING adapter
        // is the other face of a broken contract, recorded in the same
        // adapter episode — a non-conforming adapter can neither fail
        // silently nor throw out of the hot path.
        if ( writeToStorage( state, record ) ) {
            state.persistCount += 1;
            // Wall-clock marker of the last successful write (post-mortem
            // reads only, like the first* error fields).
            state.lastPersistTime = Date.now();
            // Recovery: a successful write closes the failure episode.
            if ( state.writeErrorLogged ) state.writeErrorLogged = false;
        }
    }

    return state;
}; // update()

export default update;

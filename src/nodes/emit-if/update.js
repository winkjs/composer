/**
 * @fileoverview Update function for emitIf node
 *
 * Hot path — evaluates user-supplied predicate and emits to external
 * systems when true. Predicate errors are caught and tracked per-episode.
 *
 * Publishes unconditionally — no connectivity pre-check (ADR-018). The
 * old isConnected() guard skipped publishes during MQTT disconnects, which
 * kept messages OUT of the emitter's buffer: the exact loss buffering
 * exists to prevent. (ADR-021 later replaced the on-disk offline store
 * with an in-process buffer; the invariant is unchanged.) The emitter's
 * { ok } return is the only truth
 * the node consumes; a failure opens a loud episode (mirroring persistIf —
 * the two output gates share one failure model).
 */

import { assertAnnotateReturn, emitStatusSignal, deliverToEmitter } from './helpers.js';
import { logger } from '../../core/logger/index.js';

const update = function ( state, msg ) {
    // Always increment pass count for observability
    state.passCount += 1;

    // Early exit if emitter not available (mirrors persistIf's storage guard)
    if ( !state.emitter ) {
        return state;
    }

    // Evaluate predicate, then shape the payload when emitting. Annotate
    // mirrors persistIf: both run inside one try, so predicate and
    // annotate share the same error episode (tracking, log suppression,
    // recovery).
    try {
        const shouldEmit = state.predicate( msg );
        let data = msg;
        if ( shouldEmit && state.annotate ) {
            data = state.annotate( msg );
            // A flow-authoring bug (non-object return) throws here, into
            // this node's error episode — never published as-is (mirrors
            // persistIf).
            assertAnnotateReturn( data );
        }

        if ( shouldEmit ) {
            // Per the ADR-018 sink return contract, the emitter answers
            // { ok: true } on success or
            // { ok: false, error: { code, message } } on failure.
            // deliverToEmitter guards the call itself too: a THROWING
            // emitter is the other face of a broken contract, recorded
            // in the same adapter episode — a non-conforming adapter
            // can neither fail silently nor throw out of the hot path.
            if ( deliverToEmitter( state, data ) ) {
                state.emissionCount += 1;
                state.lastEmissionTime = Date.now();
                // Recovery: a successful publish closes the failure episode.
                if ( state.emitErrorLogged ) state.emitErrorLogged = false;
            }
        }

        // Clear error state on successful evaluation
        if ( state.inErrorState ) {
            state.inErrorState = false;
            emitStatusSignal( state, false, 'recovered' );
        }
        // Recovery: clear log-suppression flag on success
        if ( state.predicateErrorLogged ) state.predicateErrorLogged = false;
    } catch ( error ) {
        // Handle predicate errors (semantic — emits status signal)
        if ( !state.inErrorState ) {
            state.inErrorState = true;
            emitStatusSignal( state, true, error.message );
        }
        // Log first error per episode; suppress subsequent until recovery
        if ( !state.predicateErrorLogged ) {
            state.predicateErrorLogged = true;
            logger.error( `winkComposer/emitIf: predicate threw exception: ${error.message}` );
        }
        state.emissionErrors += 1;
        state.lastEmissionError = error.message;
        // Predicate exceptions are emit-if-internal, not part of the
        // ADR-018 adapter err.code vocabulary. Clear the code so the two
        // fields stay in sync (a stale code from a prior publish failure
        // would mislead readers).
        state.lastEmissionErrorCode = null;
    }

    return state;
}; // update()

export default update;

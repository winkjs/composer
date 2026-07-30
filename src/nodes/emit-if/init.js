/**
 * @fileoverview Initialization for emitIf node
 *
 * Validates specification and creates initial state for conditional
 * emission to external systems (MQTT, GPIO, terminal).
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    // Create state after validation passes
    const state = Object.create( null );

    // Core configuration
    state.nodeType = introspect.getNodeType();
    state.name = spec.name;
    state.requires = spec.requires;
    state.predicate = spec.predicate;
    state.target = spec.target;
    state.emitter = spec.emitter;
    state.annotate = spec.annotate || null;
    state.insightType = spec.insightType;
    // state.topic is injected by the partition manager during partition
    // creation (not per-message). The topic encodes partition-scoped
    // identity: edgeDeviceId/partitionId/specialization/insightType.
    // This is an acceptable exception to "state shape fixed at init"
    // because the partition ID is unknown until the first message arrives.
    // See: partition-manager/update.js — MQTT TOPIC INJECTION block.
    // Used by: update.js (emitter.publishNow) and helpers.js (status signals).

    // State transition tracking (semantic — controls status signals)
    state.inErrorState = false;
    // Log suppression: one log per error episode; reset on recovery.
    state.predicateErrorLogged = false;

    // Statistics for observability
    state.emissionCount = 0;
    state.passCount = 0;
    state.lastEmissionTime = null;

    // Error tracking
    state.emissionErrors = 0;
    state.lastEmissionError = null;
    // Mirrors persistIf: the code from the emitter's { ok: false, error:
    // { code, message } } return; null when the error came from a predicate
    // exception (predicate failures are not classified by the contract).
    state.lastEmissionErrorCode = null;
    // Publish-failure episode (mirrors persistIf's write-failure episode):
    // one console.error per episode; a successful publish closes it. The
    // first* fields keep the episode-opening error — in a cascade the LAST
    // error is the symptom and the FIRST is the cause. They survive
    // recovery for post-mortem reads and are overwritten only when the
    // next episode opens.
    state.emitErrorLogged = false;
    state.firstEmissionError = null;
    state.firstEmissionErrorCode = null;
    // Static log prefix pre-built here per ADR-004 (no string building in
    // update beyond the two runtime fields, and only once per episode).
    state.emitErrorLogPrefix = `WinkComposer/emitIf: publish failed (node=${state.name}, insightType=${state.insightType}, code=`;

    return state;
}; // init()

export default init;

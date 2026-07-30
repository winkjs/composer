// nodes/persist-if/init.js

/**
 * @fileoverview Initialization for persistIf node
 *
 * Validates specification and creates initial state with pre-allocated
 * structures for zero-allocation hot path.
 */

import { validateWithSchema } from '../../core/utils/validate/index.js';
import { getDSLMetadata, getNodeType } from './introspect.js';

/**
 * Initialize persistIf node state.
 *
 * @param {Object} spec - Node specification
 * @param {string} spec.nodeType - Must be 'Persist If'
 * @param {string} spec.name - Node identifier
 * @param {Function} spec.predicate - Function to evaluate for persistence
 * @param {string} spec.insightType - Insight type (maps to storage table)
 * @param {string} spec.storageName - Name of registered storage adapter
 * @param {Function} [spec.annotate] - Shapes the stored record: write annotate( msg )
 *   instead of msg. Mirrors emitIf's annotate; the persist plan still writes only
 *   the insight type's declared columns, so the hook cannot widen the schema.
 * @param {Object} [spec.annotateSweep] - Stamped by wiring, not by flow authors:
 *   the declared-column set plus a shared once-flag for the first-firing
 *   unknown-key warning (see helpers.js sweepAnnotateKeys)
 * @returns {Object} Initialized state
 */
const init = function ( spec ) {
    // Validate specification
    const metadata = getDSLMetadata();
    const validation = validateWithSchema(
        {
            ...metadata.specSchema,
            _crossFieldValidators: metadata.crossFieldValidators
        },
        spec,
        'spec'
    );
    validation.throwIfInvalid( getNodeType() );

    // Create state after validation passes
    const state = Object.create( null );

    // Core configuration
    state.nodeType = getNodeType();
    state.name = spec.name;
    state.predicate = spec.predicate;
    state.insightType = spec.insightType;
    state.storageName = spec.storageName;
    state.annotate = spec.annotate || null;
    // Annotate key-sweep support, stamped by wiring (wire-storages) when a
    // function-form annotate can be checked against declared columns. The
    // object is shared by every partition of this gate on purpose: its
    // `checked` flag makes the unknown-key warning fire once per gate, not
    // once per partition. Unit tests and flows without an asset class have
    // no stamp; null disables the check.
    state.annotateSweep = spec.annotateSweep || null;

    // Storage reference (injected by partition manager at runtime)
    state.storage = null;

    // State transition tracking (semantic — controls error tracking)
    state.inErrorState = false;
    // Log suppression: one log per error episode; reset on recovery.
    state.predicateErrorLogged = false;

    // Statistics for observability
    state.persistCount = 0;
    state.passCount = 0;
    state.lastPersistTime = null;

    // Error tracking
    state.persistErrors = 0;
    state.lastPersistError = null;
    // Per ADR-018 the storage write returns { ok: false, error: { code, message } }
    // on failure. We surface both fields: lastPersistError is the human message
    // (predicate exceptions also write here as a string), lastPersistErrorCode
    // is the structured code (null when the error came from a predicate exception
    // since predicate failures are not classified by the contract).
    state.lastPersistErrorCode = null;
    // Write-failure episode: one console.error per episode; a successful
    // write closes it. The first* fields keep the episode-opening error —
    // in a cascade the LAST error is the symptom and the FIRST is the
    // cause. They survive recovery for post-mortem reads and are
    // overwritten only when the next episode opens.
    state.writeErrorLogged = false;
    state.firstPersistError = null;
    state.firstPersistErrorCode = null;
    // Static log prefix pre-built here per ADR-004 (no string building in
    // update beyond the two runtime fields, and only once per episode).
    state.writeErrorLogPrefix = `WinkComposer/persistIf: storage write failed (node=${state.name}, insightType=${state.insightType}, code=`;

    return state;
}; // init()

export default init;

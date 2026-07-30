// nodes/emit-if/test/test-helpers.js

/**
 * @fileoverview Shared fixtures for the emitIf spec files.
 */

import sinon from 'sinon';

/**
 * Creates a mock emitter for testing. Mirrors the ADR-018 sink return
 * contract: `publishNow` returns `{ ok: true }` on success or `{ ok:
 * false, error: { code, message } }` on failure. The handle has no
 * `isConnected` — that method is retired (ADR-018: no connectivity
 * pre-checks; publish and read the classified result).
 *
 * @param {Object} [publishResult] - Result publishNow returns.
 *   Default `{ ok: true }`. Pass an error-shaped result to exercise the
 *   failure branch.
 * @returns {Object} Mock emitter
 */
const createMockEmitter = function ( publishResult = { ok: true } ) {
    return {
        publishNow: sinon.stub().returns( publishResult )
    };
};

export { createMockEmitter };

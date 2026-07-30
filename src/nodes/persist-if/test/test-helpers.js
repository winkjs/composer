// nodes/persist-if/test/test-helpers.js

/**
 * @fileoverview Shared fixtures for the persistIf spec files.
 */

import sinon from 'sinon';

/**
 * Creates a mock storage for testing. Mirrors the ADR-018 sink return
 * contract: `write` returns `{ ok: true }` on success or `{ ok: false,
 * error: { code, message } }` on failure.
 *
 * @param {Object} [options] - Mock options
 * @param {Object} [options.writeResult] - Result to return from write().
 *   Default `{ ok: true }`. Pass an error-shaped result to exercise the
 *   error branch.
 * @returns {Object} Mock storage
 */
const createMockStorage = function ( options = {} ) {
    const writeResult = options.writeResult || { ok: true };

    return {
        write: sinon.stub().returns( writeResult ),
        flush: sinon.stub().resolves( {} ),
        shutdown: sinon.stub().resolves( {} )
    };
};

export { createMockStorage };

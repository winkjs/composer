// core/storage-manager/test/test-helpers.js

/**
 * @fileoverview Shared mock-storage builders for test files.
 *
 * Tests across this codebase need to wire up a storage adapter without
 * connecting to a real QuestDB. Before this helper, each test file
 * inlined its own little stub object with `write`, `shutdown`, and so on
 * — about 25 sites in `wire-storages.specs.js` alone. The duplication
 * was harmless until the contract changed (`flush` semantics arrived,
 * then `getHealth` joined the required floor); then every site
 * needed updating.
 *
 * This file gives those tests a single conformant default: build a mock
 * that satisfies the ADR-018 method floor for structured sinks out of the
 * box, override any method with a sinon spy or stub when the test wants
 * to inspect calls.
 *
 * Two builders:
 * - `makeMockStorageHandle(overrides)` — the object the framework calls
 *   `write`/`flush`/`shutdown`/`getHealth` on.
 * - `makeMockStorageModule(handleOverrides)` — wraps the handle in the
 *   `{ id, createStorage }` shape that wire-storages consumes via the
 *   `storageModules` parameter.
 *
 * For tests that deliberately verify the wire-time assertion fires on a
 * MISSING method, keep the mock inline and explicit
 * — the intent ("we're omitting `flush` to verify the assertion catches
 * it") reads better at the test site than a helper-with-an-exotic-flag
 * would.
 *
 * @see ADR-018 (structured-sink contract)
 * @see src/core/wiring/assert-handle.js (the wire-time check these mocks satisfy)
 */

/**
 * Build a mock storage handle that satisfies ADR-018's required method
 * floor for structured sinks: `write`, `flush`, `shutdown`, `getHealth`.
 * Defaults are no-op stubs that also return contract-correct values
 * (write → { ok: true }, etc.) so downstream consumers see realistic
 * shapes.
 *
 * Override any method by passing it in `overrides`. Spread order is
 * important: defaults first, overrides last, so a provided method wins.
 *
 * @param {Object} [overrides] - per-method overrides (sinon spies/stubs
 *   or custom implementations)
 * @returns {Object} mock storage handle
 *
 * @example
 *   // Just need a working mock for an integration test:
 *   const storage = makeMockStorageHandle();
 *
 *   // Inspect write calls:
 *   const writeSpy = sinon.spy();
 *   const storage = makeMockStorageHandle( { write: writeSpy } );
 *   ...
 *   expect( writeSpy.calledWith( 'monitoring', { ts: 1 }, 'p1' ) ).to.equal( true );
 *
 *   // Force write to fail:
 *   const storage = makeMockStorageHandle( {
 *       write: function () {
 *           return { ok: false, error: { code: 'SEND_FAILED', message: 'mock' } };
 *       }
 *   } );
 */
const makeMockStorageHandle = function ( overrides = {} ) {
    return {
        write: function () {
            return { ok: true };
        },
        flush: function () {
            return Promise.resolve();
        },
        shutdown: function () {
            return Promise.resolve();
        },
        getHealth: function () {
            return { status: 'green', connected: true };
        },
        ...overrides
    };
}; // makeMockStorageHandle()

/**
 * Build a mock storage module — the `{ id, createStorage }` wrapper that
 * wire-storages reads from the `storageModules` map. The factory returns
 * a fresh `makeMockStorageHandle( handleOverrides )` on every call.
 *
 * Use this when the test wants to drive the wiring layer end-to-end
 * (rather than constructing a handle and assigning it directly).
 *
 * @param {Object} [handleOverrides] - forwarded to makeMockStorageHandle
 *   on each createStorage call
 * @returns {{ id: string, createStorage: function }}
 */
const makeMockStorageModule = function ( handleOverrides = {} ) {
    return {
        id: 'mockStorage',
        durabilityClass: 'best-effort',
        createStorage: function () {
            return makeMockStorageHandle( handleOverrides );
        }
    };
}; // makeMockStorageModule()

export { makeMockStorageHandle, makeMockStorageModule };

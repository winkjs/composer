// core/emitter-manager/test/test-helpers.js

/**
 * @fileoverview Shared mock-emitter builders for test files.
 *
 * Tests across this codebase need to wire up an emitter without spinning
 * up a real MQTT broker or hitting stdout. Before this helper, each test
 * file inlined its own little stub object with `publishNow`, `shutdown`,
 * and so on — about 36 sites when this helper was extracted. The
 * duplication was harmless until the contract changed (`getHealth`
 * joined the required floor); then every site needed updating.
 *
 * This file gives those tests a single conformant default: build a mock
 * that satisfies the ADR-018 sink-handle floor out of the box, override any
 * method with a sinon spy or stub when the test wants to inspect calls.
 *
 * Two builders:
 * - `makeMockEmitterHandle(overrides)` — the object the framework calls
 *   `publishNow`/`shutdown`/`getHealth` on.
 * - `makeMockEmitterModule(handleOverrides)` — wraps the handle in the
 *   `{ id, createEmitter }` shape that wire-emitters consumes via the
 *   `emitterModules` parameter.
 *
 * For tests that deliberately verify the wire-time assertion fires on a
 * MISSING method, keep the mock inline and explicit
 * — the intent ("we're omitting `getHealth` to verify the assertion
 * catches it") reads better at the test site than a helper-with-an-
 * exotic-flag would.
 *
 * @see ADR-018 (sink contract)
 * @see src/core/wiring/assert-handle.js (the wire-time check these mocks satisfy)
 */

/**
 * Build a mock emitter handle that satisfies ADR-018's required sink-handle floor:
 * `publishNow`, `shutdown`, `getHealth`. Defaults are no-op stubs that
 * also return contract-correct values (publishNow → { ok: true }, etc.)
 * so downstream consumers see realistic shapes.
 *
 * Override any method by passing it in `overrides`. Spread order is
 * important: defaults first, overrides last, so a provided method wins.
 *
 * @param {Object} [overrides] - per-method overrides (sinon spies/stubs
 *   or custom implementations)
 * @returns {Object} mock emitter handle
 *
 * @example
 *   // Just need a working mock for an integration test:
 *   const emitter = makeMockEmitterHandle();
 *
 *   // Inspect publishNow calls:
 *   const publishSpy = sinon.spy();
 *   const emitter = makeMockEmitterHandle( { publishNow: publishSpy } );
 *   ...
 *   expect( publishSpy.calledWith( 'topic', { foo: 1 } ) ).to.equal( true );
 */
const makeMockEmitterHandle = function ( overrides = {} ) {
    return {
        publishNow: function () {
            return { ok: true };
        },
        shutdown: function () {
            return Promise.resolve();
        },
        getHealth: function () {
            return { status: 'green', connected: true };
        },
        ...overrides
    };
}; // makeMockEmitterHandle()

/**
 * Build a mock emitter module — the `{ id, createEmitter }` wrapper that
 * wire-emitters reads from the `emitterModules` map. The factory returns
 * a fresh `makeMockEmitterHandle( handleOverrides )` on every call.
 *
 * Use this when the test wants to drive the wiring layer end-to-end
 * (rather than constructing a handle and assigning it directly).
 *
 * @param {Object} [handleOverrides] - forwarded to makeMockEmitterHandle
 *   on each createEmitter call
 * @returns {{ id: string, createEmitter: function }}
 */
const makeMockEmitterModule = function ( handleOverrides = {} ) {
    return {
        id: 'mockEmitter',
        durabilityClass: 'best-effort',
        createEmitter: function () {
            return makeMockEmitterHandle( handleOverrides );
        }
    };
}; // makeMockEmitterModule()

export { makeMockEmitterHandle, makeMockEmitterModule };

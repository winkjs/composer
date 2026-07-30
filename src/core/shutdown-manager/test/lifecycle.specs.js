// core/shutdown-manager/test/lifecycle.specs.js

/**
 * @fileoverview Tests for the shutdown-manager.
 *
 * Covers the responsibilities the manager owns under ADR-018 (the
 * process layer of the flow lifecycle and signal handling):
 *
 * - **Handle registry** — register / unregister flow handles; signal
 *   handlers iterate registered handles via `handle.shutdown()`.
 * - **Idempotent attachHandlers** — second call is a no-op so flows
 *   that auto-attach plus legacy callers that explicitly attach do
 *   not accumulate process listeners. The `MaxListenersExceededWarning`
 *   that earlier polluted the test suite traces to this.
 * - **Top-level forced-shutdown timeout** — a hung handle does not
 *   block the process; if the drain exceeds the configured ceiling
 *   (default 30s, set via `ENV_VARS.shutdownForceTimeoutMs`), the
 *   manager returns false so the caller can force-exit with code 1.
 *
 * The legacy path is now emitters-only: the sources half (wire-sources
 * and the OPC-UA example runners) was removed 2026-07-07 (ADR-019).
 *
 * Tests use `createShutdownManager()` (the factory exported alongside
 * the default singleton) so each spec gets isolated internal state. The
 * factory is the same shape as the production singleton — production
 * just calls it once.
 *
 * Signal-handler delivery itself is NOT tested via real SIGINT (which
 * would interrupt the test runner). Instead the tests verify
 * `process.listenerCount('SIGINT')` / `'SIGTERM'` before and after
 * `attachHandlers()`, then detach explicitly so the test suite
 * baseline stays clean.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { createShutdownManager } from '../index.js';
import { emitters } from '../../wiring/index.js';

// Helper: snapshot the SIGINT/SIGTERM listener counts so each spec can
// assert before/after deltas without depending on whatever the runner's
// own listeners look like.
const listenerSnapshot = function () {
    return {
        sigint: process.listenerCount( 'SIGINT' ),
        sigterm: process.listenerCount( 'SIGTERM' )
    };
};

// Helper: fully detach any signal listeners installed by attachHandlers
// during a test. Identifies the manager's listeners by matching the
// internal `signalHandler` arrow we registered (process exposes them
// via `process.listeners(name)`). The simpler approach used here:
// snapshot before, snapshot after, detach the new ones by name where
// possible — but since attachHandlers uses anonymous arrows, we detach
// ALL listeners added since the snapshot. Tests do this in afterEach
// so the suite-level baseline never grows.
const detachListenersAfter = function ( before ) {
    const sigintListeners = process.listeners( 'SIGINT' );
    const sigtermListeners = process.listeners( 'SIGTERM' );
    for ( let i = before.sigint; i < sigintListeners.length; i += 1 ) {
        process.off( 'SIGINT', sigintListeners[ i ] );
    }
    for ( let i = before.sigterm; i < sigtermListeners.length; i += 1 ) {
        process.off( 'SIGTERM', sigtermListeners[ i ] );
    }
};

describe( 'shutdown-manager — handle registry', function () {

    let manager;

    beforeEach( function () {
        manager = createShutdownManager();
    } );

    it( 'register returns an unregister function', function () {
        const handle = { shutdown: () => Promise.resolve() };
        const unregister = manager.register( handle );

        expect( unregister ).to.be.a( 'function' );
    } );

    it( 'shutdown drains a registered handle', async function () {
        // Stub the legacy-path method so we test handle iteration in
        // isolation. Returning [] simulates "no legacy registry entries"
        // — modern flow scenario.
        const emittersShutdown = sinon.stub( emitters, 'shutdown' ).resolves( [] );
        // Silence the shutdown's console output for test cleanliness.
        const logStub = sinon.stub( console, 'log' );

        try {
            const handleShutdown = sinon.stub().resolves();
            const handle = { shutdown: handleShutdown };
            manager.register( handle );

            const graceful = await manager.shutdown();

            expect( graceful ).to.equal( true );
            expect( handleShutdown.calledOnce ).to.equal( true );
        } finally {
            emittersShutdown.restore();
            logStub.restore();
        }
    } );

    it( 'shutdown drains multiple registered handles in parallel', async function () {
        const emittersShutdown = sinon.stub( emitters, 'shutdown' ).resolves( [] );
        const logStub = sinon.stub( console, 'log' );

        try {
            const h1 = { shutdown: sinon.stub().resolves() };
            const h2 = { shutdown: sinon.stub().resolves() };
            const h3 = { shutdown: sinon.stub().resolves() };
            manager.register( h1 );
            manager.register( h2 );
            manager.register( h3 );

            await manager.shutdown();

            expect( h1.shutdown.calledOnce ).to.equal( true );
            expect( h2.shutdown.calledOnce ).to.equal( true );
            expect( h3.shutdown.calledOnce ).to.equal( true );
        } finally {
            emittersShutdown.restore();
            logStub.restore();
        }
    } );

    it( 'unregister removes the handle so shutdown does not invoke it', async function () {
        const emittersShutdown = sinon.stub( emitters, 'shutdown' ).resolves( [] );
        const logStub = sinon.stub( console, 'log' );

        try {
            const detached = { shutdown: sinon.stub().resolves() };
            const stillRegistered = { shutdown: sinon.stub().resolves() };
            const unregister = manager.register( detached );
            manager.register( stillRegistered );

            // Detach one — simulates a flow whose caller already called
            // handle.shutdown() directly and self-removed from the roster.
            unregister();

            await manager.shutdown();

            expect( detached.shutdown.called ).to.equal( false );
            expect( stillRegistered.shutdown.calledOnce ).to.equal( true );
        } finally {
            emittersShutdown.restore();
            logStub.restore();
        }
    } );

    it( 'register is idempotent — registering the same handle twice still results in one entry', async function () {
        // Map keyed by handle object means double-registration is
        // collapsed to one entry. A single unregister fully removes
        // it. (Switched from synthetic IDs to a handle-keyed Map so
        // identity, not a generated ID, is what dedupes.)
        const emittersShutdown = sinon.stub( emitters, 'shutdown' ).resolves( [] );
        const logStub = sinon.stub( console, 'log' );

        try {
            const handle = { shutdown: sinon.stub().resolves() };
            manager.register( handle );
            manager.register( handle );  // same handle, second time

            await manager.shutdown();

            // Drain visited the handle exactly once even though we
            // registered it twice — Map dedupes by handle identity.
            expect( handle.shutdown.calledOnce ).to.equal( true );
        } finally {
            emittersShutdown.restore();
            logStub.restore();
        }
    } );

    it( 'shutdown is idempotent — second call returns true without re-running', async function () {
        const emittersShutdown = sinon.stub( emitters, 'shutdown' ).resolves( [] );
        const logStub = sinon.stub( console, 'log' );

        try {
            const handle = { shutdown: sinon.stub().resolves() };
            manager.register( handle );

            const r1 = await manager.shutdown();
            const r2 = await manager.shutdown();

            expect( r1 ).to.equal( true );
            expect( r2 ).to.equal( true );
            // Handle's shutdown was invoked once across both calls.
            expect( handle.shutdown.calledOnce ).to.equal( true );
        } finally {
            emittersShutdown.restore();
            logStub.restore();
        }
    } );

} );

describe( 'shutdown-manager — top-level forced-shutdown timeout', function () {

    let manager;
    let envVarsStub;
    let emittersShutdown;
    let logStub;
    let warnStub;

    beforeEach( async function () {
        // Tighten the timeout so the test runs fast. We do this by
        // stubbing ENV_VARS.shutdownForceTimeoutMs BEFORE constructing
        // the manager, since the manager reads the value at shutdown
        // time anyway (no caching).
        const envVarsModule = await import( '../../env-vars.js' );
        envVarsStub = sinon.stub( envVarsModule.ENV_VARS, 'shutdownForceTimeoutMs' ).value( 50 );

        emittersShutdown = sinon.stub( emitters, 'shutdown' ).resolves( [] );
        logStub = sinon.stub( console, 'log' );
        warnStub = sinon.stub( console, 'warn' );

        manager = createShutdownManager();
    } );

    afterEach( function () {
        envVarsStub.restore();
        emittersShutdown.restore();
        logStub.restore();
        warnStub.restore();
    } );

    it( 'returns false when a registered handle hangs past the configured timeout', async function () {
        const hangingHandle = {
            shutdown: () => new Promise( () => { /* never resolves */ } )
        };
        manager.register( hangingHandle );

        const graceful = await manager.shutdown();

        expect( graceful ).to.equal( false );
        // The forced-shutdown warning fired
        const warnCalls = warnStub.getCalls().map( ( c ) => c.args.join( ' ' ) );
        expect( warnCalls.some( ( m ) => m.includes( 'Forced shutdown' ) ) ).to.equal( true );
    } );

    it( 'returns true when the drain completes within the timeout', async function () {
        const fastHandle = {
            shutdown: () => new Promise( ( resolve ) => setTimeout( resolve, 5 ) )
        };
        manager.register( fastHandle );

        const graceful = await manager.shutdown();

        expect( graceful ).to.equal( true );
    } );

    it( 'returns true when no handles are registered (skips drain)', async function () {
        const graceful = await manager.shutdown();

        expect( graceful ).to.equal( true );
    } );

    it( 'does not leave the force timer keeping the event loop alive after a successful drain', function ( done ) {
        // When the drain wins the race, the loser timer must be
        // cancelled — otherwise it pins the event loop until it
        // fires, delaying clean process exit by up to
        // `shutdownForceTimeoutMs` (default 30 s).
        //
        // We assert this by counting refed Node handles around the
        // shutdown call: the count after the drain must not be
        // higher than before. If clearTimeout is missing, the timer
        // shows up in `process._getActiveHandles()` until it fires.
        const fastHandle = {
            shutdown: function () {
                return Promise.resolve();
            }
        };
        manager.register( fastHandle );

        // eslint-disable-next-line no-underscore-dangle
        const before = process._getActiveHandles().length;
        manager.shutdown().then( function () {

            // eslint-disable-next-line no-underscore-dangle
            const after = process._getActiveHandles().length;
            try {
                expect( after, 'force timer was not cancelled after drain won' ).to.be.at.most( before );
                done();
            } catch ( err ) {
                done( err );
            }
        } );
    } );

} );

describe( 'shutdown-manager — attachHandlers idempotency', function () {

    let manager;
    let before;

    beforeEach( function () {
        manager = createShutdownManager();
        before = listenerSnapshot();
    } );

    afterEach( function () {
        // Detach anything attachHandlers added so the test-suite
        // baseline never grows. The MaxListenersExceededWarning that
        // motivated this manager originally accumulated because tests
        // didn't do this.
        detachListenersAfter( before );
    } );

    it( 'first call adds one SIGINT and one SIGTERM listener', function () {
        manager.attachHandlers();
        const after = listenerSnapshot();

        expect( after.sigint ).to.equal( before.sigint + 1 );
        expect( after.sigterm ).to.equal( before.sigterm + 1 );
    } );

    it( 'second call is a no-op (idempotent via internal flag)', function () {
        manager.attachHandlers();
        const afterFirst = listenerSnapshot();

        manager.attachHandlers();
        const afterSecond = listenerSnapshot();

        expect( afterSecond.sigint ).to.equal( afterFirst.sigint );
        expect( afterSecond.sigterm ).to.equal( afterFirst.sigterm );
    } );

    it( 'idempotency is per-instance — a second factory instance attaches its own listeners', function () {
        manager.attachHandlers();
        const afterFirst = listenerSnapshot();

        const second = createShutdownManager();
        second.attachHandlers();
        const afterSecond = listenerSnapshot();

        // Different instances each register once
        expect( afterSecond.sigint ).to.equal( afterFirst.sigint + 1 );
        expect( afterSecond.sigterm ).to.equal( afterFirst.sigterm + 1 );
    } );

} );

describe( 'shutdown-manager — owns no storage (2026-07-09)', function () {

    let manager;
    let fsRmStub;

    beforeEach( async function () {
        manager = createShutdownManager();
        sinon.stub( emitters, 'shutdown' ).resolves( [] );
        sinon.stub( console, 'log' );
        const fsModule = await import( 'node:fs/promises' );
        fsRmStub = sinon.stub( fsModule.default, 'rm' ).resolves();
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'shutdown never deletes anything from the filesystem', async function () {
        // The storage-cleanup rm block existed for the emitter's LevelDB
        // store. ADR-021 removed the store, so nothing writes under
        // STORAGE_DIR any more — and a recursive delete with no producer
        // behind it is a hazard, not a feature. Shutdown must not touch
        // the filesystem at all.
        const graceful = await manager.shutdown();

        expect( graceful ).to.equal( true );
        expect( fsRmStub.called ).to.equal( false );
    } );

} );

describe( 'shutdown-manager — legacy emitters branch', function () {

    let manager;
    let emittersShutdown;
    let logStub;
    let warnStub;

    beforeEach( function () {
        manager = createShutdownManager();
        logStub = sinon.stub( console, 'log' );
        warnStub = sinon.stub( console, 'warn' );
    } );

    afterEach( function () {
        emittersShutdown.restore();
        logStub.restore();
        warnStub.restore();
    } );

    it( 'logs flushed message when emitter shutdowns succeed', async function () {
        // Non-empty emitterResults with no rejections takes the success
        // log branch. Two fulfilled entries emulate two legacy emitters.
        emittersShutdown = sinon.stub( emitters, 'shutdown' ).resolves( [
            { status: 'fulfilled', value: undefined },
            { status: 'fulfilled', value: undefined }
        ] );

        await manager.shutdown();

        const logMessages = logStub.getCalls().map( ( c ) => c.args.join( ' ' ) );
        const sawFlushed = logMessages.some( ( m ) => m.includes( 'Legacy message queues flushed' ) );
        expect( sawFlushed ).to.equal( true );
    } );

    it( 'warns when one or more emitter shutdowns reject', async function () {
        emittersShutdown = sinon.stub( emitters, 'shutdown' ).resolves( [
            { status: 'fulfilled', value: undefined },
            { status: 'rejected', reason: new Error( 'broker unreachable' ) }
        ] );

        await manager.shutdown();

        const warnMessages = warnStub.getCalls().map( ( c ) => c.args.join( ' ' ) );
        const sawFailWarn = warnMessages.some( ( m ) => m.includes( 'legacy emitter' ) && m.includes( 'failed to shutdown' ) );
        expect( sawFailWarn ).to.equal( true );
    } );

} );


describe( 'shutdown-manager — error path inside legacy block', function () {

    let manager;
    let emittersShutdown;
    let logStub;
    let warnStub;
    let errorStub;
    let originalExitCode;

    beforeEach( function () {
        manager = createShutdownManager();
        // Simulate the legacy block throwing — exercises the catch block
        // that sets process.exitCode = 1 and returns false.
        emittersShutdown = sinon.stub( emitters, 'shutdown' ).rejects( new Error( 'simulated legacy failure' ) );
        logStub = sinon.stub( console, 'log' );
        warnStub = sinon.stub( console, 'warn' );
        errorStub = sinon.stub( console, 'error' );
        originalExitCode = process.exitCode;
    } );

    afterEach( function () {
        emittersShutdown.restore();
        logStub.restore();
        warnStub.restore();
        errorStub.restore();
        // Restore process.exitCode so a single error-path spec doesn't
        // mark the whole suite failed.
        process.exitCode = originalExitCode;
    } );

    it( 'returns false and sets process.exitCode=1 when the legacy path throws', async function () {
        // Note: emitters.shutdown is awaited via plain await (not
        // Promise.allSettled) inside the legacy block, so a rejection
        // there bubbles up to the catch.
        const graceful = await manager.shutdown();

        expect( graceful ).to.equal( false );
        expect( process.exitCode ).to.equal( 1 );
        const errorMessages = errorStub.getCalls().map( ( c ) => c.args.join( ' ' ) );
        const sawShutdownError = errorMessages.some( ( m ) => m.includes( 'Shutdown error' ) );
        expect( sawShutdownError ).to.equal( true );
    } );

} );

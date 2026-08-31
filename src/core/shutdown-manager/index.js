// core/shutdown-manager/index.js

/**
 * @fileoverview Process-layer shutdown manager.
 *
 * Per ADR-018, the framework has three layers — adapter, flow, and
 * process — each owning a distinct concern in the lifecycle. This file
 * is the process layer.
 *
 * What this layer owns:
 * - **OS signal handlers (SIGINT/SIGTERM)** as the SOLE owner. The flow
 *   layer (`flow/run.js`) does NOT attach signal handlers; it auto-
 *   registers each running flow's `handle` here, and this file routes
 *   signals to `handle.shutdown()` for every registered handle.
 * - **Top-level forced-shutdown timeout** that bounds the entire
 *   `handle.shutdown()` drain. If a flow takes longer than
 *   `ENV_VARS.shutdownForceTimeoutMs` (default 30000ms, matching
 *   Kubernetes' `terminationGracePeriodSeconds`), this layer logs and
 *   force-exits with code 1; otherwise exits with code 0 on graceful
 *   completion. The ADR documents three nested timeouts, each on a
 *   wider scope: the per-adapter `{ timeout }` (one adapter's drain),
 *   the per-flow stage budget, and this process-level ceiling on the
 *   whole exit.
 * - **Exit 1 on a data-losing stop** (the 2026-08-29 ruling). A drain
 *   that rejects means that flow lost data at shutdown; the adapter
 *   said so with a classified error. Each rejection prints one
 *   classified console line, and the process exits 1 — a supervisor
 *   (systemd, Docker, Kubernetes, a batch script) must never read a
 *   data-losing stop as clean. This extends ADR-018's delivery
 *   invariant to the process boundary. Callers who invoke
 *   `handle.shutdown()` directly are unaffected: they receive the
 *   rejection themselves and own their own response.
 *
 * This layer owns NO storage. The storage-directory cleanup it used to
 * run (an `fs.rm` of STORAGE_DIR at dev/test shutdown) was removed
 * 2026-07-09: the emitter's LevelDB store — removed by ADR-021 — was
 * the only thing that ever wrote there, and a recursive delete with no
 * producer behind it is a hazard, not a feature.
 *
 * What this layer does NOT own:
 * - Per-flow shutdown orchestration. Each registered handle's
 *   `handle.shutdown()` runs its own ordered teardown
 *   (source → emitters → storages) via `flow/run.js`'s closure.
 *
 * Idempotent attach. `attachHandlers()` is safe to call multiple times;
 * the second call is a no-op via the internal `attached` flag. This
 * closes the `MaxListenersExceededWarning` that earlier accumulated
 * across test runs (each `flow.run()` had registered its own handlers
 * without detach).
 *
 * Legacy path. The block below labelled "LEGACY PATH — scheduled for
 * retirement" exists to serve the pre-DSL example flows
 * (`cpd-run.js`, `rwm-csv-run.js` via their flow files) that wire
 * emitters via `emitters.wire()` and rely on this manager's
 * `emitters.shutdown()`. Modern `flow().run()` pipelines do not use
 * that path — their registries are already drained by
 * `handle.shutdown()` (called from the registered-handle iteration
 * above), so the legacy block finds an empty registry and is a benign
 * no-op for them. The sources half of this path (`wire-sources.js`,
 * the OPC-UA example runners) was removed 2026-07-07 — see ADR-019.
 * The emitters half retires when the legacy examples migrate to the
 * modern flow API.
 *
 * @see ADR-018 (flow lifecycle and signal handling)
 */

import { emitters } from '../wiring/index.js';
import { ENV_VARS } from '../env-vars.js';
import { logger } from '../logger/index.js';

/**
 * Factory that produces a fresh shutdown-manager instance with isolated
 * internal state. The default export below calls this once for the
 * production singleton; tests call it per spec to get an isolated
 * instance and avoid state bleed across cases. Same shape as the
 * earlier in-file IIFE; the factoring is purely for testability.
 *
 * @returns {{shutdown, attachHandlers, register}} the manager API
 */
const createShutdownManager = function () {
    // ========================================================================
    // PRIVATE STATE
    // ========================================================================

    // Guards against re-entry if a signal arrives mid-shutdown.
    let isShuttingDown = false;

    // `attachHandlers` idempotency flag. Multiple calls (e.g., from
    // `flow().run()` auto-attach AND from a legacy example's explicit
    // call) are no-ops after the first.
    let attached = false;

    // Map of registered flow handles. Keyed by the handle object itself,
    // so registering the same handle twice is idempotent (a single entry)
    // and a single unregister fully removes it. Map is purpose-built for
    // this add/remove-over-time pattern; iteration via `.keys()` is
    // clean and never deoptimises.
    const handles = new Map();

    // ========================================================================
    // REGISTER: Add a flow handle to the shutdown roster
    // ========================================================================
    /**
     * Register a flow `handle` so this manager calls `handle.shutdown()`
     * on signal. `flow().run()` auto-registers its returned handle so
     * the caller experience is unchanged from earlier versions.
     *
     * Idempotent: registering the same handle twice is a single entry,
     * and a single unregister fully removes it. The Map is keyed by
     * the handle object itself — no synthetic IDs needed.
     *
     * Returns an unregister function so a flow that has already shut
     * down (via direct `handle.shutdown()` invocation by the caller)
     * can detach itself, preventing this manager from re-invoking
     * `handle.shutdown()` on a torn-down flow.
     *
     * @param {{shutdown: function}} handle - flow handle exposing shutdown
     * @returns {function} unregister
     */
    const register = function ( handle ) {
        handles.set( handle, true );
        return function () {
            handles.delete( handle );
        };
    };

    // ========================================================================
    // DRAIN HANDLES: Race per-flow shutdown against the forced timeout
    // ========================================================================
    /**
     * Iterate every registered flow handle, calling `handle.shutdown()`
     * on each in parallel via `Promise.allSettled`. Race the whole drain
     * against `timeoutMs`.
     *
     * A drain that REJECTS means that flow lost data at shutdown — the
     * adapter said so with a classified error (`DELIVERY_FAILED` or
     * `SHUTDOWN_TIMEOUT`, per ADR-018 a shutdown never resolves cleanly
     * over a loss). Each rejection prints one classified console line
     * and counts in `failedDrains`, so the caller can refuse the clean
     * exit code (the 2026-08-29 exit-1 ruling).
     *
     * @param {number} timeoutMs - Ceiling for the whole drain
     * @returns {Promise<{timedOut: boolean, failedDrains: number}>}
     *   `timedOut` — the race hit the ceiling; the drains are still in
     *   flight, so their outcomes are unknown and `failedDrains` stays 0.
     *   `failedDrains` — how many drains rejected (0 with no handles).
     */
    const drainHandles = async function ( timeoutMs ) {
        if ( handles.size === 0 ) {
            return { timedOut: false, failedDrains: 0 };
        }

        const drainAll = Promise.allSettled(
            Array.from( handles.keys() ).map(
                ( handle ) => Promise.resolve().then( () => handle.shutdown() )
            )
        );

        // Distinct sentinel string so we can tell race winner apart from
        // a Promise.allSettled result array.
        const TIMED_OUT = '__SHUTDOWN_FORCE_TIMEOUT__';
        let timerHandle;
        const timeout = new Promise( ( resolve ) => {
            timerHandle = setTimeout( () => resolve( TIMED_OUT ), timeoutMs );
        } );

        const winner = await Promise.race( [ drainAll, timeout ] );
        // Cancel the loser. Without this, when drainAll wins the
        // race, the unfired setTimeout still keeps the event loop
        // alive until it fires (up to `timeoutMs` later) — a real
        // tail-latency at end of test suites and in any process
        // that runs the manager and then expects to exit cleanly.
        // Same canonical pattern used by every source `stopFn`.
        clearTimeout( timerHandle );
        if ( winner === TIMED_OUT ) {
            return { timedOut: true, failedDrains: 0 };
        }

        // The drain settled in time: read every outcome. The reads are
        // null-safe because a rejection reason can be anything.
        let failedDrains = 0;
        for ( let i = 0; i < winner.length; i += 1 ) {
            if ( winner[ i ].status === 'rejected' ) {
                failedDrains += 1;
                const reason = winner[ i ].reason;
                const code = ( reason && reason.code ) || 'UNKNOWN';
                const detail = ( reason && reason.message ) || String( reason );
                const count = reason && reason.dropped && reason.dropped.count;
                const droppedNote = ( typeof count === 'number' ) ? ` — ${count} message(s) dropped` : '';
                logger.error( `winkComposer/shutdownManager: Flow drain failed [${code}]: ${detail}${droppedNote}` );
            }
        }
        return { timedOut: false, failedDrains };
    };

    // ========================================================================
    // SHUTDOWN: Orchestrate the layered teardown
    // ========================================================================
    /**
     * Run the full process-layer shutdown sequence. Re-entry is guarded
     * via `isShuttingDown` (a second call returns immediately).
     *
     * Order:
     * 1. Drain registered flow handles (modern path).
     * 2. Run the legacy path block (clustered for retirement; warns once
     *    when actually doing work).
     * 3. Return graceful (true) / not-graceful (false) — the caller
     *    decides the exit code.
     *
     * Graceful means BOTH: the drain finished inside the timeout, AND
     * every drain resolved clean. A drain that rejected lost data, so
     * it must not read as a clean stop (the 2026-08-29 exit-1 ruling;
     * ADR-018's delivery invariant, extended to the process boundary).
     *
     * @returns {Promise<boolean>} true on graceful completion; false on
     *   forced timeout or on any rejected drain
     */
    const shutdown = async function () {
        if ( isShuttingDown ) {
            return true;
        }
        isShuttingDown = true;

        const timestamp = new Date().toISOString();
        logger.info( `\nwinkComposer/shutdownManager: [${timestamp}] Shutdown initiated` );

        // Phase 1 (modern path): drain registered flow handles, racing
        // against the forced-shutdown timeout.
        const drain = await drainHandles( ENV_VARS.shutdownForceTimeoutMs );
        if ( drain.timedOut ) {
            logger.warn(
                `winkComposer/shutdownManager: Forced shutdown — flow drain exceeded ${ENV_VARS.shutdownForceTimeoutMs}ms; ` +
                'some adapters may not have completed cleanly'
            );
        }
        if ( drain.failedDrains > 0 ) {
            logger.warn(
                `winkComposer/shutdownManager: ${drain.failedDrains} flow drain(s) lost data (lines above) — shutdown is not clean`
            );
        }
        const graceful = !drain.timedOut && ( drain.failedDrains === 0 );

        try {
            // ================================================================
            // LEGACY PATH — scheduled for retirement
            // ================================================================
            //
            // The emitters.shutdown() call below serves the pre-DSL
            // example flows (cpd-run.js, rwm-csv-run.js via their flow
            // files) that wire emitters manually via emitters.wire()
            // instead of using the modern flow().run() API.
            //
            // Modern flow().run() pipelines drain everything via
            // handle.shutdown() (called from the registered-handle
            // iteration above); by the time control reaches this block,
            // the wire-emitters / wire-storages registries are already
            // empty for those flows — the call finds nothing to do
            // (benign no-op).
            //
            // The sources half of this path (wire-sources.js and the
            // OPC-UA example runners) was removed 2026-07-07 (ADR-019).
            // This remainder retires when the legacy examples migrate
            // to the modern flow API.
            // ================================================================

            const emitterResults = await emitters.shutdown();
            const failedEmitters = emitterResults.filter( ( r ) => r.status === 'rejected' );
            if ( emitterResults.length > 0 ) {
                if ( failedEmitters.length > 0 ) {
                    logger.warn( `winkComposer/shutdownManager: ${failedEmitters.length} legacy emitter(s) failed to shutdown cleanly` );
                } else {
                    logger.info( 'winkComposer/shutdownManager: Legacy message queues flushed' );
                }
            }

            // ================================================================
            // END LEGACY PATH
            // ================================================================

            logger.info( `winkComposer/shutdownManager: [${new Date().toISOString()}] Shutdown complete\n` );

            return graceful;

        } catch ( error ) {
            logger.error( 'winkComposer/shutdownManager: Shutdown error: ' + ( ( error && error.stack ) || String( error ) ) );
            process.exitCode = 1;
            return false;
        }
    }; // shutdown()

    // ========================================================================
    // ATTACH HANDLERS: Wire up SIGINT/SIGTERM (idempotent)
    // ========================================================================
    /**
     * Register process-level SIGINT and SIGTERM handlers. Idempotent —
     * subsequent calls are no-ops via the internal `attached` flag.
     * Both `flow().run()` (auto-attach) and legacy examples' explicit
     * calls converge here, so handlers are registered exactly once per
     * process regardless of caller.
     *
     * On signal: runs `shutdown()`, then `process.exit(0)` on graceful
     * completion. Exit is 1 on a forced timeout or when any flow's
     * drain rejected — a rejected drain lost data, and the exit code
     * must say so (the 2026-08-29 exit-1 ruling).
     */
    const attachHandlers = function () {
        if ( attached ) {
            return;
        }
        attached = true;

        const signalHandler = async function ( signalName ) {
            logger.info( `\nwinkComposer/shutdownManager: Received ${signalName}` );
            const graceful = await shutdown();

            /* c8 ignore next 2 -- fundamentally untestable: invoking the signal handler from a test would call process.exit and kill the test runner. The graceful/forced exit-code mapping is verified by the shutdown() return-value tests above. */
            // eslint-disable-next-line no-process-exit
            process.exit( graceful ? 0 : 1 );
        };

        process.on( 'SIGINT', () => signalHandler( 'SIGINT (Ctrl-C)' ) );
        process.on( 'SIGTERM', () => signalHandler( 'SIGTERM' ) );
    }; // attachHandlers()

    // ========================================================================
    // PUBLIC API
    // ========================================================================
    return {
        shutdown,
        attachHandlers,
        register
    };
}; // createShutdownManager()

// Production singleton — one instance per process, exported as default.
const shutdownManager = createShutdownManager();

export default shutdownManager;
export { createShutdownManager };

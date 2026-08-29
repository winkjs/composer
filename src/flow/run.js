// flow/run.js

/**
 * @fileoverview Runtime bootstrap for direct pipeline execution.
 *
 * Orchestrates: module loading, emitter wiring, partition manager setup,
 * source initialization, and graceful shutdown coordination.
 *
 * Supports two modes:
 * - Single-pipeline: Traditional flow with specs array (backward compatible)
 * - Multi-specialization: Switch/case flow with specsByCase object
 */

import { loadNodeModules } from './load-node-module.js';
import { validateFlowOrThrow } from './validate.js';
import * as partitionManager from '../core/partition-manager/index.js';
import { wireLinearGraph, emitters, storages, assertModuleDurability } from '../core/wiring/index.js';
import shutdownManager from '../core/shutdown-manager/index.js';
import { ENV_VARS } from '../core/env-vars.js';
import { wrapCallback } from '../core/utils/callback-guard/index.js';

/**
 * Wires and starts the pipeline for direct execution.
 * Handles both single-pipeline and multi-specialization modes.
 *
 * @param {string} flowName - Name of the flow
 * @param {Array|Object} specsOrSpecsByCase - Node specs array OR specsByCase object
 * @param {Set} importSet - Set of node names used
 * @param {Object} runtime - Runtime configuration
 * @param {Array} [caseOrder] - Order of case keys (only for multi-specialization)
 * @returns {Promise<Object>} Pipeline handle with shutdown method
 */
export const runFlow = async function ( flowName, specsOrSpecsByCase, importSet, runtime, caseOrder ) {
    // Determine if this is multi-specialization mode
    const isMultiSpec = caseOrder !== undefined && !Array.isArray( specsOrSpecsByCase );

    // 1. Load node modules dynamically
    const nodeNames = Array.from( importSet );
    const nodeModules = await loadNodeModules( nodeNames );

    // Convert Map to plain object for compatibility
    const nodeModulesObj = Object.create( null );
    for ( const [ name, mod ] of nodeModules ) {
        nodeModulesObj[ name ] = mod;
    }

    // 2. Build emitter configs and modules for wiring
    const emitterConfigs = Object.create( null );
    const emitterModules = Object.create( null );
    for ( const [ id, { adapter, config } ] of Object.entries( runtime.emitters ) ) {
        emitterConfigs[ id ] = config;
        emitterModules[ id ] = adapter;
    }

    // 3. Build storage configs and modules for wiring (optional)
    const storageConfigs = Object.create( null );
    const storageModules = Object.create( null );
    const runtimeStorages = runtime.storages || Object.create( null );
    for ( const [ id, { adapter, config } ] of Object.entries( runtimeStorages ) ) {
        storageConfigs[ id ] = config;
        storageModules[ id ] = adapter;
    }

    let specsBySpecialization;
    let graphs;

    // emitterModules / storageModules are already `{ id: adapterModule }`
    // maps (built above from runtime.emitters / runtime.storages). They
    // serve double duty: cross-flow target validation (existence check
    // via `id in modules`) and capability-driven semanticsRequirement
    // checks (read `module.semanticsRequirement`).
    // validateFlowOrThrow takes these maps directly.

    if ( isMultiSpec ) {
        // Multi-specialization mode
        specsBySpecialization = specsOrSpecsByCase;

        // Validate all specializations
        for ( let i = 0; i < caseOrder.length; i += 1 ) {
            const key = caseOrder[ i ];
            validateFlowOrThrow( `${flowName}:${key}`, specsBySpecialization[ key ], nodeModulesObj, emitterModules, storageModules, runtime.assetClass );
        }

        // Wire emitters and storages across all specializations
        for ( let i = 0; i < caseOrder.length; i += 1 ) {
            const key = caseOrder[ i ];
            await emitters.wire( specsBySpecialization[ key ], emitterConfigs, emitterModules, runtime.assetClass ); // eslint-disable-line no-await-in-loop
            await storages.wire( specsBySpecialization[ key ], storageConfigs, storageModules, runtime.assetClass ); // eslint-disable-line no-await-in-loop
        }

        // Wire graphs for each specialization
        graphs = Object.create( null );
        for ( let i = 0; i < caseOrder.length; i += 1 ) {
            const key = caseOrder[ i ];
            graphs[ key ] = wireLinearGraph( specsBySpecialization[ key ], nodeModulesObj );
        }
    } else {
        // Single-pipeline mode (backward compatible)
        const specs = specsOrSpecsByCase;

        // Validate flow
        validateFlowOrThrow( flowName, specs, nodeModulesObj, emitterModules, storageModules, runtime.assetClass );

        // Wire emitters and storages
        await emitters.wire( specs, emitterConfigs, emitterModules, runtime.assetClass );
        await storages.wire( specs, storageConfigs, storageModules, runtime.assetClass );

        // Build specsBySpecialization with single entry at key 0
        specsBySpecialization = { 0: specs };

        // Wire single graph
        graphs = { 0: wireLinearGraph( specs, nodeModulesObj ) };
    }

    // 3. Build flow config for partition manager
    const flow = {
        specsBySpecialization,
        nodeModules: nodeModulesObj,
        partitionField: runtime.partitionField || null,
        specializationField: runtime.specializationField || null,
        // Default comes from YIELD_TIME_THRESHOLD_MS (500 ms, ADR-024);
        // `.yield( { threshold } )` overrides it per flow.
        yieldThreshold: runtime.yieldThreshold ?? ENV_VARS.yieldTimeThresholdMs
    };

    // 4. Initialize partition manager
    const composerState = partitionManager.init( flow );

    // 4a. Populate the backpressure-aware sinks registry. Wire-emitters
    // and wire-storages each return the subset of their singletons that
    // expose `getPressure()`, keyed 'emitter:<target>' /
    // 'storage:<storageName>'. Nothing reads the registry yet — the
    // pressure-aware yield decision (ADR-020, Draft) will iterate it
    // when it lands; the assembly here keeps the partition manager's
    // view ready for that.
    Object.assign(
        composerState.partitionState.backpressureAwareSinks,
        emitters.getBackpressureAwareSinks(),
        storages.getBackpressureAwareSinks()
    );

    // ========================================================================
    // 5. MESSAGE DISPATCH — SYNC-FIRST HOT PATH (ADR-013, ADR-024)
    // ========================================================================
    //
    // processMessage is deliberately NOT an `async function`. Wrapping it in
    // `async/await` would allocate a Promise and schedule two microtask hops
    // on EVERY message (~155 ns/msg measured overhead — ADR-013).
    //
    // Every message is processed synchronously, in arrival order. When the
    // yield threshold fires, pmUpdate sets `partitionState.yieldPending`
    // after handing back the graph — the message is processed first, the
    // breath comes after (ADR-024). processMessage then returns a Promise
    // that resolves on the next setImmediate turn, so an awaiting caller
    // gives the event loop a chance to run background I/O (MQTT drain,
    // QuestDB flush timers, stdout). Processing before breathing means a
    // caller that ignores the Promise (a push source such as the MQTT
    // subscriber) can never see messages update a partition out of order.
    //
    // The caller contract (ADR-013) is unchanged in shape: `undefined` on
    // the hot path, a Promise on the yield tick; `await` works with both,
    // and the Promise never rejects. Fault delivery depends on the flow
    // kind (ADR-018 — the runtime owns per-message dispatch failure). With
    // a source present, a pipeline fault is contained here: the message is
    // skipped, one red MESSAGE_HANDLER_FAILED travels the status channel,
    // and a run of consecutive failures stops the flow in the terminal
    // 'errored' phase. A headless flow (no source) has no status channel,
    // so the fault throws synchronously to the caller — the headless
    // driver's catch and `failed` counter are that path's containment.
    //
    // The default threshold comes from YIELD_TIME_THRESHOLD_MS (500 ms);
    // `.yield( { threshold } )` overrides it per flow, and Infinity turns
    // yielding off. The yield only matters to callers that wait on this
    // function — a push source breathes with the event loop on its own.
    //
    // This extends ADR-004's zero-allocation hot-path principle to the flow
    // wrapper layer: one boolean read per message; the Promise is allocated
    // only on the yield tick.
    // ========================================================================

    // Graph selection uses same field as partition manager for consistency.
    const getSpecializationType = runtime.specializationField ?
        ( msg ) => msg[ runtime.specializationField ] :
        () => 0;

    // Pipeline dispatch. Defined once at wire time, reused every message.
    const runPipeline = function ( graph, msg ) {
        const type = getSpecializationType( msg );
        const pipeline = graphs[ type ];
        if ( pipeline ) {
            pipeline( graph, msg );
        }
    };

    const partitionState = composerState.partitionState;

    // The dispatch function itself is defined AFTER the shutdown
    // closure below — its escalation path drains the flow, so it
    // needs `shutdown` in scope. No message can arrive before then:
    // the source only receives processMessage at start, further down.

    // 6. Setup the flow's shutdown closure.
    //
    // Per ADR-018, the flow layer owns the orchestrated drain
    // (source → emitters → storages).
    // OS signals (SIGINT/SIGTERM) and the top-level forced-shutdown
    // timeout live in the process layer (`shutdown-manager`); we
    // auto-register this handle there a few lines down so signal
    // routing works without the caller wiring anything up.
    //
    // Concurrent-safe: a second `shutdown()` call while the first is
    // still draining returns the same in-flight Promise. Callers that
    // `await handle.shutdown()` after a concurrent caller has already
    // started see the actual drain finish, not a premature resolve.
    // The `unregister()` call also detaches this handle from
    // shutdown-manager so a SIGINT after a direct `handle.shutdown()`
    // doesn't re-invoke a torn-down flow.
    //
    // Natural-completion signal: `handle.whenComplete()` returns a
    // Promise that resolves when either:
    //   - the source emits a `phase: 'complete'` status (finite
    //     sources reach their natural end), or
    //   - shutdown is called (forced exit).
    // For infinite sources (the MQTT subscriber), only the second
    // path resolves it. Test pattern:
    //
    //   const handle = await flow(...).source(...).run();
    //   await handle.whenComplete();   // wait for the source to finish
    //   await handle.shutdown();        // drain the sinks
    //
    // Auto-shutdown on natural completion is owned by the runtime, not
    // the source. When the source emits `phase: 'complete'` we trigger
    // `shutdown()` here — fire-and-forget, since shutdown is
    // concurrent-safe. The source's own `shutdownOnComplete` config is
    // overridden to `false` for in-flow use so the source never invokes
    // `onShutdown` itself; that prevents the recursion where the
    // source's run() awaits onShutdown which awaits stopSource which
    // awaits the source's run(). Source-level `shutdownOnComplete`
    // remains a feature for direct (non-flow) callers.
    let stopSource = null;
    let unregister = null;
    let shutdownPromise = null;
    // Time budget for each shutdown stage (source, then emitters, then
    // storages). The shutdown-manager wraps the whole flow shutdown in
    // its own outer timeout; this per-stage value keeps any single
    // stuck stage from using up that whole budget. Each stage uses
    // `{ timeout }` per ADR-018 — this is the middle of its three
    // nested shutdown timeouts.
    const STAGE_TIMEOUT_MS = 5000;

    let resolveWhenComplete;
    const whenCompletePromise = new Promise( function ( resolve ) {
        resolveWhenComplete = resolve;
    } );

    // Runs one drain stage and absorbs its failure into `stageErrors`,
    // so a failing stage cannot skip the stages after it — a source
    // that will not stop must not strand buffered emitter and
    // storage data. The failure is logged here, naming the stage, and
    // the first one is rethrown by drainAll below.
    const runDrainStage = async function ( label, stageErrors, stage ) {
        try {
            await stage();
        } catch ( err ) {
            stageErrors.push( err );
            console.error(
                `WinkComposer/flow: ${label} drain stage failed [${( err && err.code ) || 'UNKNOWN'}]: ` +
                `${( err && err.message ) || String( err )} — later drain stages still ran`
            );
        }
    }; // runDrainStage()

    const drainAll = async function () {
        const stageErrors = [];
        try {
            if ( unregister ) unregister();
            if ( stopSource ) {
                await runDrainStage( 'source-stop', stageErrors,
                    () => stopSource( { timeout: STAGE_TIMEOUT_MS } ) );
            }
            await runDrainStage( 'emitter', stageErrors,
                () => emitters.shutdown( { timeout: STAGE_TIMEOUT_MS } ) );
            await runDrainStage( 'storage', stageErrors,
                () => storages.shutdown( { timeout: STAGE_TIMEOUT_MS } ) );
        } finally {
            // Whatever the path here — clean drain or a stage that threw —
            // the source has stopped producing, so unblock any
            // whenComplete() waiter. The error itself still propagates to
            // shutdown()'s caller; it must not also hang bystanders.
            resolveWhenComplete();
        }
        // Every stage ran; the caller is still owed a rejection when any
        // failed. First error wins — it is the earliest loss.
        if ( stageErrors.length > 0 ) {
            throw stageErrors[ 0 ];
        }
    };
    const shutdown = function () {
        if ( !shutdownPromise ) {
            shutdownPromise = drainAll();
        }
        return shutdownPromise;
    };

    // Run the drain with its rejection observed. Both fire-and-forget
    // call sites use this: the natural-completion trigger and the
    // consecutive-failure escalation. drainAll rethrows the first
    // stage error; with no awaiting caller that rejection would end
    // the process as unhandled. The classified log keeps the loss
    // loud without the crash, and a caller that later awaits
    // `handle.shutdown()` still receives the memoized rejection.
    const observedShutdown = function () {
        shutdown().catch( function ( err ) {
            console.error(
                `WinkComposer/flow '${flowName}': shutdown failed ` +
                `[${( err && err.code ) || 'UNKNOWN'}]: ${( err && err.message ) || String( err )}`
            );
        } );
    };

    // ── Message dispatch with fault containment (ADR-018: the flow
    // runtime owns per-message dispatch failure at this chokepoint) ──
    // All containment state is flow-scoped policy, kept in this
    // closure beside the shutdown state — never on the handle-exposed
    // composerState. `reportDispatchFailure` stays null for a headless
    // flow (no source); the source block below assigns it before the
    // source ever receives processMessage.
    let consecutiveFailures = 0;
    let errored = false;
    let erroredDropReported = false;
    let reportDispatchFailure = null;

    const processMessage = function ( msg ) {
        // Terminal 'errored': drop everything. The first drop is
        // reported once, classified; a flood of per-drop reports
        // would bury the one terminal red that matters.
        if ( errored ) {
            if ( !erroredDropReported ) {
                erroredDropReported = true;
                console.error(
                    `WinkComposer/flow '${flowName}': flow is in the terminal 'errored' ` +
                    'phase [MESSAGE_HANDLER_FAILED] — dropping this and all further messages'
                );
            }
            return undefined;
        }

        // Process first — pmUpdate always returns the graph synchronously
        // (or null for a dropped message, which never sets the flag).
        // The guard covers pmUpdate too: a first message for a new asset
        // runs every node's init lazily, so an init throw surfaces here.
        try {
            const graph = partitionManager.update( composerState, msg );
            if ( graph ) {
                runPipeline( graph, msg );
                // Reset on success only — a dropped message is neither
                // a success nor a failure. Branch-guarded so the
                // healthy steady state never writes.
                if ( consecutiveFailures !== 0 ) {
                    consecutiveFailures = 0;
                }
            }
        } catch ( err ) {
            if ( reportDispatchFailure === null ) {
                // Headless: the caller is the reporting channel — the
                // driver's catch and `failed` counter own the fault.
                throw err;
            }
            consecutiveFailures += 1;
            const isTerminal = consecutiveFailures >= ENV_VARS.messageFailureThreshold;
            reportDispatchFailure( err, isTerminal );
            if ( isTerminal ) {
                errored = true;
                observedShutdown();
            }
        }

        // Breathe after (yield tick, rare): hand the awaiting caller a
        // Promise that resolves once the event loop has had a full turn.
        // Runs on the catch path too — pmUpdate may have set the flag
        // before the pipeline threw, and the breath must not be lost.
        if ( partitionState.yieldPending ) {
            partitionState.yieldPending = false;
            return new Promise( ( resolve ) => {
                setImmediate( resolve );
            } );
        }

        return undefined;
    };

    // 7. Start source (singleton).
    if ( runtime.source ) {
        const { adapter, config } = runtime.source;

        // ADR-018 module-surface check: the source module must say what
        // a crash costs — before start() runs. Placed here
        // rather than in flow.js so direct runFlow() callers are covered
        // too (they bypass the DSL entirely).
        assertModuleDurability( adapter.id || 'source', adapter );

        // The callback guard below turns a non-function into null
        // (absent). Validate raw first, so a misconfigured handler
        // fails loudly at setup instead of silently vanishing. Placed
        // here for the same reason as the durability check above:
        // direct runFlow() callers bypass the DSL schema.
        if ( config.onStatus !== undefined && config.onStatus !== null && typeof config.onStatus !== 'function' ) {
            const err = new Error( `WinkComposer/flow '${flowName}': onStatus must be a function` );
            err.code = 'INVALID_CONFIG';
            throw err;
        }

        // Wrap user's onStatus so the runtime can spot the natural-
        // completion signal without taking it away from the user.
        // When the source signals `phase: 'complete'`:
        //   1. Resolve the whenComplete Promise so callers can stop
        //      waiting for natural completion.
        //   2. Trigger the drain via observedShutdown — fire-and-forget
        //      with its rejection logged; shutdown is concurrent-safe
        //      and stages have their own timeouts.
        // The user's handler is armed by the shared callback guard
        // (ADR-018: a misbehaving user callback never interrupts the
        // runtime that called it). Null when the flow has no handler,
        // so the classified fallback branch below keeps red statuses
        // loud.
        const safeUserOnStatus = wrapCallback( config.onStatus, {
            name: 'onStatus',
            severity: 'red',
            report: function ( severity, name, detail ) {
                console.error(
                    `WinkComposer/flow '${flowName}': user callback ${name} failed [CALLBACK_FAILED]: ${detail}`
                );
            }
        } );
        const wrappedOnStatus = function ( s ) {
            if ( safeUserOnStatus ) {
                safeUserOnStatus( s );
            } else if ( s && s.status === 'red' ) {
                // No user handler: log the failure here, classified. The
                // source's own console fallback fires only when NO handler
                // exists — and this wrapper IS a handler, so the source
                // stays quiet. Without this branch a red status inside
                // a flow would vanish unreported.
                const code = ( s.error && s.error.code ) || 'UNKNOWN';
                const message = ( s.error && s.error.message ) ||
                    'source reported status red with no error detail';
                console.error( `WinkComposer/flow '${flowName}': source error [${code}]: ${message}` );
            }
            // Completion bookkeeping runs after — and independently of —
            // the user's reporter. A throwing onStatus must never swallow
            // the flow's own completion: whenComplete waiters would hang
            // and the source would never stop.
            if ( s && s.phase === 'complete' ) {
                resolveWhenComplete();
                observedShutdown();
            }
        };

        // The dispatch guard's reporting channel. Routing through
        // wrappedOnStatus keeps the two-party rule: a flow without a
        // user handler still gets the classified console fallback for
        // red statuses. No local guard is needed here: the callback
        // guard above contains a throwing user handler, and every other
        // branch of wrappedOnStatus is throw-free.
        reportDispatchFailure = function ( err, isTerminal ) {
            const payload = {
                status: 'red',
                connected: true,
                phase: isTerminal ? 'errored' : 'running',
                error: {
                    code: 'MESSAGE_HANDLER_FAILED',
                    message: isTerminal ?
                        `${ENV_VARS.messageFailureThreshold} consecutive message failures — ` +
                        `flow stopped. Last: ${err.message}` :
                        `${err.message} — message skipped`
                }
            };
            wrappedOnStatus( payload );
        };
        stopSource = adapter.start( {
            ...config,
            // Override any source-level auto-shutdown setting. The
            // runtime owns the trigger when the source runs inside a
            // flow; sources that auto-shutdown themselves would call
            // back into our `shutdown()` while their run loop awaited
            // it — a circular wait that takes the source-level force
            // timer to break.
            shutdownOnComplete: false,
            onStatus: wrappedOnStatus,
            onMessage: processMessage,
            onShutdown: shutdown
        } );
    } else {
        // The headless branch: a flow with no source is a documented
        // DSL path (the headless driver feeds it). No source means
        // "nothing to wait for" — resolve immediately so any
        // `await handle.whenComplete()` is a no-op. And with no
        // status channel, `reportDispatchFailure` stays null, so the
        // dispatch guard rethrows pipeline faults to the caller.
        resolveWhenComplete();
    }

    // 8. Auto-register with shutdown-manager so OS signals are routed
    // here. The flow layer no longer attaches its own SIGINT/SIGTERM
    // handlers — that's the process layer's exclusive
    // responsibility. Caller experience is unchanged: Ctrl-C still
    // shuts the flow down gracefully, and `handle.shutdown()` still
    // works directly for callers that want explicit control.
    unregister = shutdownManager.register( { shutdown } );
    shutdownManager.attachHandlers();

    // Return pipeline handle.
    return {
        flowName,
        composerState,
        shutdown,
        processMessage,
        whenComplete: function () {
            return whenCompletePromise;
        }
    };
};


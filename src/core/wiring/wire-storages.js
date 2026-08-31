// core/wiring/wire-storages.js

/**
 * @fileoverview Holds the running storage instances for a flow and creates
 * them on demand from the spec.
 *
 * A "storage" is the thing that persists messages to a time-series database
 * (QuestDB today; potentially others later). One storage per name is enough
 * — many partitions and many persist-if nodes can share it — so we keep
 * them in a small registry keyed by storage name and only build a new one
 * if we haven't seen that name before.
 *
 * This file is responsible for four things:
 * - Building each storage at flow startup, by calling its module's
 *   `createStorage(config)` factory and storing the returned handle.
 *   The factory may be async (QuestDB needs to negotiate tables via
 *   PostgreSQL before the ILP sender is ready); both async and sync
 *   factories are supported.
 * - Calling `applySemanticsRequirement` (from `wire-semantics.js`) on each
 *   storage so adapters that declare `semanticsRequirement` get the
 *   requested slice of `assetClass` injected before their factory is
 *   called (capability-indexed injection per ADR-018).
 *   The earlier hardcoded "every storage gets the full assetClass
 *   plus a tablePrefix default" pattern was removed; adapters that need
 *   defaulting (e.g., QuestDB's `tablePrefix ?? assetClass.name`) own
 *   that logic themselves.
 * - Checking, the moment we get the handle back, that it has the methods
 *   the rest of the framework will call later (fail loudly at startup
 *   rather than crash deep in the per-message hot path). See
 *   `assert-handle.js` for the check helper and the error format.
 * - Telling the partition manager which storages expose `getPressure()` so
 *   the pressure-aware yield decision (ADR-020, Draft) can poll them. The
 *   list is exposed via `getBackpressureAwareSinks()` and assembled by
 *   `flow/run.js` after the flow's partition state is set up.
 *
 * Restart safety: `shutdown()` clears the registry after stopping every
 * storage, so a follow-up `wire()` call on the same process gets a fresh
 * set of handles. (See the longer comment on shutdown for the production
 * and testing rationale.)
 *
 * The IIFE around the registry hides it from outside callers; only the
 * exported methods can read or change it.
 *
 * @see ADR-018 (sink method surface)
 * @see ADR-020 (backpressure-aware-sinks collection; Draft)
 */

import { assertHandle } from './assert-handle.js';
import { assertModuleDurability } from './assert-module.js';
import { applySemanticsRequirement } from './wire-semantics.js';
import { logger } from '../logger/index.js';

/**
 * Methods the framework calls on a storage handle later, so they have to
 * be present at wire time per ADR-018.
 * `getStats` was previously here and was later removed from the
 * contract's method surface.
 * `getPressure` is optional — its presence decides whether the handle is
 * collected into `backpressureAwareSinks`, not whether the wire succeeds.
 */
const REQUIRED_STORAGE_METHODS = [ 'write', 'flush', 'shutdown', 'getHealth' ];

/**
 * Serializes a rejection's `dropped` payload for the shutdown log. A
 * third-party adapter can reject with anything — including structures
 * JSON.stringify throws on (circular references). The log line must never
 * throw: a throw here used to skip the registry clear that followed it.
 * Mirrors `wire-emitters.js`.
 *
 * @param {*} dropped - the rejection's dropped payload
 * @returns {string} JSON, or a fallback marker when unserializable
 */
const describeDropped = function ( dropped ) {
    try {
        return JSON.stringify( dropped );
    } catch {
        return '[unserializable]';
    }
}; // describeDropped()

/**
 * Stamps the annotate key-sweep support object onto a persistIf spec.
 *
 * The persistIf node warns, once per gate, when a function-form annotate
 * returns a record with invented keys — keys that are neither declared
 * columns nor message fields. Such a key is almost always a typo, and it
 * fails silently: the persist plan writes only declared columns, so the
 * value never reaches storage. The node needs two things for that check,
 * both known only here at wire time: the declared-column set for the
 * spec's insightType, and a once-flag every partition shares. Both ride
 * the spec, exactly like `spec.storage` — `init` copies the reference into
 * each partition's state, so one flag covers all partitions of the gate.
 *
 * No stamp when there is nothing to check: no function-form annotate, no
 * asset class, or an insightType the asset class does not declare (flow
 * validation rejects that last case already; this guard stays defensive).
 *
 * @param {Object} spec - persistIf node spec (mutated: gains annotateSweep)
 * @param {Object|null} assetClass - The flow's asset class, when provided
 */
const stampAnnotateSweep = function ( spec, assetClass ) {
    if ( typeof spec.annotate !== 'function' ) {
        return;
    }
    const insightTypeSpec = assetClass && assetClass.insightTypes && assetClass.insightTypes[ spec.insightType ];
    if ( !insightTypeSpec ) {
        return;
    }
    spec.annotateSweep = {
        declaredColumns: new Set( insightTypeSpec.columns ),
        checked: false
    };
}; // stampAnnotateSweep()

const storages = ( function () {
    // ========================================================================
    // PRIVATE STATE: Singleton Registry
    // ========================================================================
    // The registry holds all storage singletons keyed by their storage name.
    // This ensures exactly one instance per storage across the entire system,
    // preventing resource waste from duplicate connections/handles.
    const singletons = Object.create( null );

    // ========================================================================
    // WIRE: Discover and Create Storage Singletons
    // ========================================================================
    // Scans node specifications to find Persist If nodes and creates singleton
    // storages for their targets. This is called during flow initialization
    // for each specialization, but the singleton check ensures each storage
    // is created and initialized exactly once.
    //
    // Storage Lifecycle:
    // 1. createStorage(config) - Creates and initializes storage (may be async)
    // 2. write() - Called during message processing
    // 3. shutdown() - Graceful termination
    //
    // The createStorage() call may be async (e.g., QuestDB needs to create tables
    // via PostgreSQL before the storage is ready). For backwards compatibility,
    // sync createStorage functions are also supported.
    //
    // Legacy init() support: If storage.init() exists, it's called after creation
    // for backwards compatibility with older storage adapters.
    //
    // assetClass: Optional asset class object from flow's .assetClass() method.
    // When provided, it is injected into storage config and tablePrefix defaults
    // to assetClass.name if not explicitly specified.
    const wire = async function ( specs, storageConfigs, storageModules, assetClass = null ) {
        const pendingStorages = [];

        for ( const spec of specs ) {
            // Skip non-persistIf nodes
            if ( spec.nodeType !== 'Persist If' || !spec.storageName ) {
                continue; // eslint-disable-line no-continue
            }

            const storageName = spec.storageName;

            // Skip if already in singleton registry
            if ( singletons[ storageName ] ) {
                continue; // eslint-disable-line no-continue
            }

            const module = storageModules[ storageName ];
            if ( !module?.createStorage ) {
                throw new Error( `winkComposer/wiring: Invalid storage module: ${storageName}` );
            }

            // ADR-018 module-surface check: the module must say what a
            // crash costs — before the factory runs.
            assertModuleDurability( storageName, module );

            // Build effective config starting from user config; we layer
            // adapter-driven injection on top.
            const userConfig = storageConfigs[ storageName ] || {};
            const effectiveConfig = { ...userConfig };

            // Capability-indexed injection per ADR-018. The helper
            // reads `module.semanticsRequirement` and injects the declared
            // slice of assetClass when one is present. Adapters that don't
            // need semantics declare nothing and the helper is a no-op for
            // them. Adapters that do (e.g., QuestDB) declare what they
            // need and only that slice is injected.
            //
            // The earlier hardcoded "every storage gets the full
            // assetClass plus a tablePrefix default" path was removed.
            // Adapters that need a
            // tablePrefix default now own that logic themselves (e.g.,
            // QuestDB's createStorage defaults `tablePrefix` from
            // `assetClass.name` when not supplied).
            applySemanticsRequirement(
                storageName,
                module,
                assetClass,
                effectiveConfig
            );

            // createStorage may return Promise (async) or storage directly (sync)
            const storageOrPromise = module.createStorage( effectiveConfig );
            pendingStorages.push( { storageName, storageOrPromise } );
        }

        // Await all pending storage creations (handles both async and sync)
        // Sequential to ensure proper resource ordering (file locks, ports)
        for ( const { storageName, storageOrPromise } of pendingStorages ) {
            const storage = await storageOrPromise; // eslint-disable-line no-await-in-loop

            // Wire-time shape check (ADR-018). Fails fast with a
            // descriptive error instead of letting a missing method crash
            // the per-message hot path later.
            assertHandle( storageName, storage, REQUIRED_STORAGE_METHODS );

            singletons[ storageName ] = storage;

            // Legacy init() support for backwards compatibility
            if ( storage.init ) {
                await storage.init(); // eslint-disable-line no-await-in-loop
            }
        }

        // Assign storage references to specs, plus the annotate key-sweep
        // support the node reads at init (see stampAnnotateSweep above).
        for ( const spec of specs ) {
            if ( spec.nodeType === 'Persist If' && spec.storageName ) {
                spec.storage = singletons[ spec.storageName ];
                stampAnnotateSweep( spec, assetClass );
            }
        }
    }; // wire()

    // ========================================================================
    // GET BACKPRESSURE-AWARE SINKS
    // ========================================================================
    /**
     * Returns the subset of wired storages that expose `getPressure()`.
     * Keys are namespaced as `storage:<storageName>` so a debug log at
     * the call site (the pressure-aware yield decision, ADR-020)
     * immediately tells the operator which sink crossed the threshold.
     * See `flow/run.js` for the assembly into
     * `composerState.partitionState.backpressureAwareSinks`.
     */
    const getBackpressureAwareSinks = function () {
        const map = Object.create( null );
        for ( const [ storageName, handle ] of Object.entries( singletons ) ) {
            if ( typeof handle.getPressure === 'function' ) {
                map[ `storage:${storageName}` ] = handle;
            }
        }
        return map;
    }; // getBackpressureAwareSinks()

    // ========================================================================
    // GET: Retrieve All Singletons (Defensive Copy)
    // ========================================================================
    // Returns a shallow copy of the singleton registry to prevent external
    // mutation. This is useful for health monitoring and debugging.
    const get = function () {
        return { ...singletons };
    }; // get()

    // ========================================================================
    // SHUTDOWN: Graceful Termination of All Storages
    // ========================================================================
    // Coordinates the shutdown of all storage singletons, ensuring connections
    // are properly closed and buffered data is flushed. Uses Promise.allSettled
    // to ensure all shutdowns are attempted even if some fail, preventing one
    // failed shutdown from blocking others. Returns a Promise that resolves
    // when all shutdown attempts complete (successfully or not).
    //
    // IMPORTANT: Registry Clearing Behavior
    // -------------------------------------
    // After calling shutdown() on all storages, the singleton registry is cleared.
    // This design decision serves two purposes:
    //
    // 1. PRODUCTION: Enables clean restart scenarios. If a pipeline shuts down
    //    and needs to restart (e.g., after reconfiguration), fresh storage
    //    instances will be created on the next wire() call. Without clearing,
    //    stale/closed storage references would persist and cause errors.
    //
    // 2. TESTING: Enables test isolation. Each test can call shutdown() in
    //    afterEach() to ensure a clean slate for the next test. Without this,
    //    the singleton pattern would cause state leakage between tests.
    //
    // Usage Guidelines:
    // - In production: Call shutdown() only during pipeline termination or
    //   when intentionally restarting the pipeline with new configuration.
    // - In tests: Call shutdown() in afterEach() to ensure test isolation.
    // - After shutdown(): Any subsequent wire() calls will create new instances.
    //
    // Per ADR-018, each storage's own shutdown takes `{ timeout }`.
    // We pass it through so the flow's per-stage time budget (set in
    // flow/run.js) reaches every storage the same way.
    const shutdown = async function ( { timeout } = {} ) {
        const opts = ( timeout === undefined ) ? undefined : { timeout };
        const names = Object.keys( singletons );
        const results = await Promise.allSettled(
            names.map( ( name ) => {
                // A non-conforming adapter may THROW from shutdown()
                // instead of rejecting. Convert the throw into this
                // adapter's own rejection slot — escaping here would
                // skip the siblings' drain and the registry clear.
                try {
                    return opts ? singletons[ name ].shutdown( opts ) : singletons[ name ].shutdown();
                } catch ( err ) {
                    return Promise.reject( err );
                }
            } )
        );
        // Clear the registry FIRST for clean restart capability (see
        // documentation above for the rationale). This must not depend
        // on the logging below — a hostile rejection payload used to
        // throw mid-log and leave the stale handles behind.
        for ( const key of names ) {
            delete singletons[ key ];
        }
        // A rejected drain must reach a human (ADR-018's two-party
        // rule). allSettled keeps one failing storage from blocking its
        // siblings' drain — but the swallowed rejection is a data loss
        // that would otherwise be visible only to callers inspecting the
        // settled results. Log each one, classified, naming the adapter.
        // String( err ) rather than interpolation: a Symbol rejection
        // reason throws inside a template literal.
        results.forEach( ( result, i ) => {
            if ( result.status === 'rejected' ) {
                const err = result.reason || {};
                const dropped = err.dropped ? ` dropped=${describeDropped( err.dropped )}` : '';
                logger.error(
                    `winkComposer/wiring: storage '${names[ i ]}' shutdown failed [${err.code || 'UNKNOWN'}]: ${err.message || String( err )}${dropped}`
                );
            }
        } );
        return results;
    }; // shutdown()

    // ========================================================================
    // PUBLIC API
    // ========================================================================
    return {
        wire,
        get,
        getBackpressureAwareSinks,
        shutdown
    };
}() ); // storages()

export default storages;

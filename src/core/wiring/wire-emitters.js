// core/wiring/wire-emitters.js

/**
 * @fileoverview Holds the running emitter instances for a flow and creates
 * them on demand from the spec.
 *
 * An "emitter" is the thing that publishes messages out (MQTT broker,
 * terminal/stdout, etc.). One emitter per target name is enough — many
 * partitions can share it — so we keep them in a small registry keyed by
 * target name and only build a new one if we haven't seen that name before.
 *
 * This file is responsible for four things:
 * - Building each emitter at flow startup, by calling its module's
 *   `createEmitter(config)` factory and storing the returned handle.
 * - Calling `applySemanticsRequirement` (from `wire-semantics.js`) on each
 *   emitter so adapters that declare `semanticsRequirement` get the
 *   requested slice of `assetClass` injected before their factory is
 *   called (capability-indexed injection per ADR-018).
 *   No current emitter declares one; the parity machinery is plumbed
 *   for future emitters that will opt in
 *   without further wiring changes. `runtime.assetClass` is threaded in
 *   via a new `assetClass` parameter on `wire()` (default null preserves
 *   any caller that does not pass it).
 * - Checking, the moment we get the handle back, that it has the methods
 *   the rest of the framework will call later (fail loudly at startup
 *   rather than crash deep in the per-message hot path). See
 *   `assert-handle.js` for the check helper and the error format.
 * - Telling the partition manager which emitters expose `getPressure()` so
 *   the pressure-aware yield decision (ADR-020, Draft) can poll them. The
 *   list is exposed via `getBackpressureAwareSinks()` and assembled by
 *   `flow/run.js` after the flow's partition state is set up.
 *
 * Restart safety: `shutdown()` clears the registry after stopping every
 * emitter, so a follow-up `wire()` call on the same process gets a fresh
 * set of handles. (Mirrors `wire-storages.js`; an earlier version cleared
 * only the storage registry.)
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
 * Methods the framework calls on an emitter handle later, so they have to
 * be present at wire time per ADR-018.
 * Note `getStats` was previously here and was later removed from the
 * contract's method surface.
 * `getPressure` is optional — its presence decides whether the handle is
 * collected into `backpressureAwareSinks`, not whether the wire succeeds.
 */
const REQUIRED_EMITTER_METHODS = [ 'publishNow', 'shutdown', 'getHealth' ];

/**
 * Serializes a rejection's `dropped` payload for the shutdown log. A
 * third-party adapter can reject with anything — including structures
 * JSON.stringify throws on (circular references). The log line must never
 * throw: a throw here used to skip the registry clear that followed it.
 * Mirrors `wire-storages.js`.
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

const emitters = ( function () {
    // ========================================================================
    // PRIVATE STATE: Singleton Registry
    // ========================================================================
    // Holds one emitter per target name. Object.create(null) avoids
    // prototype-pollution surprises since target names come from runtime
    // config (DSL `.emitter()` calls).
    const singletons = Object.create( null );

    // ========================================================================
    // WIRE: Discover and Create Emitter Singletons
    // ========================================================================
    /**
     * Scans node specs for Emit-If targets, creates the emitter for each
     * unseen target via its module's `createEmitter(config)` factory,
     * verifies the returned handle has the required methods, and stores
     * it. Idempotent — running `wire()` twice on the same target reuses
     * the existing handle and skips the factory call.
     *
     * `assetClass` is the runtime asset class from `flow.assetClass()`,
     * passed through so emitters that declare `semanticsRequirement` can
     * receive their requested slice (capability-indexed injection per
     * ADR-018). No current emitter declares one; the parameter is
     * plumbed for future emitters (e.g., a structured-MQTT emitter that
     * publishes to `${assetClass}/...` topics) that will opt in without
     * further wiring changes.
     *
     * @param {Array} specs - flow node specs (filtered for Emit If)
     * @param {Object} targetConfigs - map from target name to user config
     * @param {Object} emitterModules - map from target name to adapter module
     * @param {Object|null} [assetClass] - runtime asset class from `flow.assetClass()`,
     *   or null if the flow author did not call it. Default null preserves
     *   backward compatibility for any caller that does not pass it.
     */
    const wire = async function ( specs, targetConfigs, emitterModules, assetClass = null ) {
        for ( const spec of specs ) {
            if ( spec.nodeType !== 'Emit If' || !spec.target ) {
                // eslint-disable-next-line no-continue
                continue;
            }

            const target = spec.target;

            if ( !singletons[ target ] ) {
                const module = emitterModules[ target ];
                const factory = module && module.createEmitter;
                if ( typeof factory !== 'function' ) {
                    throw new Error( `winkComposer/wiring: Invalid emitter module: ${target}` );
                }

                // ADR-018 module-surface check: the module must say what
                // a crash costs — before the factory runs.
                assertModuleDurability( target, module );

                // Build effective config; capability-indexed injection per
                // ADR-018 if the adapter declared `semanticsRequirement`.
                // No current emitter declares one, so for today's adapters
                // this is a no-op spread of user config. Future emitters
                // opt in by exporting a declaration; no further wiring
                // changes needed.
                const effectiveConfig = { ...( targetConfigs[ target ] || {} ) };
                applySemanticsRequirement( target, module, assetClass, effectiveConfig );

                // Await per ADR-018 — sync factories are unaffected (await on
                // a non-Promise resolves immediately); async factories that
                // need real init time (e.g., a future Kafka emitter) are
                // supported transparently.
                // eslint-disable-next-line no-await-in-loop
                const handle = await factory( effectiveConfig );

                // Wire-time shape check (ADR-018). Fails fast with a
                // descriptive error instead of letting a missing method
                // crash the per-message hot path later.
                assertHandle( target, handle, REQUIRED_EMITTER_METHODS );

                singletons[ target ] = handle;
            }

            spec.emitter = singletons[ target ];
        }
    }; // wire()

    // ========================================================================
    // GET BACKPRESSURE-AWARE SINKS
    // ========================================================================
    /**
     * Returns the subset of wired emitters that expose `getPressure()`.
     * Keys are namespaced as `emitter:<target>` so a debug log at the
     * call site (the pressure-aware yield decision, ADR-020) immediately
     * tells the operator which sink crossed the threshold. See
     * `flow/run.js` for the assembly into
     * `composerState.partitionState.backpressureAwareSinks`.
     */
    const getBackpressureAwareSinks = function () {
        const map = Object.create( null );
        for ( const [ target, handle ] of Object.entries( singletons ) ) {
            if ( typeof handle.getPressure === 'function' ) {
                map[ `emitter:${target}` ] = handle;
            }
        }
        return map;
    }; // getBackpressureAwareSinks()

    // ========================================================================
    // GET: Retrieve All Singletons (Defensive Copy)
    // ========================================================================
    // Returns a shallow copy so external callers can inspect the registry
    // without being able to mutate the private one. Used for health
    // monitoring and debugging.
    const get = function () {
        return { ...singletons };
    }; // get()

    // ========================================================================
    // SHUTDOWN: Graceful Termination of All Emitters
    // ========================================================================
    /**
     * Stops every emitter in parallel via `Promise.allSettled`, so one
     * stuck shutdown does not block the others. Then clears the registry
     * — that way a follow-up `wire()` on the same process (e.g., a test
     * tearing down and bringing the flow back up) gets fresh handles
     * instead of stale, already-stopped ones. Mirrors `wire-storages.js`.
     */
    // Per ADR-018, each emitter's own shutdown takes `{ timeout }`.
    // We pass it through so the flow's per-stage time budget (set in
    // flow/run.js) reaches every emitter the same way.
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
        // Restart safety FIRST: drop stale handles so the next wire()
        // rebuilds them. This must not depend on the logging below — a
        // hostile rejection payload used to throw mid-log and leave the
        // stale handles behind.
        for ( const key of names ) {
            delete singletons[ key ];
        }
        // A rejected drain must reach a human (ADR-018's two-party
        // rule). allSettled keeps one failing emitter from blocking its
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
                    `winkComposer/wiring: emitter '${names[ i ]}' shutdown failed [${err.code || 'UNKNOWN'}]: ${err.message || String( err )}${dropped}`
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
}() ); // emitters()

export default emitters;

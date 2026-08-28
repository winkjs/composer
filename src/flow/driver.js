// flow/driver.js

/**
 * @fileoverview Headless-flow driver.
 *
 * A driver feeds a running flow that has no source. It plays the role a source
 * adapter plays: it calls `handle.processMessage( msg )` once per message. It
 * exists so callers get that contract right in one place — the sync-first call
 * (ADR-013), awaiting only on the rare yield tick, and routing a node fault to a
 * handler so one bad message cannot stop the loop.
 *
 * Hot-path allocation: none. A successful message allocates nothing. `feedOne`
 * returns `undefined` (it is not an async function, so no Promise wrapper).
 * `feedAll` keeps primitive counters and iterates a sync source with `for...of`
 * (no per-item await). Faults route to a callback rather than a per-message
 * result object. Promises are allocated only on the rare yield tick (ADR-013,
 * ADR-024) and on faults — never on the success path (ADR-004 zero-allocation
 * hot path). The yield-tick Promise arrives AFTER the message is fully
 * processed (ADR-024 process-then-breathe), so ignoring it never delays or
 * reorders a message; awaiting it is purely the event-loop breath.
 *
 * What it does NOT do: detect a silently dropped message. A message dropped for
 * an over-cap asset id, or a missing assetId field, returns nothing from
 * `processMessage`, exactly as a success does — so `feedAll` counts it as
 * processed. See `docs/handbook/headless-flow.md`.
 *
 * `err.code` vocabulary (console classification; listed per ADR-018):
 * - `CALLBACK_FAILED` — the user's `onError` itself threw or rejected.
 *   The shared callback guard contains the fault (ADR-018): the feed
 *   loop continues, counters stay truthful, and each fault becomes one
 *   classified console line carrying the detail.
 *
 * @see docs/handbook/headless-flow.md
 */

import { wrapCallback } from '../core/utils/callback-guard/index.js';

/**
 * Default fault handler. Surfaces every fault so none is silent. Allocates only
 * when a fault occurs (rare), never on the success path. Provide your own
 * `onError` to route or throttle in production.
 *
 * @param {Error} error - The node fault (wrapped: `error.nodeModule`,
 *   `error.cause`).
 * @returns {void}
 */
const logFault = function ( error ) {
    console.error( `composer/headlessDriver: a message failed — ${error.message}` );
}; // logFault()

/**
 * Create a driver bound to one headless flow handle.
 *
 * @param {Object} handle - Handle returned by `flow(...).run()`. Must expose a
 *   `processMessage` function.
 * @param {Object} [opts={}] - Options.
 * @param {function(Error, Object): void} [opts.onError] - Called as
 *   `onError( error, msg )` for every message that faults, in both `feedOne` and
 *   `feedAll`. Defaults to logging the fault to the console.
 * @returns {{feedOne: function, feedAll: function}} The driver.
 * @throws {TypeError} When `handle` has no `processMessage`, or `onError` is
 *   given but is not a function.
 */
const headlessDriver = function ( handle, opts = {} ) {
    if ( !handle || typeof handle.processMessage !== 'function' ) {
        throw new TypeError(
            'composer/headlessDriver: handle must be the object returned by ' +
            'flow(...).run() — it has no processMessage() function'
        );
    }

    const userOnError = opts.onError === undefined ? logFault : opts.onError;
    if ( typeof userOnError !== 'function' ) {
        throw new TypeError(
            'composer/headlessDriver: onError must be a function'
        );
    }

    // Armed once at construction (validate raw first, then wrap). The
    // fault reporter is user code too, so it gets the same containment
    // as the messages it reports on (ADR-018: a misbehaving user
    // callback never interrupts the operation that invoked it). A
    // throwing or rejecting onError costs one classified console line;
    // the feed continues and the counters stay truthful.
    const onError = wrapCallback( userOnError, {
        name: 'onError',
        severity: 'red',
        report: function ( severity, name, detail ) {
            console.error(
                `composer/headlessDriver: user callback ${name} failed [CALLBACK_FAILED]: ${detail}`
            );
        }
    } );

    /**
     * Feed one message. Use this for push sources, where an event hands you a
     * message and there is no loop to own.
     *
     * Zero allocation on the success path: returns `undefined` synchronously. A
     * fault is routed to `onError`, never thrown, so the caller's event handler
     * is never interrupted. On the rare yield tick it returns a Promise you MAY
     * await for backpressure; that Promise never rejects (a yield-path fault
     * still routes to `onError`).
     *
     * @param {Object} msg - The message to feed.
     * @returns {(undefined|Promise<void>)} `undefined` on the hot path; a Promise
     *   on the yield tick.
     */
    const feedOne = function ( msg ) {
        let pending;
        try {
            pending = handle.processMessage( msg );
        } catch ( error ) {
            onError( error, msg );
            return undefined;
        }
        if ( pending instanceof Promise ) {
            return pending.catch( function ( error ) {
                onError( error, msg );
            } );
        }
        return undefined;
    }; // feedOne()

    /**
     * Feed every message from a source, in order. Use this for pull sources,
     * where you iterate the data.
     *
     * Consumes any sync or async iterable — an array, a generator, an async
     * generator, or a Node object-mode stream. A sync source is iterated with
     * `for...of`, so it allocates nothing per message; an async source is pulled
     * with `for await`, where a Promise per item is inherent. Each message is
     * processed and awaited before the next begins, so the flow sees one message
     * at a time and an async source throttles itself. A faulting message does
     * not stop the stream: it is counted in `failed` and routed to `onError`.
     *
     * A failure of the source iterator itself (a stream that errors mid-read) is
     * not caught here — it rejects the returned Promise for the caller to handle.
     *
     * @param {Iterable|AsyncIterable} source - Messages to feed, in order.
     * @returns {Promise<{processed: number, failed: number}>} Counts taken after
     *   the source is exhausted.
     * @throws {TypeError} When `source` is not a sync or async iterable.
     */
    const feedAll = async function ( source ) {
        const isAsync = typeof source?.[ Symbol.asyncIterator ] === 'function';
        const isSync = typeof source?.[ Symbol.iterator ] === 'function';
        if ( !isAsync && !isSync ) {
            throw new TypeError(
                'composer/headlessDriver.feedAll: source must be a sync or async ' +
                'iterable (an array, a generator, or a stream)'
            );
        }

        let processed = 0;
        let failed = 0;

        // Two loops on purpose: `for await` over a sync source would allocate a
        // Promise per item (it awaits each value). The sync branch uses `for...of`
        // and awaits only on the rare yield tick, keeping the hot path alloc-free.
        if ( isAsync ) {
            for await ( const msg of source ) {
                try {
                    const pending = handle.processMessage( msg );
                    if ( pending instanceof Promise ) {
                        await pending;
                    }
                    processed += 1;
                } catch ( error ) {
                    failed += 1;
                    onError( error, msg );
                }
            }
        } else {
            for ( const msg of source ) {
                try {
                    const pending = handle.processMessage( msg );
                    if ( pending instanceof Promise ) {
                        await pending; // eslint-disable-line no-await-in-loop
                    }
                    processed += 1;
                } catch ( error ) {
                    failed += 1;
                    onError( error, msg );
                }
            }
        }

        return { processed, failed };
    }; // feedAll()

    return { feedOne, feedAll };
}; // headlessDriver()

export { headlessDriver };

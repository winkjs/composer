// core/emitter-manager/mqtt/shutdown-drain.js

/**
 * @fileoverview The drain of the MQTT emitter: `flush()` and the
 * drain-then-close `shutdown()` (ADR-018 §6 and §7, ADR-021).
 *
 * A clean shutdown resolve is a delivery statement: every accepted
 * message reached a settled outcome before the client closed. The
 * drain is a wait on the emitter's own unacked counter, because
 * mqtt.js's own `end()` does not reliably drain in-flight publishes
 * (a sustained-load finding, kept through the ADR-021 rework).
 *
 * `flush()` runs the same wait and nothing else. It closes nothing and
 * refuses no new work. It resolves when the counter reaches zero
 * within its budget. When the budget passes first it rejects with
 * `DELIVERY_FAILED` and `pending: { count }`, the code QuestDB's
 * flush uses when its own deadline passes. The messages stay in
 * flight; a later acknowledgment still settles them.
 *
 * The shutdown outcome is latched on the first call. Every later
 * caller receives the same promise, so a second call can never
 * contradict the first with an instant clean resolve.
 *
 * The budget reads a monotonic clock. A wall-clock correction during
 * a drain would otherwise shorten or lengthen the wait by the size of
 * the step.
 *
 * How the close detaches (ADR-018 §7). A graceful `end( false )` waits
 * for the client's outgoing map to empty, which a lossy drain cannot
 * deliver. So when rows remain, or the link is down, the close is
 * forced at once: the library destroys the stream and the keepalive
 * timer. A forced close sends no DISCONNECT packet. With a clean
 * session and an in-memory store, nothing is lost that the drain had
 * not already lost. When the drain finished on a live link, the close
 * is graceful, and a timer bounds it. That timer destroys the stream
 * directly, the call the library's own connack timeout makes, because
 * a second `end()` returns at once behind the library's
 * `disconnecting` flag (mqtt.js 5.15.1, `client.js:731-734`).
 *
 * @see ADR-018
 * @see ADR-021
 */

import { performance } from 'node:perf_hooks';

/**
 * The graceful close, bounded by a timer. The library sends DISCONNECT
 * and half-closes the socket. A broker that never answers leaves the
 * socket half-open for ever, so at the deadline the timer destroys the
 * stream itself. The timer runs outside every promise, so a throw
 * there would end the process; it is counted instead.
 *
 * @param {Object} client - mqtt.js client
 * @param {Object} state - The emitter's core state, for the error count
 * @param {number} closeBudget - Milliseconds the broker gets to answer
 * @returns {Promise<void>} resolves when the client closed or the timer fired
 */
const closeGracefully = function ( client, state, closeBudget ) {
    return new Promise( ( resolve ) => {
        const forceTimer = setTimeout( () => {
            try {
                client.stream.destroy();
            } catch {
                state.stats.errors += 1;
            }
            resolve();
        }, closeBudget );

        client.end( false, {}, () => {
            clearTimeout( forceTimer );
            resolve();
        } );
    } );
}; // closeGracefully()

/** The drain budget when the caller gives none, in milliseconds. */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;

/** One cheap counter read per tick of the drain wait. */
const DRAIN_POLL_INTERVAL_MS = 25;

/**
 * A non-finite or non-positive timeout collapses the drain (Infinity
 * overflows setTimeout, which clamps it to ~1 ms; NaN fails every
 * deadline comparison), so it falls back to the default budget.
 *
 * @param {*} timeout - The caller's timeout
 * @returns {number} a positive finite budget in milliseconds
 */
const resolveBudget = function ( timeout ) {
    return ( Number.isFinite( timeout ) && timeout > 0 ) ? timeout : DEFAULT_SHUTDOWN_TIMEOUT_MS;
}; // resolveBudget()

/**
 * Builds `flush` and the latched `shutdown` over the shared state.
 *
 * @param {Object} deps
 * @param {Object} deps.client - mqtt.js client
 * @param {Object} deps.state - The emitter's core state
 * @returns {{flush: function, shutdown: function}}
 */
export const createShutdown = function ( { client, state } ) {
    // Shutdown outcome, latched on the first call. A second
    // caller used to get an instant clean resolve — mid-drain, or even
    // after a shutdown that recorded dropped messages. Every caller now
    // receives the first call's promise.
    let shutdownPromise = null;

    /**
     * Waits for the unacked counter to reach zero, up to the budget.
     * The deadline reads a monotonic clock, so a wall-clock step cannot
     * move it. Sequential awaits are the wait-for-condition pattern.
     *
     * @param {number} budget - Milliseconds to wait, positive and finite
     * @returns {Promise<number>} the milliseconds left in the budget, negative when it ran out
     */
    const waitForDrain = async function ( budget ) {
        const deadline = performance.now() + budget;
        while ( ( performance.now() < deadline ) && ( state.unacked > 0 ) ) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise( ( r ) => setTimeout( r, DRAIN_POLL_INTERVAL_MS ) );
        }
        return deadline - performance.now();
    }; // waitForDrain()

    /**
     * Waits for every accepted message to settle, without closing the
     * client or refusing new work (ADR-018 §6).
     *
     * @param {{timeout?: number}} [options] - The budget, default 5000 ms
     * @returns {Promise<void>} resolves when nothing is unacknowledged
     * @throws {Error} DELIVERY_FAILED with `pending: { count }` when the budget passes first
     */
    const flush = async function ( { timeout = DEFAULT_SHUTDOWN_TIMEOUT_MS } = {} ) {
        const budget = resolveBudget( timeout );
        await waitForDrain( budget );
        if ( state.unacked > 0 ) {
            const err = new Error(
                `winkComposer/mqttEmitter: flush ended with ${state.unacked} message(s) unacknowledged [DELIVERY_FAILED]: no acknowledgment within ${budget} ms`
            );
            err.code = 'DELIVERY_FAILED';
            err.pending = { count: state.unacked };
            throw err;
        }
    }; // flush()

    /**
     * The real shutdown body. `shutdown` below latches its promise so
     * every caller receives this one outcome.
     *
     * **Drain-then-close** (a sustained-load finding, kept through the
     * ADR-021 rework): mqtt.js's own `end()` does not reliably drain
     * in-flight publishes, so the emitter waits on its own counter.
     *
     *  1. Sets `state.shuttingDown` so `publishNow` rejects new work
     *     (returns `SHUTTING_DOWN` immediately).
     *  2. **Polls the unacked counter until zero**, using the whole
     *     `timeout` budget — no early give-up. The wait runs whether or
     *     not the connection is up at the moment of the call. With the
     *     default 5 s budget and 5 s reconnect period, at most one
     *     reconnect attempt can land inside the drain, and a connect
     *     that hangs cannot complete within it (the connect timeout is
     *     30 s).
     *  3. Once drained on a live link, calls `client.end( false )` with
     *     the remaining time as the broker-DISCONNECT budget. With rows
     *     still unacknowledged, or the link down, calls
     *     `client.end( true )` at once instead.
     *  4. If the broker hangs the DISCONNECT, the timer destroys the
     *     stream directly (see the file header).
     *
     * The old design's shutdown re-drive (re-sending stragglers through
     * a store stream scan) died with the disk store: with the memory
     * store there is no store to scan, and a message whose PUBACK was
     * lost in-session is re-sent by the client itself on the next
     * reconnect. If it is still unacknowledged at the deadline, the
     * loss report counts it.
     *
     * A clean resolve is a delivery statement (ADR-018). When the
     * drain could not complete, shutdown rejects with classified
     * `SHUTDOWN_TIMEOUT` and `dropped: { count }` — the counter's exact
     * value — after the close has already happened (teardown first,
     * then the report). This fires CONNECTED OR NOT: with no disk
     * store, nothing survives the process, so a disconnected shutdown
     * with pending messages is a real loss and is reported as one. (The
     * wal-backed design resolved that case clean on purpose — its disk
     * store held the messages for the next session. ADR-021 traded that
     * away and says so.)
     */
    const doShutdown = async function ( timeout ) {
        state.shuttingDown = true;

        const remaining = await waitForDrain( resolveBudget( timeout ) );

        // Whatever is still unacknowledged goes undelivered — publishNow
        // stopped accepting work at step 1, so the counter has settled
        // into its final value. It becomes the `dropped` payload below.
        const undeliveredCount = state.unacked;
        const closeBudget = remaining > 0 ? remaining : 1;

        if ( ( undeliveredCount > 0 ) || !state.connected ) {
            // Forced: the library destroys the stream and the keepalive
            // at once, and the call returns synchronously.
            client.end( true );
        } else {
            await closeGracefully( client, state, closeBudget );
        }

        // Teardown first, then the report: the close has already happened;
        // an incomplete drain must not read as a clean one (ADR-018).
        if ( undeliveredCount > 0 ) {
            const err = new Error(
                `winkComposer/mqttEmitter: shutdown closed with ${undeliveredCount} message(s) unacknowledged`
            );
            err.code = 'SHUTDOWN_TIMEOUT';
            err.dropped = { count: undeliveredCount };
            throw err;
        }
        return undefined;
    }; // doShutdown()

    /**
     * Graceful shutdown — drain semantics with a timeout floor.
     *
     * Accepts the ADR-018 shutdown-contract shape `{ timeout }` (defaults to
     * 5000ms). The destructure with `= {}` lets callers invoke
     * `shutdown()` with no argument, `shutdown( {} )`, or
     * `shutdown( { timeout: N } )`.
     *
     * The outcome is latched: the first call runs the shutdown, every
     * later call returns the same promise. A caller
     * arriving mid-drain waits for the real teardown; a caller arriving
     * after a lossy shutdown sees the same classified rejection, never
     * a contradicting clean resolve. One consequence: the first
     * caller's `{ timeout }` governs; a later caller's is ignored.
     *
     * @param {{timeout?: number}} [options]
     * @returns {Promise<void>}
     */
    const shutdown = function ( { timeout = DEFAULT_SHUTDOWN_TIMEOUT_MS } = {} ) {
        if ( !shutdownPromise ) {
            shutdownPromise = doShutdown( timeout );
        }
        return shutdownPromise;
    }; // shutdown()

    return { flush, shutdown };
}; // createShutdown()

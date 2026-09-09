// core/emitter-manager/mqtt/shutdown-drain.js

/**
 * @fileoverview The drain-then-close shutdown of the MQTT emitter
 * (ADR-018 §7, ADR-021).
 *
 * A clean shutdown resolve is a delivery statement: every accepted
 * message reached a settled outcome before the client closed. The
 * drain is a wait on the emitter's own unacked counter, because
 * mqtt.js's own `end()` does not reliably drain in-flight publishes
 * (a sustained-load finding, kept through the ADR-021 rework).
 *
 * The outcome is latched on the first call. Every later caller
 * receives the same promise, so a second call can never contradict
 * the first with an instant clean resolve.
 *
 * @see ADR-018
 * @see ADR-021
 */

/** The drain budget when the caller gives none, in milliseconds. */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * Builds the latched `shutdown` over the shared state.
 *
 * @param {Object} deps
 * @param {Object} deps.client - mqtt.js client
 * @param {Object} deps.state - The emitter's core state
 * @returns {function} shutdown
 */
export const createShutdown = function ( { client, state } ) {
    // Shutdown outcome, latched on the first call. A second
    // caller used to get an instant clean resolve — mid-drain, or even
    // after a shutdown that recorded dropped messages. Every caller now
    // receives the first call's promise.
    let shutdownPromise = null;

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
     *     not the connection is up at the moment of the call: mqtt.js
     *     auto-reconnects, so a mid-drain reconnect can still deliver
     *     the backlog inside the budget.
     *  3. Once drained (or budget expired), calls `client.end(...)`
     *     with the remaining time as the broker-DISCONNECT budget.
     *  4. Force-closes if the broker hangs the DISCONNECT.
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

        // A non-finite or non-positive timeout collapses the drain
        // (Infinity overflows setTimeout, which clamps it to ~1 ms;
        // NaN fails every deadline comparison), so it falls back to
        // the default budget.
        const budget = ( Number.isFinite( timeout ) && timeout > 0 ) ? timeout : DEFAULT_SHUTDOWN_TIMEOUT_MS;
        const deadline = Date.now() + budget;
        const drainPollIntervalMs = 25;

        // Drain wait — one cheap counter read per tick; sequential
        // awaits are the wait-for-condition pattern.
        while ( Date.now() < deadline && state.unacked > 0 ) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise( ( r ) => setTimeout( r, drainPollIntervalMs ) );
        }

        // Whatever is still unacknowledged goes undelivered — publishNow
        // stopped accepting work at step 1, so the counter has settled
        // into its final value. It becomes the `dropped` payload below.
        const undeliveredCount = state.unacked;
        const remaining = Date.now() - deadline;
        const closeBudget = remaining < 0 ? Math.abs( remaining ) : 1;

        await new Promise( ( resolve ) => {
            const forceTimer = setTimeout( () => {
                client.end( true );
                resolve();
            }, closeBudget );

            if ( state.connected ) {
                client.end( false, {}, () => {
                    clearTimeout( forceTimer );
                    resolve();
                } );
            } else {
                clearTimeout( forceTimer );
                client.end( true );
                resolve();
            }
        } );

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

    return shutdown;
}; // createShutdown()

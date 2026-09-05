// core/storage-manager/questdb/flush-engine.js

/**
 * @fileoverview The flush engine of the QuestDB adapter (ADR-029). It
 * owns the hot path (`write`), every flush, the counters behind
 * pressure and health, and the drain at shutdown. The factory in
 * `index.js` builds the connected sender and the persist plans, then
 * hands them to `createFlushEngine`, which returns the handle methods.
 *
 * Composer owns every flush. The client's own trigger is off
 * (`auto_flush=off`, set by the factory), so a batch leaves the process
 * only when this module says so. Two triggers exist. A write that
 * brings the buffer to `flushRows` starts a flush at once, inside
 * `write()`, and does not wait for it. A timer starts a flush every
 * `flushIntervalMs` when anything is buffered, so a slow stream still
 * lands within about one interval. Only one engine flush runs at a
 * time. While one is in flight, both triggers wait and rows collect in
 * the buffer. An explicit `flush()`, the shutdown drain, and the
 * mid-row recovery flush are the caller's own decisions and start
 * regardless.
 *
 * Why the module counts exactly. The client copies the rows out of
 * its buffer the moment a flush starts, before any network work. So
 * `bufferedRows` counts rows waiting for the next flush, and
 * `inFlightRows` counts rows inside flushes that have not settled.
 * Every flush start and settle passes through `trackFlush`, so both
 * numbers are exact, not estimates. A failed flush has lost its rows,
 * because the copy is gone with it. The engine reports that loss once
 * per flush: to `onDeliveryFailure` when the caller gave one, as
 * `( err, { trigger, rowsLost, abandoned } )`, otherwise as one
 * classified `DELIVERY_FAILED` console line. The process keeps running
 * either way. An unattended deployment must report a lost batch, not
 * stop on it.
 *
 * The ceiling (ADR-018 §12). Once the rows buffered plus the rows in
 * flight reach `bufferCeilingRows`, `write()` refuses new rows with
 * `STORAGE_FULL`. The refusal is one shared object, so shedding costs
 * no allocation. A shed row is a capacity refusal, not a sender error,
 * and does not touch the error counter. Health reads red at the
 * ceiling.
 *
 * Not yet in this version, and landing with the next change: a
 * deadline per flush, so a send that never settles is abandoned and
 * reported, and a pause of delivery while the endpoint is unreachable,
 * so a short QuestDB restart costs no rows.
 *
 * Health (ADR-018 §8). `connected` is derived, because the ILP client
 * exposes no socket state: false while shutting down or after five
 * consecutive write errors. `status` is `red` when not connected or at
 * capacity (`pressure >= 1`), `yellow` when `pressure >= 0.66` or any
 * write error is outstanding, `green` otherwise. One successful write
 * clears the error count.
 *
 * Shutdown (ADR-018 drain-then-close). A clean resolve is a delivery
 * statement: everything buffered or in flight was delivered. Shutdown
 * settles every unsettled flush plus one final flush, raced against
 * the caller's `{ timeout }`. Its outcome is latched, so repeated calls
 * cannot contradict it. A loss is a classified rejection carrying
 * `dropped: { count }`: `DELIVERY_FAILED` when a flush failed, and
 * `SHUTDOWN_TIMEOUT` when delivery did not settle in time.
 *
 * Mid-row recovery (ADR-018 — a rejected message costs that message,
 * nothing else):
 * - A persist plan that throws between sender.table() and sender.at() leaves
 *   the client holding a half-written row. Without recovery, every later
 *   write fails with "Table name has already been set" — the 2026-06-10
 *   silent-write-failure incident lost 98.6% of a replay's rows this way.
 * - write()'s catch therefore calls recoverSender(), which composes two
 *   documented client calls: flush() ships every COMPLETED row out of the
 *   buffer (the copy-out happens synchronously, before any network I/O; the
 *   client documents that an unfinished row stays behind), then reset()
 *   clears the buffer — at that point holding only the broken stub — and
 *   lowers the client's row-in-progress flags.
 * - The recovery flush carries real data and is tracked like every
 *   flush. If it fails, the loss is reported like any other:
 *   `onDeliveryFailure( err, { trigger: 'recovery', rowsLost, abandoned } )`,
 *   or one `DELIVERY_FAILED` line.
 * - The client (4.2.0) has no row-cancel API, while its sibling clients do
 *   (.NET CancelRow, Rust/C rewind_to_marker, Java recovers automatically).
 *   Upstream issue #60 tracks the gap:
 *   https://github.com/questdb/nodejs-questdb-client/issues/60
 *   When a release ships cancelRow(), recoverSender() becomes that one call.
 *
 * Long-running commitments (ADR-018 §12). One timer, created at setup
 * and cleared at shutdown; it does not hold the process open. Every
 * counter is bounded by the ceiling. The per-row path allocates
 * nothing in this module; the persist plan documents its own one
 * derived promise per row. Reconnection and request retries belong to
 * the client. No listeners are attached.
 *
 * Client facts this module relies on (`@questdb/nodejs-client`, pinned
 * `~4.2.0`; re-verify each on an upgrade):
 * - `flush()` is `async` and copies the completed rows out of the
 *   buffer before it sends (copy-out).
 * - `at()` is `async`; its append runs first and synchronously.
 * - `tryFlush()` checks `auto_flush` first, so `auto_flush=off` stops
 *   every client-side flush.
 * - `close()` on the HTTP transport is an empty function. Nothing here
 *   can abort an in-flight send; process exit is the backstop.
 * - A send against an unreachable server can retry without end
 *   (undici `RetryAgent`, `maxRetries: Infinity`), so a flush promise
 *   may never settle. The shutdown `{ timeout }` bounds it today; the
 *   per-flush deadline lands next.
 *
 * The adapter's `index.js` header carries the full `err.code`
 * vocabulary, the defaults table, and the deprecated options.
 *
 * @see ADR-018
 * @see ADR-029
 */

import { logger } from '../../logger/index.js';
import { wrapCallback } from '../../utils/callback-guard/index.js';

// ============================================================================
// HOT-PATH SINGLETONS
// ============================================================================

/**
 * Singleton success result reused on every successful write. Hot-path zero
 * allocation per ADR-013 / ADR-004. Plain literal — not frozen (V8 hot paths
 * handle plain objects more predictably; no caller mutates this).
 * @type {{ok: true}}
 */
const RESULT_OK = { ok: true };

/**
 * Shared refusal for a write after `shutdown()` was called. The timer is
 * stopped and the final flush may have run, so a row accepted now would
 * have no flusher left. Static text, one object: refusing allocates
 * nothing.
 * @type {{ok: false, error: {code: string, message: string}}}
 */
const RESULT_SHUTTING_DOWN = {
    ok: false,
    error: {
        code: 'SHUTTING_DOWN',
        message: 'winkComposer/questdb: write rejected [SHUTTING_DOWN]: the storage is shutting down'
    }
};

/**
 * Shared refusal for a write at the buffer ceiling (ADR-029). Shedding
 * happens under stress, when the endpoint is not taking rows, so the
 * refusal must cost nothing per call. Static text, one object.
 * @type {{ok: false, error: {code: string, message: string}}}
 */
const RESULT_STORAGE_FULL = {
    ok: false,
    error: {
        code: 'STORAGE_FULL',
        message: 'winkComposer/questdb: write rejected [STORAGE_FULL]: the buffer holds bufferCeilingRows rows ' +
            'and the endpoint has not taken them; the row was shed'
    }
};

/**
 * Console channel for the callback guard: one classified line in this
 * adapter's family. Receives an already-safe detail string, never the
 * raw thrown value.
 */
const reportCallbackFault = function ( severity, name, detail ) {
    logger.error(
        `winkComposer/questdb: user callback ${name} failed [CALLBACK_FAILED]: ${detail}`
    );
}; // reportCallbackFault()

// Error results (INVALID_INSIGHT_TYPE, SEND_FAILED) are constructed per-call
// because each carries dynamic content (the offending insightType name and the
// underlying err.message respectively). These paths are rare; per-occurrence
// allocation on errors is acceptable. The singletons above cover the
// per-message hot path and the two refusals that can fire under load.

// ============================================================================
// HEALTH THRESHOLDS
// ============================================================================

/**
 * Health status thresholds. consecutiveWriteErrors crossing the YELLOW
 * threshold elevates status to 'yellow'; crossing the RED threshold flips
 * `connected` to false (and therefore `status` to 'red'). Tuned for "any
 * error is worth flagging" + "sustained errors mean the transport is gone."
 */
const HEALTH_ERROR_YELLOW_THRESHOLD = 1;
const HEALTH_ERROR_RED_THRESHOLD = 5;

/**
 * Pressure threshold above which `status` elevates to at least 'yellow'.
 * The value matches the pressure-aware-yield design (ADR-020, still a
 * Draft). That design proposes 0.66 as the pressure level where the
 * flow would start yielding to let sinks drain; the number still needs
 * benchmark confirmation. Today the yield trigger is time-only (ADR-024), so
 * this alignment is forward-looking, not a description of current yield
 * behaviour. Numeric — the constant exists once here rather than scattered
 * as a magic number.
 */
const HEALTH_PRESSURE_YELLOW_THRESHOLD = 0.66;

/**
 * Pressure at which the adapter is at capacity: the next write is shed.
 * ADR-018 §8 makes this red, whether or not the transport is known to
 * be down.
 */
const HEALTH_PRESSURE_RED_THRESHOLD = 1;

// ============================================================================
// SHUTDOWN RACE
// ============================================================================

/**
 * Race a final flush against the shutdown time budget. No budget
 * (0/undefined) means no enforcement — the await is unbounded, preserving
 * direct-caller behavior. On timeout the flush promise is deliberately
 * left pending: the client's send may never settle (see the file header),
 * and the process is shutting down anyway. Its eventual rejection, if
 * any, is absorbed by the race's own handlers — never an
 * unhandledRejection.
 *
 * @param {Promise} flushPromise - the in-flight sender.flush()
 * @param {number} timeoutMs - budget in ms; 0/absent disables the race
 * @returns {Promise} settles with the flush, or rejects SHUTDOWN_TIMEOUT
 */
const raceFlushTimeout = function ( flushPromise, timeoutMs ) {
    if ( !( timeoutMs > 0 ) ) {
        return flushPromise;
    }
    return new Promise( function ( resolve, reject ) {
        const timer = setTimeout( function () {
            const err = new Error( `final flush did not settle within ${timeoutMs} ms` );
            err.code = 'SHUTDOWN_TIMEOUT';
            reject( err );
        }, timeoutMs );
        timer.unref();
        flushPromise.then(
            function ( value ) {
                clearTimeout( timer );
                resolve( value );
            },

            /* c8 ignore start -- unreachable from the sole caller:
               doShutdown races a Promise.all over waits that absorb
               their own rejections (that is what keeps the dropped
               count exact), so the raced promise cannot reject today.
               The handler stays because this utility's contract is
               generic — without it, a rejecting promise from a future
               caller would become an unhandled rejection and a race
               that never settles. */
            function ( err ) {
                clearTimeout( timer );
                reject( err );
            }

            /* c8 ignore stop */
        );
    } );
}; // raceFlushTimeout()

// ============================================================================
// THE ENGINE
// ============================================================================

/**
 * Builds the flush engine over a connected sender and its persist
 * plans. Called once by the factory, after setup succeeded. Returns
 * the handle methods the adapter contract requires (ADR-018 §6).
 *
 * @param {Object} parts - What the engine runs on
 * @param {Object} parts.sender - The connected ILP sender
 * @param {Object} parts.persistPlans - Persist plan per insight type
 * @param {Object} parts.settings - Resolved settings (`flushRows`, `flushIntervalMs`, `bufferCeilingRows`)
 * @param {function} [parts.onDeliveryFailure] - The caller's handler, already validated by the plan builder
 * @returns {{write: function, flush: function, shutdown: function, getPressure: function, getHealth: function}}
 */
const createFlushEngine = function ( { sender, persistPlans, settings, onDeliveryFailure } ) {
    const { flushRows, flushIntervalMs, bufferCeilingRows } = settings;

    // Arm the delivery-failure callback for this module's report sites:
    // the engine flushes and the mid-row recovery flush. All fire inside
    // promise chains, where a broken handler used to become an
    // unhandled rejection. The guard classifies the fault instead
    // (ADR-018) and its cost stays inside the handler. The plan builder
    // validated the raw value before this call, so wrapping here is
    // after validation (ADR-027). Absent stays null, so the no-handler
    // console fallback keeps its meaning.
    const safeOnDeliveryFailure = wrapCallback( onDeliveryFailure, {
        name: 'onDeliveryFailure', severity: 'red', report: reportCallbackFault
    } );

    // ------------------------------------------------------------------
    // Engine state
    // ------------------------------------------------------------------

    // Rows accepted and waiting for the next flush. The client copies
    // its rows out of the buffer the moment a flush starts. So a flush
    // start moves this count to `inFlightRows` at once.
    let bufferedRows = 0;

    // Rows inside flushes that have not settled, plus the promises
    // carrying them. getPressure() adds this to bufferedRows: a hung
    // flush is undelivered data and must read as pressure. shutdown()
    // settles these entries instead of firing a blind flush at a
    // buffer the copy-out already emptied.
    let inFlightRows = 0;
    const inFlightFlushes = new Set();

    // One engine flush at a time (ADR-029). A send against an
    // unreachable server can hang; without this guard every timer tick
    // and every threshold crossing would start another stuck request.
    // While the guard is up, rows collect in the buffer up to the
    // ceiling, and the condition shows as rising pressure. Only the
    // row and timer triggers respect the guard.
    let flushInFlight = false;

    // Shutdown outcome, latched on the first call. A lossy shutdown's
    // failed flush already emptied the buffer via copy-out. A re-run
    // would find nothing to flush and resolve clean, contradicting the
    // recorded loss. Every caller gets the first call's promise instead.
    let shutdownPromise = null;

    // Health state. shuttingDown flips true at the start of shutdown()
    // and never resets. consecutiveWriteErrors increments on every
    // write() catch and resets to 0 on every successful persist plan
    // call. A shed row touches neither: it is a capacity refusal, not
    // a sender error.
    let shuttingDown = false;
    let consecutiveWriteErrors = 0;

    /**
     * Registers a flush the moment it is called. Copy-out means the rows
     * leave the buffer NOW, delivered or not, so the caller hands them
     * over in the same breath. Settlement — either way — removes them
     * from the in-flight tally: resolved means delivered; rejected means
     * lost, and loss REPORTING stays with the caller (the engine and the
     * recovery flush report through `reportFlushLoss`, shutdown throws
     * classified, an explicit `flush()` rejects to its caller).
     *
     * @param {Promise} flushPromise - the just-fired sender.flush()
     * @param {number} rows - row count the flush copy carries
     * @returns {{promise: Promise, rows: number}} the tracked entry
     */
    const trackFlush = function ( flushPromise, rows ) {
        const entry = { promise: flushPromise, rows };
        inFlightRows += rows;
        inFlightFlushes.add( entry );
        const settle = function () {
            inFlightFlushes.delete( entry );
            inFlightRows -= rows;
        };
        flushPromise.then( settle, settle );
        return entry;
    }; // trackFlush()

    /**
     * Reports one lost flush. The rows are gone with the failed copy,
     * so this is a statement of loss, not a retry hint. The caller owns
     * the response when it asked to; otherwise one classified line.
     * The process keeps running either way (see the file header).
     *
     * @param {Error} err - The client's rejection
     * @param {string} trigger - 'rows', 'timer' or 'recovery'
     * @param {number} rows - Rows the flush carried
     */
    const reportFlushLoss = function ( err, trigger, rows ) {
        if ( safeOnDeliveryFailure ) {
            safeOnDeliveryFailure( err, { trigger, rowsLost: rows, abandoned: false } );
            return;
        }
        logger.error( `winkComposer/questdb: flush failed, ${rows} row(s) lost [DELIVERY_FAILED]: ${err.message}` );
    }; // reportFlushLoss()

    /** Lowers the single-flight guard. */
    const releaseFlight = function () {
        flushInFlight = false;
    }; // releaseFlight()

    /**
     * Starts one engine flush for everything buffered. The caller has
     * checked the guard and that the buffer is not empty. The client's
     * flush() is async, so it never throws here (a 4.2.0 fact recorded
     * in the header); its rejection is handled below.
     *
     * @param {string} trigger - 'rows' or 'timer', for the loss report
     */
    const startFlush = function ( trigger ) {
        flushInFlight = true;
        const rows = bufferedRows;
        bufferedRows = 0;
        const entry = trackFlush( sender.flush(), rows );
        entry.promise.then( releaseFlight, function ( err ) {
            releaseFlight();
            reportFlushLoss( err, trigger, rows );
        } );
    }; // startFlush()

    /**
     * The timer tick: flush whatever is buffered, unless a flush is
     * already in flight. Synchronous and O(1); nothing here can throw.
     */
    const checkFlush = function () {
        if ( flushInFlight || ( bufferedRows === 0 ) ) {
            return;
        }
        startFlush( 'timer' );
    }; // checkFlush()

    // The one timer (ADR-018 §12): created here, cleared at shutdown.
    // It does not hold the process open. The client's own interval
    // trigger would not have served. It checks elapsed time only when
    // a new row arrives. A stream that stops would leave its last rows
    // in the buffer for good.
    const flushTimer = setInterval( checkFlush, flushIntervalMs );
    flushTimer.unref();

    // ------------------------------------------------------------------
    // The handle
    // ------------------------------------------------------------------

    /**
     * Cancels a half-written ILP row after a mid-row throw, so the NEXT write
     * starts clean (see "Mid-row recovery" in the file header for the full
     * account and the upstream issue link).
     *
     * flush() copies every completed row out of the buffer synchronously and
     * sends them in the background; the unfinished row stays behind. reset()
     * then clears the buffer — only the broken stub remains at that point —
     * and lowers the client's row-in-progress flags. Net effect: the broken
     * row vanishes, every good row is on its way, the sender accepts the
     * next write.
     *
     * The early flush carries real data. If its send fails, that loss is
     * reported like any other (see `reportFlushLoss`). Never silent.
     */
    const recoverSender = function () {
        try {
            // flush() is an async function: it can never throw synchronously,
            // and the rows it sends live in its own copy of the buffer.
            // Tracked like every flush, so shutdown settles it and its
            // rows stay visible as pressure until it settles.
            const rows = bufferedRows;
            const entry = trackFlush( sender.flush(), rows );
            sender.reset();
            bufferedRows = 0;

            entry.promise.catch( function ( flushErr ) {
                reportFlushLoss( flushErr, 'recovery', rows );
            } );
        } catch ( recoveryErr ) {
            // Defensive: with the 4.2.0 client neither call can throw here
            // (flush is async, reset is trivial buffer bookkeeping). A
            // future client could change that and leave the sender
            // wedged. Even then write() must return its classified result
            // rather than throw (ADR-018: the hot path never throws), and
            // the failure must be visible.
            logger.error( `winkComposer/questdb: sender recovery failed: ${recoveryErr.message}` );
        }
    }; // recoverSender()

    /**
     * Write a message to QuestDB for a given insightType.
     *
     * Sync hot-path return per ADR-018 / ADR-013:
     * - `RESULT_OK` (singleton) on successful enqueue.
     * - `RESULT_SHUTTING_DOWN` (singleton) after shutdown() was called.
     * - `{ ok: false, error: { code: 'INVALID_INSIGHT_TYPE', message } }`
     *   when the insightType has no persist plan (config error).
     * - `RESULT_STORAGE_FULL` (singleton) when the rows buffered plus the
     *   rows in flight have reached `bufferCeilingRows`.
     * - `{ ok: false, error: { code: 'SEND_FAILED', message } }` when the
     *   persist plan throws (sender method failure: type coercion
     *   failure, a client throw).
     *
     * Never throws. A row that brings the buffer to `flushRows` starts a
     * flush before this returns, unless one is already in flight. The
     * flush is not awaited.
     *
     * @param {string} insightType - SignalType name (must exist in assetClass)
     * @param {Object} message - Message with column values
     * @param {string} partitionId - Partition identifier (stored as SYMBOL)
     * @returns {{ok: true} | {ok: false, error: {code: string, message: string}}}
     */
    const write = function ( insightType, message, partitionId ) {
        if ( shuttingDown ) {
            return RESULT_SHUTTING_DOWN;
        }

        const persistPlan = persistPlans[ insightType ];

        if ( !persistPlan ) {
            return {
                ok: false,
                error: {
                    code: 'INVALID_INSIGHT_TYPE',
                    message: `No persist plan for insightType '${insightType}'`
                }
            };
        }

        // The ceiling counts rows in flight too: a hung flush holds real
        // memory, and the row it would make room for has not landed.
        if ( ( bufferedRows + inFlightRows ) >= bufferCeilingRows ) {
            return RESULT_STORAGE_FULL;
        }

        try {
            // The plan reports whether it actually opened a row. A row
            // skipped in phase 1 (bad designated timestamp) never touched
            // the sender and must not count as buffered. It would inflate
            // pressure and shutdown's dropped count.
            const written = persistPlan( sender, message, partitionId );
            consecutiveWriteErrors = 0;  // recovery — health flips back to green
            if ( written ) {
                bufferedRows += 1;
                if ( ( bufferedRows >= flushRows ) && !flushInFlight ) {
                    startFlush( 'rows' );
                }
            }
            return RESULT_OK;
        } catch ( err ) {
            consecutiveWriteErrors += 1;  // health degradation signal
            // The throw may have left a half-written row in the sender.
            // Cancel it, so this failure costs one row and not the rest
            // of the run (ADR-018). Safe to call even when no row was
            // open: flushing early is harmless, and reset() on a
            // consistent buffer is a no-op.
            recoverSender();
            return {
                ok: false,
                error: {
                    code: 'SEND_FAILED',
                    message: err.message
                }
            };
        }
    }; // write()

    /**
     * Flush pending rows to QuestDB now. The caller's own decision: it
     * starts a flush even while an engine flush is in flight. The rows
     * move to the in-flight tally at the call (copy-out); a failure
     * rejects to the caller, and the settle handler keeps the pressure
     * accounting straight either way. Nothing buffered: resolves at once.
     *
     * @returns {Promise<void>}
     */
    const flush = async function () {
        if ( bufferedRows === 0 ) {
            return;
        }
        const entry = trackFlush( sender.flush(), bufferedRows );
        bufferedRows = 0;
        await entry.promise;
    }; // flush()

    /**
     * Backpressure metric for the partition manager. Returns the buffer fill
     * ratio in [0, 1] per ADR-018 (sync, O(1), allocation-free): the rows
     * buffered plus the rows in flight, over `bufferCeilingRows`. It reads
     * 1 exactly when the next write would be shed. Exact, because the
     * engine sees every flush start and settle.
     *
     * Rows inside unsettled flush copies count as pressure: a hung flush
     * is undelivered data, and hiding it is what let shutdown report
     * clean over it. They leave the tally when their flush settles —
     * delivered or reported lost.
     *
     * @returns {number} Pressure value in [0, 1]
     */
    const getPressure = function () {
        return Math.min( 1, ( bufferedRows + inFlightRows ) / bufferCeilingRows );
    }; // getPressure()

    /**
     * Health snapshot for operator monitoring (uniform across sinks).
     * Returns the ADR-018 health floor `{status, connected, pressure}`,
     * plus the adapter's own diagnostic counters.
     *
     * Status derivation (kept in code, not config — operator mental model is
     * load-bearing institutional knowledge):
     * - `red`    if `!connected` (shutting down or sustained write failure)
     *            or `pressure >= HEALTH_PRESSURE_RED_THRESHOLD` (at capacity)
     * - `yellow` if `pressure >= HEALTH_PRESSURE_YELLOW_THRESHOLD` OR
     *               `consecutiveWriteErrors >= HEALTH_ERROR_YELLOW_THRESHOLD`
     * - `green`  otherwise
     *
     * `connected` here is *derived* — QuestDB's ILP sender is fire-and-forget
     * with no observable socket state, so we infer transport health from
     * recent write success.
     *
     * @returns {{status: 'green'|'yellow'|'red', connected: boolean, pressure: number, consecutiveWriteErrors: number, bufferedRows: number, inFlightRows: number}}
     */
    const getHealth = function () {
        const pressure = getPressure();
        const connected = !shuttingDown && ( consecutiveWriteErrors < HEALTH_ERROR_RED_THRESHOLD );

        let status;
        if ( !connected || ( pressure >= HEALTH_PRESSURE_RED_THRESHOLD ) ) {
            status = 'red';
        } else if ( ( pressure >= HEALTH_PRESSURE_YELLOW_THRESHOLD ) || ( consecutiveWriteErrors >= HEALTH_ERROR_YELLOW_THRESHOLD ) ) {
            status = 'yellow';
        } else {
            status = 'green';
        }

        return {
            // Required health floor (ADR-018)
            status,
            connected,
            pressure,
            // Adapter-specific diagnostics
            consecutiveWriteErrors,
            bufferedRows,
            inFlightRows
        };
    }; // getHealth()

    /**
     * Best-effort transport close on the lossy path: the loss report
     * (the classified throw that follows) matters more than a close
     * failure, which is only logged.
     */
    const closeQuietly = function () {
        return sender.close().catch( function ( closeErr ) {
            logger.error( `winkComposer/questdb: transport close failed during lossy shutdown: ${closeErr.message}` );
        } );
    }; // closeQuietly()

    /**
     * The real shutdown body. `shutdown` below latches its promise so
     * every caller — including re-entrant and post-failure callers —
     * receives this one outcome.
     *
     * A clean resolve is a delivery statement (ADR-018): everything
     * buffered OR in flight was delivered. Shutdown therefore settles
     * every unsettled flush (engine, recovery, explicit) plus one final
     * flush for whatever is still buffered, all raced against the
     * caller's `{ timeout }` (ADR-018 drain-then-close). It never fires
     * a blind flush at a buffer an earlier copy-out emptied — that is
     * what let it report clean over a hung flush.
     *
     * On loss it rejects classified, `dropped: { count }` exact:
     * - any awaited flush fails → `DELIVERY_FAILED`, first flush error
     *   on `cause`, count = rows on the flushes that failed;
     * - the combined wait does not settle in time → `SHUTDOWN_TIMEOUT`,
     *   count = rows not confirmed delivered. A send against an
     *   unreachable server may never settle (see the client facts in
     *   the file header), so the bound is what keeps shutdown finite.
     * `dropped` is a statement about THIS session: those rows were not
     * confirmed delivered before close. An abandoned flush keeps
     * retrying and may still land its rows later if the server
     * recovers — the count is a floor on uncertainty, not a proof of
     * loss.
     *
     * The transport close is attempted in both loss paths, but on the
     * HTTP transport the client's `close()` is an empty function
     * (verified against @questdb/nodejs-client 4.2.0), so nothing can
     * abort an abandoned flush's retry timers from here; they keep the
     * event loop alive. Process exit is the final backstop — in a flow,
     * the shutdown manager's `SHUTDOWN_FORCE_TIMEOUT_MS` exit covers
     * this. No timeout supplied = no enforcement (unbounded await),
     * preserving direct-caller behavior.
     */
    const doShutdown = async function ( timeout ) {
        // Flip the health flag first so any concurrent getHealth() call
        // immediately sees the shutdown and returns red/disconnected —
        // and write() starts refusing new rows (SHUTTING_DOWN).
        shuttingDown = true;

        // Stop the flush timer: the final flush below is the last one.
        clearInterval( flushTimer );

        // Everything delivery still owes: flushes already in flight
        // (their rows left the buffer at their call) plus one final
        // flush for whatever is still buffered. Each wait records its
        // outcome into the tallies below. The mapped promises never
        // reject, so the only rejection the race can surface is the
        // timeout itself.
        let totalRows = 0;
        let deliveredRows = 0;
        let failedRows = 0;
        let firstFailure = null;
        const waits = [];

        const awaitDelivery = function ( entry ) {
            totalRows += entry.rows;
            waits.push( entry.promise.then(
                function () {
                    deliveredRows += entry.rows;
                },
                function ( err ) {
                    failedRows += entry.rows;
                    if ( !firstFailure ) {
                        firstFailure = err;
                    }
                }
            ) );
        }; // awaitDelivery()

        inFlightFlushes.forEach( awaitDelivery );
        if ( bufferedRows > 0 ) {
            const entry = trackFlush( sender.flush(), bufferedRows );
            bufferedRows = 0;
            awaitDelivery( entry );
        }

        if ( waits.length > 0 ) {
            try {
                await raceFlushTimeout( Promise.all( waits ), timeout );
            } catch ( err ) {
                await closeQuietly();
                const dropped = totalRows - deliveredRows;
                const timedOut = new Error(
                    `winkComposer/questdb: ${err.message}; ${dropped} buffered row(s) dropped`
                );
                timedOut.code = 'SHUTDOWN_TIMEOUT';
                timedOut.dropped = { count: dropped };
                throw timedOut;
            }

            if ( failedRows > 0 ) {
                await closeQuietly();
                const failure = new Error(
                    `winkComposer/questdb: flush failed during shutdown: ${firstFailure.message}; ${failedRows} buffered row(s) dropped`
                );
                failure.code = 'DELIVERY_FAILED';
                failure.dropped = { count: failedRows };
                failure.cause = firstFailure;
                throw failure;
            }
        }

        // Close sender
        await sender.close();
    }; // doShutdown()

    /**
     * Shutdown the storage adapter gracefully.
     * Flushes pending data and closes connections.
     *
     * Called by wire-storages.shutdown() which is invoked during:
     * - Pipeline shutdown (flowHandle.shutdown())
     * - Process signal handlers (SIGINT, SIGTERM)
     *
     * The outcome is latched: the first call runs the shutdown, every
     * later call returns the same promise. A lossy shutdown's failed
     * flush already emptied the buffer (copy-out), so a re-run would
     * find nothing to flush and resolve clean, contradicting the
     * recorded loss. One consequence: the first caller's `{ timeout }`
     * governs; a later caller's is ignored.
     *
     * @param {{timeout?: number}} [options]
     * @returns {Promise<void>}
     */
    const shutdown = function ( { timeout = 0 } = {} ) {
        if ( !shutdownPromise ) {
            shutdownPromise = doShutdown( timeout );
        }
        return shutdownPromise;
    }; // shutdown()

    return { write, flush, shutdown, getPressure, getHealth };
}; // createFlushEngine()

// ============================================================================
// EXPORTS
// ============================================================================

export { createFlushEngine };

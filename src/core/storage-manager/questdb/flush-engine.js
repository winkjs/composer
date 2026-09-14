// core/storage-manager/questdb/flush-engine.js

/**
 * @fileoverview The flush engine of the QuestDB adapter (ADR-029). It
 * owns the hot path (`write`), every flush, the counters behind
 * pressure and health, and the drain at shutdown. The factory in
 * `index.js` builds the connected sender and the persist plans, then
 * hands them to `createFlushEngine`, which returns the handle methods.
 *
 * Three modules carry the engine's hardest concerns, so this file
 * stays the handle and nothing else. `flush-tracker.js` is the ledger
 * of flushes in flight: exact in-flight counts and the deadline that
 * abandons a flush that never settles. `delivery-gate.js` is hold and
 * probe: it pauses delivery while the endpoint is unreachable and
 * resumes it when a probe passes. `shutdown-drain.js` is the
 * drain-then-close shutdown with its exact dropped count. Each carries
 * its own header; this one says how the engine uses them.
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
 * `bufferedRows` counts rows waiting for the next flush, and the
 * ledger's `inFlightRows` counts rows inside flushes that have not
 * settled. Every flush start and settle passes through the tracker, so
 * both numbers are exact, not estimates. A failed flush has lost its
 * rows, because the copy is gone with it. The engine reports that loss
 * once per flush: to `onDeliveryFailure` when the caller gave one, as
 * `( err, { trigger, rowsLost, abandoned, probe } )`, otherwise as one
 * classified `DELIVERY_FAILED` console line ending with the probe
 * finding when a probe ran. The process keeps running either way. An
 * unattended deployment must report a lost batch, not stop on it.
 *
 * The lines are bounded during a streak. A server that answers an
 * error for hours never pauses delivery, because the probe passes, so
 * a flush fails every interval. The first two reported losses of an
 * episode print in full. After that the losses are counted, and one
 * summary line prints per minute of streak with the counts. An
 * episode ends at a landing. An explicit `flush()` that fails rejects
 * to its caller and spends none of the lines. The handler still hears
 * every loss.
 *
 * One count is off by one row per rare event. When the client refuses
 * an append at its byte ceiling, its promise rejects after the plan
 * has returned, so the row was already counted as buffered. The next
 * flush then carries one row fewer than the count says. The drift is
 * one row per such event, and it resets when that flush settles.
 *
 * What a failure sets in motion. A failed or abandoned engine flush
 * goes to the gate. The gate runs the ADR-030 probe once, holds the
 * single-flight guard until the probe answers, and pauses delivery
 * when the probe fails. While paused, `write()` and the timer start no
 * flush, rows collect up to the ceiling, and each tick asks the gate to
 * probe again. When the gate resumes, the engine sends everything held
 * in one flush. Two flushes own their own errors and never reach the
 * gate: an explicit `flush()` rejects to its caller, and a flush that
 * fails during the drain is reported by shutdown alone.
 *
 * The ceiling (ADR-018 §12). Once the rows buffered plus the rows in
 * flight reach `bufferCeilingRows`, `write()` refuses new rows with
 * `STORAGE_FULL`. The refusal is one shared object, so shedding costs
 * no allocation. A shed row is a capacity refusal, not a sender error,
 * and does not touch the error counter. Health reads red at the
 * ceiling. With hold and probe, the ceiling is the outage the adapter
 * rides through without loss. A shedding episode prints two lines and
 * no more: one at the first refusal, one when the interval tick finds
 * room again, with the count refused. The ended line can lag the
 * first free slot by one interval; that keeps the accept branch free
 * of the check.
 *
 * Health (ADR-018 §8). `connected` is derived, because the ILP client
 * exposes no socket state. It is false while shutting down, while
 * delivery is paused, after five consecutive write errors, or when
 * delivery reads red. Delivery reads red after two failed flushes in
 * a row, or after one abandoned flush. `status` is `red` when not
 * connected or at capacity (`pressure >= 1`). It is `yellow` when
 * `pressure >= 0.66`, when a write error is outstanding, or when one
 * flush has failed. Otherwise it is `green`. One successful write
 * clears the write error count, and one delivered flush clears the
 * flush failure count. The health object also carries
 * `abandonedFlushes`, `pausedSince`, `consecutiveFlushFailures`,
 * `lastFlushAt`, and `lastFlushError` (`{ message, abandoned, at }`,
 * kept after recovery so the last failure stays readable). The ladder
 * itself is `deliveryStateOf` in `flush-tracker.js`, which also prints
 * one line at every change of it, so a log reader and a health reader
 * see the same state.
 *
 * Shutdown (ADR-018 drain-then-close). A clean resolve is a delivery
 * statement: everything buffered or in flight was delivered. The
 * engine stops the timer, refuses new rows, and hands the drain to
 * `shutdown-drain.js`, which settles every unsettled flush plus one
 * final flush and reports any loss with an exact `dropped` count. The
 * outcome is latched here, so repeated calls cannot contradict it.
 * Shutdown attempts the final flush even while delivery is paused,
 * because the endpoint may have returned since the last tick. A flush
 * that fails during the drain is reported by shutdown alone.
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
 * - The recovery flush runs only when completed rows are buffered. It
 *   carries real data and is tracked like every flush. If it fails, the
 *   loss is reported like any other:
 *   `onDeliveryFailure( err, { trigger: 'recovery', rowsLost, abandoned, probe } )`,
 *   or one `DELIVERY_FAILED` line.
 * - With nothing buffered, reset() alone clears the broken row. An empty
 *   flush sends nothing and resolves at once, so tracking it would stamp
 *   a success the endpoint never gave (the 2026-09-08 review found the
 *   ladder climbing to yellow on exactly that).
 * - While delivery is paused, a mid-row throw still runs this flush.
 *   The held rows go into the dead endpoint and are lost. The client
 *   offers no other way to clear the broken row. A row-cancel call
 *   would remove that loss; see the upstream issue below.
 * - The client (4.2.0) has no row-cancel API, while its sibling clients do
 *   (.NET CancelRow, Rust/C rewind_to_marker, Java recovers automatically).
 *   Upstream issue #60 tracks the gap:
 *   https://github.com/questdb/nodejs-questdb-client/issues/60
 *   When a release ships cancelRow(), recoverSender() becomes that one call.
 *
 * Long-running commitments (ADR-018 §12). One interval timer, created
 * at setup and cleared at shutdown; it does not hold the process open.
 * One deadline timer per flush, cleared when the flush settles, never
 * one per row. Every counter is bounded by the ceiling, except the
 * plain event counts (`abandonedFlushes`, write errors), which are
 * integers. The per-row path allocates nothing in this module; the
 * persist plan documents its own one derived promise per row. The
 * probe runs only after a failure or once per tick while paused, so a
 * healthy adapter never opens a probe socket. Reconnection and request
 * retries belong to the client. No listeners are attached.
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
 *   may never settle. The per-flush deadline is what bounds it here.
 *   Under that transport a refused connection shows up as an
 *   abandonment after the deadline, not as a fast rejection.
 *
 * The adapter's `index.js` header carries the full `err.code`
 * vocabulary, the defaults table, and the deprecated options.
 *
 * @see ADR-018
 * @see ADR-029
 */

import { logger } from '../../logger/index.js';
import { wrapCallback } from '../../utils/callback-guard/index.js';
import { createFlushTracker, deliveryStateOf } from './flush-tracker.js';
import { createDeliveryGate } from './delivery-gate.js';
import { createShutdownDrain } from './shutdown-drain.js';

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

/** The release for the recovery flush, which owns no single-flight guard. */
const NOOP = function () {
    // Intentionally empty.
}; // NOOP()

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

/**
 * Lost flushes of an episode that print in full when no handler is
 * given. They stand beside the degraded and red edge lines; after them
 * the losses are counted into summaries.
 */
const FULL_LOSS_LINES_PER_EPISODE = 2;

/**
 * How often a summary line prints while a streak of lost flushes goes
 * on with no handler. A server that answers an error for hours would
 * otherwise print one line per interval for the whole night.
 */
const FAILURE_SUMMARY_INTERVAL_MS = 60000;

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
 * @param {Object} parts.settings - Resolved settings (`flushRows`, `flushIntervalMs`, `bufferCeilingRows`, deadline inputs)
 * @param {function} [parts.onDeliveryFailure] - The caller's handler, already validated by the plan builder
 * @param {Object} parts.probe - The ADR-030 probe bound to `ilpUrl`: `{ run, describe }` (see `delivery-gate.js`)
 * @param {function} parts.closeTransport - `() => Promise<void>`: closes the sender and destroys the agent the factory owns
 * @returns {{write: function, flush: function, shutdown: function, getPressure: function, getHealth: function}}
 */
const createFlushEngine = function ( { sender, persistPlans, settings, onDeliveryFailure, probe, closeTransport } ) {
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
    // start moves this count into the ledger at once.
    let bufferedRows = 0;

    // One engine flush at a time (ADR-029). A send against an
    // unreachable server can hang; without this guard every timer tick
    // and every threshold crossing would start another stuck request.
    // While the guard is up, rows collect in the buffer up to the
    // ceiling, and the condition shows as rising pressure. Only the
    // row and timer triggers respect the guard. After a failure the
    // gate holds the guard until the probe has answered.
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

    // The shedding episode. It is up from the first row refused at the
    // ceiling until the tick finds room again. The count feeds the
    // "ended" line. The refusal branch raises it, and that branch runs
    // only while the adapter is already shedding. The tick lowers it.
    // So the accept branch never looks at it.
    let shedding = false;
    let shedRows = 0;

    // The loss lines during a streak with no handler. An episode is a
    // run of reported losses with no landing between them. The engine
    // counts its own reports per episode. The ledger's failure count
    // cannot serve, because it also counts explicit flush() failures,
    // which their caller owns and nothing reports here. Deciding the
    // line by that count let two owned failures push the first reported
    // loss straight into a summary, measured from a stamp no line had
    // set. A landing is detected by the ledger's last-landed stamp.
    let reportedInEpisode = 0;
    let landedAtLastReport = null;
    let summarySince = 0;
    let summaryFlushes = 0;
    let summaryRows = 0;

    // The ledger of flushes in flight (exact counts, deadlines) and the
    // gate that pauses delivery while the endpoint is unreachable. Both
    // read the engine's shutdown state through one small function. The
    // gate reports its pause and resume to the tracker through two
    // hooks, and neither calls back into the engine.
    const isShuttingDown = function () {
        return shuttingDown;
    }; // isShuttingDown()
    const { ledger, track, recordPause, recordResume } = createFlushTracker( settings, isShuttingDown );
    const gate = createDeliveryGate( {
        probe,
        heldRows: function () {
            return bufferedRows;
        },
        isShuttingDown,
        onPause: recordPause,
        onResume: recordResume
    } );

    // ------------------------------------------------------------------
    // Flushes
    // ------------------------------------------------------------------

    /**
     * Reports one lost flush. The rows are gone with the failed copy,
     * so this is a statement of loss, not a retry hint. The caller owns
     * the response when it asked to; otherwise one classified line,
     * ending with the probe finding when a probe ran. The process keeps
     * running either way (see the file header).
     *
     * @param {Error} err - The client's rejection, or the abandonment error
     * @param {string} trigger - 'rows', 'timer' or 'recovery'
     * @param {number} rows - Rows the flush carried
     * @param {boolean} abandoned - Whether the deadline, not the client, ended it
     * @param {{outcome: Object, finding: string}|null} probed - The probe result, or null when none ran
     */
    const reportFlushLoss = function ( err, trigger, rows, abandoned, probed ) {
        if ( safeOnDeliveryFailure ) {
            safeOnDeliveryFailure( err, {
                trigger, rowsLost: rows, abandoned, probe: ( probed === null ) ? null : probed.outcome
            } );
            return;
        }
        // The lines are bounded during a streak. A server that answers
        // an error for hours never pauses delivery, because the probe
        // passes, so a flush fails every interval. The first reported
        // losses of an episode print in full, beside the ladder's edge
        // lines. The rest are counted, and one summary line prints per
        // interval of streak. The restored edge line closes the episode
        // with its totals. The ledger already counts this loss, and
        // single flight means no other flush settles before this report.
        const finding = ( probed === null ) ? '' : `; probe: ${probed.finding}`;
        const now = Date.now();
        if ( ledger.lastFlushAt !== landedAtLastReport ) {
            // A flush landed since the last report: a new episode.
            landedAtLastReport = ledger.lastFlushAt;
            reportedInEpisode = 0;
        }
        reportedInEpisode += 1;
        if ( reportedInEpisode <= FULL_LOSS_LINES_PER_EPISODE ) {
            const line = abandoned ?
                err.message :
                `winkComposer/questdb: flush failed, ${rows} row(s) lost [DELIVERY_FAILED]: ${err.message}`;
            logger.error( `${line}${finding}` );
            summarySince = now;
            summaryFlushes = 0;
            summaryRows = 0;
            return;
        }
        summaryFlushes += 1;
        summaryRows += rows;
        if ( ( now - summarySince ) < FAILURE_SUMMARY_INTERVAL_MS ) {
            return;
        }
        const seconds = Math.round( ( now - summarySince ) / 1000 );
        logger.error(
            `winkComposer/questdb: delivery still failing, ${summaryFlushes} flush(es) and ${summaryRows} row(s) ` +
            `lost in the last ${seconds} s [DELIVERY_FAILED]: ${err.message}${finding}`
        );
        summarySince = now;
        summaryFlushes = 0;
        summaryRows = 0;
    }; // reportFlushLoss()

    /** Lowers the single-flight guard. */
    const releaseFlight = function () {
        flushInFlight = false;
    }; // releaseFlight()

    /**
     * Hands a failed or abandoned engine flush to the gate, which
     * probes, reports through `reportFlushLoss`, and releases the guard
     * when the engine may flush again. One closure per failed flush;
     * the failure path is not the hot path.
     *
     * @param {Error} err - The client's rejection, or the abandonment error
     * @param {string} trigger - 'rows', 'timer' or 'recovery'
     * @param {number} rows - Rows the flush carried
     * @param {boolean} abandoned - Whether the deadline ended it
     * @param {function} release - `releaseFlight` for an engine flush, `NOOP` for the recovery flush
     */
    const handleFlushFailure = function ( err, trigger, rows, abandoned, release ) {
        gate.afterFailure( function ( probed ) {
            reportFlushLoss( err, trigger, rows, abandoned, probed );
        }, release );
    }; // handleFlushFailure()

    /**
     * Starts one engine flush for everything buffered. The caller has
     * checked the guard, the gate, and that the buffer is not empty.
     * The client's flush() is async, so it never throws here (a 4.2.0
     * fact recorded in the header); its outcome arrives through the
     * tracker.
     *
     * @param {string} trigger - 'rows' or 'timer', for the loss report
     */
    const startFlush = function ( trigger ) {
        flushInFlight = true;
        const rows = bufferedRows;
        bufferedRows = 0;
        track( sender.flush(), rows, function ( err, abandoned ) {
            if ( err ) {
                handleFlushFailure( err, trigger, rows, abandoned, releaseFlight );
                return;
            }
            releaseFlight();
        } );
    }; // startFlush()

    /**
     * After a tick probe: when the gate resumed delivery, one flush
     * carries everything held. The guard may still belong to an engine
     * flush from before the pause; then that flush's settle lets the
     * next tick carry the held rows.
     *
     * @param {boolean} resumed - Whether this tick resumed delivery
     */
    const startAfterResume = function ( resumed ) {
        if ( resumed && ( bufferedRows > 0 ) && !flushInFlight ) {
            startFlush( 'timer' );
        }
    }; // startAfterResume()

    /**
     * The timer tick: flush whatever is buffered, unless a flush is
     * already in flight or delivery is paused. While paused, the gate
     * probes instead. Synchronous and O(1) on the flush path; nothing
     * here can throw.
     */
    const checkFlush = function () {
        if ( shedding && ( ( bufferedRows + ledger.inFlightRows ) < bufferCeilingRows ) ) {
            shedding = false;
            logger.warn( `winkComposer/questdb: shedding ended, ${shedRows} row(s) refused [STORAGE_FULL]: the buffer has room again` );
        }
        if ( gate.isPaused() ) {
            gate.tick().then( startAfterResume );
            return;
        }
        if ( flushInFlight || ( bufferedRows === 0 ) ) {
            return;
        }
        startFlush( 'timer' );
    }; // checkFlush()

    // The one interval timer (ADR-018 §12): created here, cleared at
    // shutdown. It does not hold the process open. The client's own
    // interval trigger would not have served. It checks elapsed time
    // only when a new row arrives. A stream that stops would leave its
    // last rows in the buffer for good.
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
     * When completed rows are buffered, flush() copies them out of the
     * buffer synchronously and sends them in the background; the
     * unfinished row stays behind. reset() then clears the buffer — only
     * the broken stub remains at that point — and lowers the client's
     * row-in-progress flags. Net effect: the broken row vanishes, every
     * good row is on its way, the sender accepts the next write.
     *
     * When nothing is buffered, reset() alone is the recovery. A flush of
     * an empty buffer sends nothing and resolves at once (the client
     * returns false), so tracking it would record a delivery that never
     * happened: the ledger would read a fresh success while the endpoint
     * is still dead, and health would climb the ladder on no evidence.
     *
     * The early flush carries real data. If its send fails, that loss is
     * reported like any other (see `handleFlushFailure`). Never silent.
     */
    const recoverSender = function () {
        try {
            const rows = bufferedRows;
            if ( rows > 0 ) {
                // flush() is an async function: it can never throw
                // synchronously, and the rows it sends live in its own copy
                // of the buffer. Tracked like every flush, so shutdown
                // settles it and its rows stay visible as pressure until it
                // settles. It does not own the single-flight guard, so its
                // failure releases nothing.
                track( sender.flush(), rows, function ( err, abandoned ) {
                    if ( err ) {
                        handleFlushFailure( err, 'recovery', rows, abandoned, NOOP );
                    }
                } );
            }
            sender.reset();
            bufferedRows = 0;
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
     * flush before this returns, unless one is already in flight or
     * delivery is paused. The flush is not awaited.
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
        if ( ( bufferedRows + ledger.inFlightRows ) >= bufferCeilingRows ) {
            // The first refusal of an episode prints once; the rest
            // only count. This branch runs only while shedding, so the
            // check costs the accept path nothing.
            if ( !shedding ) {
                shedding = true;
                shedRows = 0;
                logger.warn(
                    `winkComposer/questdb: shedding began at the ceiling of ${bufferCeilingRows} rows [STORAGE_FULL]: new rows are refused until the endpoint takes them`
                );
            }
            shedRows += 1;
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
                // The gate is asked only on the threshold crossing, once
                // per batch, never per row.
                if ( ( bufferedRows >= flushRows ) && !flushInFlight && !gate.isPaused() ) {
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
     * starts a flush even while an engine flush is in flight or delivery
     * is paused. The rows move to the in-flight tally at the call
     * (copy-out). The promise resolves when the server confirmed the
     * rows, and rejects when the client failed or the deadline passed.
     * The caller owns that error; nothing is reported elsewhere. Nothing
     * buffered: resolves at once.
     *
     * @returns {Promise<void>}
     */
    const flush = function () {
        if ( bufferedRows === 0 ) {
            return Promise.resolve();
        }
        const rows = bufferedRows;
        bufferedRows = 0;
        return new Promise( function ( resolve, reject ) {
            track( sender.flush(), rows, function ( err ) {
                if ( err ) {
                    reject( err );
                    return;
                }
                resolve();
            } );
        } );
    }; // flush()

    /**
     * Backpressure metric for the partition manager. Returns the buffer fill
     * ratio in [0, 1] per ADR-018 (sync, O(1), allocation-free): the rows
     * buffered plus the rows in flight, over `bufferCeilingRows`. It reads
     * 1 exactly when the next write would be shed. Exact, because the
     * tracker sees every flush start and settle.
     *
     * Rows inside unsettled flush copies count as pressure: a hung flush
     * is undelivered data, and hiding it is what let shutdown report
     * clean over it. They leave the tally when their flush settles —
     * delivered, reported lost, or abandoned.
     *
     * @returns {number} Pressure value in [0, 1]
     */
    const getPressure = function () {
        return Math.min( 1, ( bufferedRows + ledger.inFlightRows ) / bufferCeilingRows );
    }; // getPressure()

    /**
     * Health snapshot for operator monitoring (uniform across sinks).
     * Returns the ADR-018 health floor `{status, connected, pressure}`,
     * plus the adapter's own diagnostic counters.
     *
     * Status derivation (kept in code, not config — operator mental model is
     * load-bearing institutional knowledge):
     * - `red`    if `!connected` (shutting down, delivery paused,
     *            sustained write failure, or delivery red: two failed
     *            flushes in a row, or one abandoned flush)
     *            or `pressure >= HEALTH_PRESSURE_RED_THRESHOLD` (at capacity)
     * - `yellow` if `pressure >= HEALTH_PRESSURE_YELLOW_THRESHOLD` OR
     *               `consecutiveWriteErrors >= HEALTH_ERROR_YELLOW_THRESHOLD` OR
     *               one flush has failed since the last delivered one
     * - `green`  otherwise
     *
     * `connected` here is *derived* — QuestDB's ILP sender is fire-and-forget
     * with no observable socket state, so we infer transport health from
     * recent write success, from the ledger's flush outcomes, and from
     * the probe that paused delivery.
     *
     * @returns {{status: 'green'|'yellow'|'red', connected: boolean, pressure: number, consecutiveWriteErrors: number, bufferedRows: number, inFlightRows: number, abandonedFlushes: number, pausedSince: number|null, consecutiveFlushFailures: number, lastFlushAt: number|null, lastFlushError: {message: string, abandoned: boolean, at: number}|null}}
     */
    const getHealth = function () {
        const pressure = getPressure();
        // The ladder comes from the tracker's one function, the same
        // one that prints the edge lines, so the two never disagree.
        const delivery = deliveryStateOf( ledger );
        // A paused delivery reads red through the ladder: the ledger
        // carries the gate's pause instant.
        const connected = !shuttingDown &&
            ( consecutiveWriteErrors < HEALTH_ERROR_RED_THRESHOLD ) && ( delivery !== 'red' );

        let status;
        if ( !connected || ( pressure >= HEALTH_PRESSURE_RED_THRESHOLD ) ) {
            status = 'red';
        } else if ( ( pressure >= HEALTH_PRESSURE_YELLOW_THRESHOLD ) ||
            ( consecutiveWriteErrors >= HEALTH_ERROR_YELLOW_THRESHOLD ) ||
            ( delivery === 'yellow' ) ) {
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
            inFlightRows: ledger.inFlightRows,
            abandonedFlushes: ledger.abandonedFlushes,
            pausedSince: ledger.pausedSince,
            consecutiveFlushFailures: ledger.consecutiveFlushFailures,
            lastFlushAt: ledger.lastFlushAt,
            lastFlushError: ledger.lastFlushError
        };
    }; // getHealth()

    // The drain (see `shutdown-drain.js`). It takes the buffered count
    // through a function. So the copy-out and the zeroing happen in the
    // same breath, the way every flush start does here. The transport
    // close is the factory's, because the factory owns the agent.
    const drain = createShutdownDrain( {
        sender,
        ledger,
        track,
        takeBufferedRows: function () {
            const rows = bufferedRows;
            bufferedRows = 0;
            return rows;
        },
        closeTransport
    } );

    /**
     * Shutdown the storage adapter gracefully: drain, then close
     * (ADR-018). Called by wire-storages.shutdown() during pipeline
     * shutdown and from the process signal handlers.
     *
     * The outcome is latched: the first call runs the drain, every
     * later call returns the same promise. A lossy shutdown's failed
     * flush already emptied the buffer (copy-out), so a re-run would
     * find nothing to flush and resolve clean, contradicting the
     * recorded loss. One consequence: the first caller's `{ timeout }`
     * governs; a later caller's is ignored.
     *
     * @param {{timeout?: number}} [options]
     * @returns {Promise<void>} Resolves clean, or rejects DELIVERY_FAILED or SHUTDOWN_TIMEOUT
     */
    const shutdown = function ( { timeout = 0 } = {} ) {
        if ( !shutdownPromise ) {
            // Flip the flag first, so a concurrent getHealth() reads
            // red and write() refuses new rows (SHUTTING_DOWN). Then stop
            // the timer: the drain's final flush is the last one.
            shuttingDown = true;
            clearInterval( flushTimer );
            shutdownPromise = drain( timeout );
        }
        return shutdownPromise;
    }; // shutdown()

    return { write, flush, shutdown, getPressure, getHealth };
}; // createFlushEngine()

// ============================================================================
// EXPORTS
// ============================================================================

export { createFlushEngine };

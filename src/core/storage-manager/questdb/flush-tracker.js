// core/storage-manager/questdb/flush-tracker.js

/**
 * @fileoverview The ledger of QuestDB flushes in flight, and the
 * deadline on each one (ADR-029).
 *
 * The client copies the rows out of its buffer the moment a flush
 * starts, before any network work. From that moment the rows are
 * neither in the buffer nor confirmed. This module counts them. Every
 * flush the adapter starts passes through `track`, so `inFlightRows`
 * is exact: rows inside flushes that have not settled. The engine adds
 * it to the buffered count for pressure, and the shutdown drain walks
 * `entries` to settle every flush it owes.
 *
 * Why a deadline. A send against an unreachable server can retry
 * without end (the client's undici transport, a 4.2.0 fact recorded
 * in `flush-engine.js`), so a flush promise may never settle. Each
 * tracked flush therefore gets one timer. The deadline comes from
 * `flushDeadlineFor`: the client's own bound for a batch of that many
 * rows plus a margin, or the fixed `flushDeadlineMs` when the operator
 * set one. A flush past its deadline is abandoned. Its rows leave the
 * count, `abandonedFlushes` goes up by one, and the owner is told with
 * `abandoned: true`. The rows are reported lost. They may still land
 * if the server recovers, so that count is a floor on uncertainty, not
 * a proof of loss.
 *
 * Settles exactly once. An entry settles when the client's promise
 * resolves, when it rejects, or when the deadline fires, whichever
 * comes first. The `settled` flag makes every later event inert: a
 * late result from an abandoned flush moves no counter and calls no
 * handler. The deadline timer is cleared when the flush settles in
 * time, so a healthy adapter carries one live timer per flush in
 * flight and none per row.
 *
 * The owner's handler. `track( flushPromise, rows, onDone )` calls
 * `onDone( err, abandoned )` once: `err` is null when delivered, the
 * client's rejection when it failed, or the abandonment error when the
 * deadline passed. Loss reporting stays with the owner: the engine
 * reports through its failure handler, an explicit `flush()` rejects to
 * its caller, and the shutdown drain tallies. The drain wraps
 * `entry.onDone` to add its tally, so the field is read at settle time,
 * not captured at track time.
 *
 * Outcomes for health. Every settle also records its outcome, so
 * health can read delivery and not only buffering. A delivered flush
 * zeroes `consecutiveFlushFailures` and stamps `lastFlushAt`. A failed
 * or abandoned flush adds one to the count and replaces
 * `lastFlushError` with `{ message, abandoned, at }`. The last error is
 * never cleared: the count says whether it is current, and the message
 * stays readable after recovery. `deliveryStateOf` turns these into
 * the health ladder (yellow on the first failure, red on the second or
 * on an abandonment, green on the next delivered flush). The engine's
 * `getHealth()` reads that one function too.
 *
 * The pause is red as well. The delivery gate tells the ledger when it
 * pauses and resumes delivery, and the ledger mirrors the pause instant
 * in `pausedSince`. The ladder reads red while it is set, whatever the
 * failure count says, because the gate holds new rows until a probe
 * passes. While the gate runs, only its resume clears the mirror. An
 * explicit or recovery flush can land during a pause, and the ladder
 * stays red then. At shutdown the gate is out of the loop, so a
 * landing clears the mirror and the restored line prints beside the
 * clean stop.
 *
 * Edges print once. Every step up the ladder, and every return to
 * green, prints one line through the logger facade, with or without
 * an `onDeliveryFailure` handler, because the callback serves programs
 * and a line serves people. Entering yellow prints at warn, entering
 * red at error, and returning to green at warn with the episode length
 * and the rows reported lost in it. The red line names its cause: the
 * count of failed flushes, or the pause after that count. It prints at
 * the pause, before the gate's own `CIRCUIT_OPEN` line, and a later
 * failed flush adds no second red line. A resume that steps down to
 * yellow prints nothing. The restored line comes when the catch-up
 * flush lands. A resume that lands on green, because a flush landed
 * during the pause, prints the restored line after the gate's resumed
 * line. Nothing prints while a state persists, however long an outage
 * lasts. The token is
 * `DELIVERY_HEALTH` (a console token, like `CIRCUIT_OPEN`, not an
 * `err.code`).
 *
 * Nothing here runs on the per-row path. One entry object, one timer,
 * and two closures per flush; a flush carries thousands of rows by
 * default. The error record and the edge lines allocate only on the
 * failure path, once per flush at most.
 *
 * @see ADR-029
 */

import { logger } from '../../logger/index.js';
import { flushDeadlineFor } from './resolve-options.js';

/**
 * Consecutive failed flushes that read as red delivery. One failure is
 * yellow, because the client's own retries make a single failure
 * worth a look but not an alarm. Two in a row mean the server keeps
 * refusing. An abandoned flush reads red on its own, because a
 * deadline is already the client's full retry budget plus a margin.
 */
const HEALTH_FLUSH_FAILURE_RED_THRESHOLD = 2;

/**
 * The delivery state the ledger's outcome fields spell: the ladder.
 * One function for both readers, the edge detector in this module and
 * the engine's `getHealth()`, so a line and a health read never
 * disagree.
 *
 * @param {{consecutiveFlushFailures: number, lastFlushError: {abandoned: boolean}|null, pausedSince?: number|null}} ledger - The outcome fields
 * @returns {'green'|'yellow'|'red'} The delivery state
 */
const deliveryStateOf = function ( ledger ) {
    // A paused delivery is red whatever the count says: nothing lands
    // until a probe passes (ADR-029 hold and probe). Health objects
    // carry the same field, so a health read spells the same state.
    const paused = ( ledger.pausedSince !== undefined ) && ( ledger.pausedSince !== null );
    if ( paused ) {
        return 'red';
    }
    const failures = ledger.consecutiveFlushFailures;
    if ( failures === 0 ) {
        return 'green';
    }
    if ( ( failures >= HEALTH_FLUSH_FAILURE_RED_THRESHOLD ) || ledger.lastFlushError.abandoned ) {
        return 'red';
    }
    return 'yellow';
}; // deliveryStateOf()

/**
 * The error an abandoned flush carries: to the caller of an explicit
 * `flush()`, to `onDeliveryFailure`, and as `cause` on a lossy shutdown.
 *
 * @param {number} rows - Rows the flush carried
 * @param {number} deadlineMs - The deadline that passed
 * @returns {Error} Classified DELIVERY_FAILED
 */
const abandonmentError = function ( rows, deadlineMs ) {
    const err = new Error(
        `winkComposer/questdb: flush abandoned, ${rows} row(s) lost [DELIVERY_FAILED]: no answer within ${deadlineMs} ms`
    );
    err.code = 'DELIVERY_FAILED';
    return err;
}; // abandonmentError()

/**
 * Builds the ledger. The engine reads `ledger.inFlightRows` on the
 * write path and the outcome fields in health; the drain walks
 * `ledger.entries`. Only `track` writes to them.
 *
 * @param {Object} settings - Resolved settings; the deadline inputs (`flushDeadlineMs`, `retryTimeout`)
 * @param {function} isShuttingDown - `() => boolean`, the engine's shutdown flag; a landing clears the pause mirror only then
 * @returns {{ledger: {inFlightRows: number, abandonedFlushes: number, consecutiveFlushFailures: number, lastFlushAt: number|null, lastFlushError: {message: string, abandoned: boolean, at: number}|null, entries: Set}, track: function}}
 */
const createFlushTracker = function ( settings, isShuttingDown ) {
    const ledger = {
        inFlightRows: 0,
        abandonedFlushes: 0,
        consecutiveFlushFailures: 0,
        lastFlushAt: null,
        lastFlushError: null,
        // The gate's pause instant, mirrored here so the ladder sees it.
        pausedSince: null,
        entries: new Set()
    };

    // The episode behind the restored line: when delivery left green,
    // and the rows reported lost since. Both reset when green returns.
    let episodeStartedAt = null;
    let episodeRowsLost = 0;

    /**
     * Prints the one line an edge of the ladder earns. The restored
     * line names the episode. The other two carry the failure's own
     * message, so an abandonment reads as a chain in the ADR-028 grammar.
     *
     * @param {'green'|'yellow'|'red'} after - The state just entered
     * @param {Error|null} err - The failure that caused the edge, null on restore
     * @param {number} now - The settle time
     */
    const printEdge = function ( after, err, now ) {
        if ( after === 'yellow' ) {
            logger.warn( `winkComposer/questdb: delivery degraded, 1 flush failed [DELIVERY_HEALTH]: ${err.message}` );
            return;
        }
        if ( after === 'red' ) {
            // Red by the count, or red because the gate paused delivery
            // after the failures so far.
            const cause = ( ledger.pausedSince === null ) ?
                ` after ${ledger.consecutiveFlushFailures} failed flush(es)` :
                `, paused after ${ledger.consecutiveFlushFailures} failed flush(es)`;
            logger.error( `winkComposer/questdb: delivery red${cause} [DELIVERY_HEALTH]: ${err.message}` );
            return;
        }
        const seconds = Math.round( ( now - episodeStartedAt ) / 1000 );
        logger.warn(
            `winkComposer/questdb: delivery restored after ${seconds} s, ${episodeRowsLost} row(s) reported lost meanwhile [DELIVERY_HEALTH]`
        );
    }; // printEdge()

    /**
     * Steps the ladder from `before` to the state the ledger reads now,
     * and prints the edge line when the two differ. Every edge site
     * calls it: a settled flush, the gate's pause, the gate's resume.
     * The episode starts on leaving green and ends on returning to it.
     *
     * @param {'green'|'yellow'|'red'} before - The state before the change
     * @param {Error|null} err - The failure behind the edge, null on a landing or resume
     * @param {number} now - The instant of the change
     */
    const stepLadder = function ( before, err, now ) {
        const after = deliveryStateOf( ledger );
        if ( after === before ) {
            return;
        }
        if ( before === 'green' ) {
            episodeStartedAt = now;
        }
        printEdge( after, err, now );
        if ( after === 'green' ) {
            episodeStartedAt = null;
            episodeRowsLost = 0;
        }
    }; // stepLadder()

    /**
     * Records one settled flush for health and prints the edge line
     * when the ladder changed. Runs once per flush, never per row.
     *
     * @param {Error|null} err - Null when delivered
     * @param {boolean} abandoned - Whether the deadline ended it
     * @param {number} rows - Rows the flush carried
     */
    const recordOutcome = function ( err, abandoned, rows ) {
        const now = Date.now();
        const before = deliveryStateOf( ledger );
        if ( err === null ) {
            ledger.consecutiveFlushFailures = 0;
            ledger.lastFlushAt = now;
            // While the gate runs, it owns the mirror. An explicit or
            // recovery flush can land during a pause, and the ladder
            // stays red until the gate's probe passes. At shutdown the
            // gate is out of the loop, so a landing clears the mirror
            // and the restored line prints beside the clean stop.
            if ( isShuttingDown() ) {
                ledger.pausedSince = null;
            }
        } else {
            ledger.consecutiveFlushFailures += 1;
            ledger.lastFlushError = { message: err.message, abandoned, at: now };
            episodeRowsLost += rows;
        }
        stepLadder( before, err, now );
    }; // recordOutcome()

    /**
     * Records the gate's pause in the ledger and prints the red edge
     * when the pause is what turned the ladder red. A pause from green
     * happens when a flush landed between the failed flush and the
     * probe's result. The episode then starts at the pause.
     *
     * @param {number} pausedSince - The gate's pause instant
     * @param {string} finding - The probe's operator text
     */
    const recordPause = function ( pausedSince, finding ) {
        const before = deliveryStateOf( ledger );
        ledger.pausedSince = pausedSince;
        stepLadder( before, { message: finding }, pausedSince );
    }; // recordPause()

    /**
     * Records the gate's resume in the ledger. Red to yellow prints
     * nothing: one failure stays on the count until a flush lands, and
     * the restored line comes then. Red to green happens when a flush
     * landed during the pause, and the restored line prints here, after
     * the gate's resumed line.
     *
     * @param {number} now - The resume instant
     */
    const recordResume = function ( now ) {
        ledger.pausedSince = null;
        if ( deliveryStateOf( ledger ) === 'green' ) {
            stepLadder( 'red', null, now );
        }
    }; // recordResume()

    /**
     * Registers a flush the moment it is called and arms its deadline.
     *
     * @param {Promise} flushPromise - The just-fired `sender.flush()`
     * @param {number} rows - Rows the flush copy carries
     * @param {function} onDone - `( err|null, abandoned )`, called exactly once
     * @returns {{rows: number, onDone: function, settled: boolean, timer: Object}} The tracked entry
     */
    const track = function ( flushPromise, rows, onDone ) {
        const entry = { rows, onDone, settled: false, timer: null };
        ledger.inFlightRows += rows;
        ledger.entries.add( entry );

        const finish = function ( err, abandoned ) {
            if ( entry.settled ) {
                return;
            }
            entry.settled = true;
            clearTimeout( entry.timer );
            ledger.entries.delete( entry );
            ledger.inFlightRows -= rows;
            recordOutcome( err, abandoned, rows );
            entry.onDone( err, abandoned );
        };

        const deadlineMs = flushDeadlineFor( rows, settings );
        entry.timer = setTimeout( function () {
            ledger.abandonedFlushes += 1;
            finish( abandonmentError( rows, deadlineMs ), true );
        }, deadlineMs );
        entry.timer.unref();

        flushPromise.then(
            function () {
                finish( null, false );
            },
            function ( err ) {
                finish( err, false );
            }
        );
        return entry;
    }; // track()

    return { ledger, track, recordPause, recordResume };
}; // createFlushTracker()

export { createFlushTracker, deliveryStateOf };

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
 * Edges print once. Every change of the ladder prints one line through
 * the logger facade, with or without an `onDeliveryFailure` handler,
 * because the callback serves programs and a line serves people.
 * Entering yellow prints at warn, entering red at error, and returning
 * to green at warn with the episode length and the rows reported lost
 * in it. Nothing prints while a state persists, however long an outage
 * lasts. The token is `DELIVERY_HEALTH` (a console token, like
 * `CIRCUIT_OPEN`, not an `err.code`).
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
 * @param {{consecutiveFlushFailures: number, lastFlushError: {abandoned: boolean}|null}} ledger - The outcome fields
 * @returns {'green'|'yellow'|'red'} The delivery state
 */
const deliveryStateOf = function ( ledger ) {
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
 * @returns {{ledger: {inFlightRows: number, abandonedFlushes: number, consecutiveFlushFailures: number, lastFlushAt: number|null, lastFlushError: {message: string, abandoned: boolean, at: number}|null, entries: Set}, track: function}}
 */
const createFlushTracker = function ( settings ) {
    const ledger = {
        inFlightRows: 0,
        abandonedFlushes: 0,
        consecutiveFlushFailures: 0,
        lastFlushAt: null,
        lastFlushError: null,
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
            logger.error(
                `winkComposer/questdb: delivery red after ${ledger.consecutiveFlushFailures} failed flush(es) [DELIVERY_HEALTH]: ${err.message}`
            );
            return;
        }
        const seconds = Math.round( ( now - episodeStartedAt ) / 1000 );
        logger.warn(
            `winkComposer/questdb: delivery restored after ${seconds} s, ${episodeRowsLost} row(s) reported lost meanwhile [DELIVERY_HEALTH]`
        );
    }; // printEdge()

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
        } else {
            ledger.consecutiveFlushFailures += 1;
            ledger.lastFlushError = { message: err.message, abandoned, at: now };
            episodeRowsLost += rows;
        }
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
    }; // recordOutcome()

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

    return { ledger, track };
}; // createFlushTracker()

export { createFlushTracker, deliveryStateOf };

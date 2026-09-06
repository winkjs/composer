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
 * stays readable after recovery. The engine turns these into the
 * health ladder (yellow on the first failure, red on the second or on
 * an abandonment).
 *
 * Nothing here runs on the per-row path. One entry object, one timer,
 * and two closures per flush; a flush carries thousands of rows by
 * default. The error record allocates only on the failure path.
 *
 * @see ADR-029
 */

import { flushDeadlineFor } from './resolve-options.js';

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

    /**
     * Records one settled flush for health. Runs once per flush, never
     * per row.
     *
     * @param {Error|null} err - Null when delivered
     * @param {boolean} abandoned - Whether the deadline ended it
     */
    const recordOutcome = function ( err, abandoned ) {
        if ( err === null ) {
            ledger.consecutiveFlushFailures = 0;
            ledger.lastFlushAt = Date.now();
            return;
        }
        ledger.consecutiveFlushFailures += 1;
        ledger.lastFlushError = { message: err.message, abandoned, at: Date.now() };
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
            recordOutcome( err, abandoned );
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

export { createFlushTracker };

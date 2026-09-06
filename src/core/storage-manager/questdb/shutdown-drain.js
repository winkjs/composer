// core/storage-manager/questdb/shutdown-drain.js

/**
 * @fileoverview The drain-then-close shutdown of the QuestDB adapter
 * (ADR-018 §7, ADR-029).
 *
 * A clean shutdown resolve is a delivery statement: everything
 * buffered or in flight was delivered. The drain therefore settles
 * every flush still in the ledger (engine, recovery, explicit) plus one
 * final flush for whatever is still buffered. It never fires a blind
 * flush at a buffer an earlier copy-out emptied. That blind flush is
 * what once let shutdown report clean over a hung flush.
 *
 * The caller's `{ timeout }` bounds the whole drain. Without one, the
 * deadline on each flush (`flush-tracker.js`) bounds it instead, so a
 * shutdown with no budget still ends. On loss the drain rejects with a
 * classified error carrying `dropped: { count }`, exact:
 * - `DELIVERY_FAILED` when any awaited flush failed or was abandoned.
 *   The first error is on `cause`; the count is the rows on the
 *   flushes that failed.
 * - `SHUTDOWN_TIMEOUT` when the drain did not settle within the budget.
 *   The count is the rows not confirmed delivered.
 *
 * `dropped` is a statement about this session: those rows were not
 * confirmed delivered before close. An abandoned flush may still land
 * its rows if the server recovers, so the count is a floor on
 * uncertainty, not a proof of loss.
 *
 * How the tally works. Each entry in the ledger has an `onDone`
 * handler owned by whoever started the flush. The drain wraps that
 * handler: the owner's handler still runs, and the drain adds the
 * entry's rows to delivered or failed. The wrapped promises never
 * reject, so the only rejection the race can surface is the timeout.
 *
 * The transport close is attempted on both loss paths. On the HTTP
 * transport the client's `close()` is an empty function (a 4.2.0
 * fact), so nothing here can abort an abandoned flush's retries. In a
 * flow, the shutdown manager's forced exit is the final backstop. A
 * close failure on a loss path is logged, because the loss report
 * matters more than the close.
 *
 * @see ADR-018
 * @see ADR-029
 */

import { logger } from '../../logger/index.js';

/** The final flush has no owner of its own: the drain tallies it. */
const NOOP = function () {
    // Intentionally empty.
}; // NOOP()

/**
 * Races the drain against the caller's time budget. No budget (0 or
 * undefined) means no race. The timer is `unref`'d and cleared however
 * the race ends, so a finished drain leaves nothing behind. The losing
 * side is left as it is: the drain never rejects, and a cleared timer
 * never fires.
 *
 * @param {Promise} drain - The drain; it settles but never rejects
 * @param {number} timeoutMs - Budget in ms; 0 or absent disables the race
 * @returns {Promise} Settles with the drain, or rejects SHUTDOWN_TIMEOUT
 */
const raceTimeout = function ( drain, timeoutMs ) {
    if ( !( timeoutMs > 0 ) ) {
        return drain;
    }
    let timer = null;
    const timeout = new Promise( function ( resolve, reject ) {
        timer = setTimeout( function () {
            const err = new Error( `final flush did not settle within ${timeoutMs} ms` );
            err.code = 'SHUTDOWN_TIMEOUT';
            reject( err );
        }, timeoutMs );
        timer.unref();
    } );
    return Promise.race( [ drain, timeout ] ).finally( function () {
        clearTimeout( timer );
    } );
}; // raceTimeout()

/**
 * Builds the drain over the engine's sender and ledger.
 *
 * @param {Object} parts - What the drain runs on
 * @param {Object} parts.sender - The connected ILP sender
 * @param {{entries: Set}} parts.ledger - The tracker's ledger of flushes in flight
 * @param {function} parts.track - The tracker's `track`, for the final flush
 * @param {function} parts.takeBufferedRows - `() => number`: returns the buffered count and zeroes it
 * @returns {function} `drain( timeoutMs ) => Promise<void>`
 */
const createShutdownDrain = function ( { sender, ledger, track, takeBufferedRows } ) {

    /**
     * Best-effort transport close on the lossy path.
     *
     * @returns {Promise<void>} Resolves whether or not the close worked
     */
    const closeQuietly = function () {
        return sender.close().catch( function ( closeErr ) {
            logger.error( `winkComposer/questdb: transport close failed during lossy shutdown: ${closeErr.message}` );
        } );
    }; // closeQuietly()

    /**
     * Runs the drain once. The engine latches the returned promise so
     * every caller receives this one outcome.
     *
     * @param {number} timeoutMs - The caller's budget; 0 means none
     * @returns {Promise<void>} Resolves clean, or rejects classified
     */
    const drain = async function ( timeoutMs ) {
        let totalRows = 0;
        let deliveredRows = 0;
        let failedRows = 0;
        let firstFailure = null;
        const waits = [];

        const awaitDelivery = function ( entry ) {
            totalRows += entry.rows;
            const ownerDone = entry.onDone;
            waits.push( new Promise( function ( resolve ) {
                entry.onDone = function ( err, abandoned ) {
                    ownerDone( err, abandoned );
                    if ( err ) {
                        failedRows += entry.rows;
                        if ( !firstFailure ) {
                            firstFailure = err;
                        }
                    } else {
                        deliveredRows += entry.rows;
                    }
                    resolve();
                };
            } ) );
        }; // awaitDelivery()

        // Everything delivery still owes: flushes already in flight
        // (their rows left the buffer at their call) plus one final
        // flush for whatever is still buffered.
        ledger.entries.forEach( awaitDelivery );
        const buffered = takeBufferedRows();
        if ( buffered > 0 ) {
            awaitDelivery( track( sender.flush(), buffered, NOOP ) );
        }

        if ( waits.length > 0 ) {
            try {
                await raceTimeout( Promise.all( waits ), timeoutMs );
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

        await sender.close();
    }; // drain()

    return drain;
}; // createShutdownDrain()

export { createShutdownDrain };

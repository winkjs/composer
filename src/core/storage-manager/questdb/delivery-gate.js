// core/storage-manager/questdb/delivery-gate.js

/**
 * @fileoverview Hold and probe: the gate that pauses QuestDB delivery
 * while the endpoint is unreachable (ADR-029, amendment of 2026-09-05).
 *
 * Why it exists. Before this gate, a QuestDB restart of 30 seconds cost
 * every row written during it. Each interval tick started a flush into
 * the dead endpoint, each flush failed or hung, and each failure lost
 * its batch. The gate stops that. After a failed or abandoned engine
 * flush it runs the ADR-030 probe against `ilpUrl`: one TCP connect
 * per resolved address, off the hot path. A failing probe pauses
 * delivery. While paused, the engine starts no flush and rows collect
 * in the client's buffer up to the ceiling. Each interval tick runs one
 * probe. When a probe passes, delivery resumes and the engine sends
 * everything held in one flush. A restart then costs only the batch
 * that was on the wire when the port closed.
 *
 * What the probe finding is for. The loss report carries it, so an
 * operator reads which address refused and which answered, the same
 * text the setup probe prints. A passing probe after a failure changes
 * nothing: the server answered the request and refused it, so the
 * failure is reported and delivery goes on.
 *
 * The three cases after a failure:
 * - Shutdown is running. Shutdown owns the outcome and reports it in
 *   its own rejection, so the gate only releases the engine's guard.
 * - Delivery is paused, or a probe is already running. The loss is
 *   reported without a finding. The tick, or the running probe,
 *   decides what happens next.
 * - Otherwise the probe runs. The engine's guard stays up meanwhile,
 *   so no new engine flush starts into an endpoint that may be dead.
 *   When the probe answers, the guard is released, the loss is
 *   reported with the finding, and a failing probe pauses delivery.
 *   The release comes first. The report runs user-facing code, and a
 *   report that threw before the release would leave the guard up for
 *   good, with no flush able to start again.
 *
 * Console lines (ADR-028 grammar, token `CIRCUIT_OPEN` from ADR-018
 * §9). One `logger.warn` line on pause, with the held row count and
 * the finding. One `logger.warn` line on resume, with the pause
 * length and the held count. The resume line is warn, not info, so a
 * log transport that keeps only warn and above still carries the end
 * of the episode. Nothing per tick. A probe that itself
 * throws or rejects counts as a failed probe: the gate must not depend
 * on the probe's own robustness to decide whether to pause.
 *
 * The gate never calls back into the engine. `tick()` resolves to true
 * when it resumed delivery, and the engine starts the catch-up flush.
 * `isPaused()` feeds the engine's triggers. One probe runs at a time.
 *
 * The gate does tell the flush tracker's ledger about each pause and
 * resume, through `onPause` and `onResume`. The ledger's ladder, the one
 * function behind `getHealth()` and the edge lines, reads red while
 * delivery is paused. So the red edge prints at the pause, before the
 * `CIRCUIT_OPEN` line, and a later failed flush adds no second red line.
 *
 * @see ADR-029
 * @see ADR-030
 */

import { logger } from '../../logger/index.js';
import { monotonicNow } from '../../utils/clock/index.js';

/**
 * Builds the gate.
 *
 * @param {Object} parts - What the gate runs on
 * @param {Object} parts.probe - The ADR-030 probe bound to `ilpUrl`
 * @param {function} parts.probe.run - `() => Promise<outcome>`
 * @param {function} parts.probe.describe - `( outcome ) => string`, the finding for an operator
 * @param {function} parts.heldRows - `() => number`, rows the engine holds in the buffer now
 * @param {function} parts.isShuttingDown - `() => boolean`
 * @param {function} parts.onPause - `( pausedSince, finding ) => void`, tells the ledger delivery paused
 * @param {function} parts.onResume - `() => void`, tells the ledger delivery resumed, after the resumed line
 * @returns {{afterFailure: function, tick: function, isPaused: function}}
 */
const createDeliveryGate = function ( { probe, heldRows, isShuttingDown, onPause, onResume } ) {
    // `paused` stops the engine's row and timer triggers. `pausedSince`
    // is the wall-clock time the pause began, for health, where it
    // leaves the process. `pausedAt` is the same instant on the
    // stopwatch, for the resume line's length, so a step in the wall
    // clock cannot change it (ADR-018). `probing` keeps one probe in
    // flight at a time.
    let paused = false;
    let pausedSince = null;
    let pausedAt = 0;
    let probing = false;

    /**
     * Describes an outcome and never throws. The gate must not depend
     * on the probe's robustness. A describer that threw would reject
     * the chain in `runProbe`, and then `afterFailure` would never
     * report the loss or release the engine's guard: no flush could
     * start again, and nothing would say so.
     *
     * @param {Object} outcome - What `probe.run` resolved with
     * @returns {string} The operator text, or a fallback naming the throw
     */
    const describeSafely = function ( outcome ) {
        try {
            return probe.describe( outcome );
        } catch ( err ) {
            return `the probe's description failed: ${err.message}`;
        }
    }; // describeSafely()

    /**
     * Runs the probe once and never rejects.
     *
     * @returns {Promise<{outcome: Object, finding: string}>} The outcome and its operator text
     */
    const runProbe = function () {
        return Promise.resolve().then( probe.run ).then(
            function ( outcome ) {
                return { outcome, finding: describeSafely( outcome ) };
            },
            function ( err ) {
                return { outcome: { ok: false, error: err.message }, finding: `the probe itself failed: ${err.message}` };
            }
        );
    }; // runProbe()

    /**
     * Pauses delivery after a failing probe. The held count is what the
     * buffer holds now; it grows until the resume flush carries it.
     *
     * @param {string} finding - The probe's operator text
     */
    const pause = function ( finding ) {
        paused = true;
        pausedSince = Date.now();
        pausedAt = monotonicNow();
        // The ledger's ladder turns red on the pause and prints its red
        // edge first, so the log reads red, then paused.
        onPause( pausedSince, finding );
        logger.warn( `winkComposer/questdb: delivery paused, ${heldRows()} row(s) held [CIRCUIT_OPEN]: ${finding}` );
    }; // pause()

    /**
     * Resumes delivery after a passing tick probe. The ledger hears it
     * after the resumed line, so a restored line, when the ladder lands
     * on green, reads after resumed.
     *
     * @param {string} finding - The probe's operator text
     */
    const resume = function ( finding ) {
        const seconds = Math.round( ( monotonicNow() - pausedAt ) / 1000 );
        paused = false;
        pausedSince = null;
        logger.warn(
            `winkComposer/questdb: delivery resumed after ${seconds} s, ${heldRows()} row(s) held [CIRCUIT_OPEN]: ${finding}`
        );
        onResume();
    }; // resume()

    /**
     * Routes a failed or abandoned engine flush (the three cases in the
     * file header). `release()` is called exactly once, when the engine
     * may start flushes again, and always before `report( probed )`,
     * which is called exactly once with the probe result or null.
     *
     * @param {function} report - `( probed|null ) => void`, reports the loss
     * @param {function} release - `() => void`, lowers the engine's guard
     */
    const afterFailure = function ( report, release ) {
        if ( isShuttingDown() ) {
            release();
            return;
        }
        if ( paused || probing ) {
            release();
            report( null );
            return;
        }
        probing = true;
        runProbe().then( function ( probed ) {
            probing = false;
            // Release before the report: nothing runs between the two,
            // and a report that throws must not leave the guard up.
            release();
            report( probed );
            if ( !isShuttingDown() && !probed.outcome.ok ) {
                pause( probed.finding );
            }
        } );
    }; // afterFailure()

    /**
     * The tick while paused: one probe at a time, nothing printed.
     *
     * @returns {Promise<boolean>} True when this tick resumed delivery
     */
    const tick = function () {
        if ( probing ) {
            return Promise.resolve( false );
        }
        probing = true;
        return runProbe().then( function ( probed ) {
            probing = false;
            if ( isShuttingDown() || !probed.outcome.ok ) {
                return false;
            }
            resume( probed.finding );
            return true;
        } );
    }; // tick()

    return {
        afterFailure,
        tick,
        isPaused: function () {
            return paused;
        }
    };
}; // createDeliveryGate()

export { createDeliveryGate };

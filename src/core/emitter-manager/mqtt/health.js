// core/emitter-manager/mqtt/health.js

/**
 * @fileoverview Pressure and health of the MQTT emitter (ADR-018 §8,
 * ADR-021).
 *
 * One counter, `state.unacked`, feeds everything here. `getPressure()`
 * is that counter over the cap, and `getHealth()` derives the status
 * from the link and the pressure. The factory builds this once;
 * nothing allocates on the pressure read.
 *
 * Two pressure callbacks live here, with different cadences.
 * `onBackpressure` is a level signal: `checkBackpressure()` calls it
 * after every acknowledgment with the current pressure. `onCritical`
 * is an edge signal: `checkCritical()` calls it once when an accepted
 * publish lifts pressure above the critical threshold, then disarms
 * it. An acknowledgment that brings pressure below the yellow
 * threshold re-arms it. Pressure rises only on accepts, so the
 * crossing is detected on the accept path. During a broker outage no
 * acknowledgment arrives, and an ack-side check would stay silent
 * through the whole climb. The accept-path cost is one boolean read
 * and, while armed, one comparison. A level signal here would repeat
 * the same warning on every acknowledgment while pressure stays high,
 * and the message-level callback guard prints each call it catches.
 *
 * Health-status semantics (uniform across sinks):
 * - `red`    if `!state.connected`.
 * - `yellow` if connected AND `pressure >= 0.66` (threshold shared with
 *   ADR-020's Draft yield proposal).
 * - `green`  otherwise.
 *
 * @see ADR-018
 * @see ADR-021
 */

import { QUEUE_CRITICAL_THRESHOLD } from './constants.js';

/**
 * Pressure threshold above which `getHealth().status` elevates to at least
 * 'yellow' (uniform with Terminal/QuestDB). The value matches the
 * pressure-aware-yield design (ADR-020, still a Draft). That design
 * proposes 0.66 as the pressure level where the flow would start yielding
 * to let sinks drain; a benchmark still has to confirm the number. Today
 * the yield trigger is time-only (ADR-024), so this alignment is
 * forward-looking.
 * @type {number}
 */
const HEALTH_PRESSURE_YELLOW_THRESHOLD = 0.66;

/**
 * Builds the pressure and health readers over the shared state.
 *
 * @param {Object} deps
 * @param {Object} deps.state - The emitter's core state
 * @param {number} deps.maxQueueSize - The unacked cap
 * @param {function|null} deps.onCritical - Guard-wrapped high-pressure callback, or null
 * @param {function|null} deps.onBackpressure - Guard-wrapped pressure callback, or null
 * @returns {{getPressure: function, checkCritical: function, checkBackpressure: function, getHealth: function}}
 */
export const createHealth = function ( { state, maxQueueSize, onCritical, onBackpressure } ) {
    // The edge state of `onCritical`. Armed means the next climb past
    // the critical threshold fires the callback. It starts armed.
    let criticalArmed = true;

    /**
     * Fill ratio of the unacked window: unacked / maxQueueSize, capped
     * at 1. Sync, O(1), allocation-free (ADR-018).
     * @returns {number}
     */
    const getPressure = function () {
        const ratio = state.unacked / maxQueueSize;
        return ratio > 1 ? 1 : ratio;
    };

    /**
     * Fires `onCritical` once when an accepted publish lifts pressure
     * above the critical threshold, then disarms it. Runs on the
     * accept path, after the counter rises. The disarm comes before
     * the call, so a callback that throws (contained by the guard)
     * still counts as fired.
     */
    const checkCritical = function () {
        if ( criticalArmed && onCritical ) {
            const pressure = getPressure();
            if ( pressure > QUEUE_CRITICAL_THRESHOLD ) {
                criticalArmed = false;
                onCritical( 'QUEUE_CRITICAL', pressure );
            }
        }
    };

    /**
     * Runs after every acknowledgment. Re-arms `onCritical` once
     * pressure is back below the yellow threshold, and reports the
     * current pressure to `onBackpressure`.
     */
    const checkBackpressure = function () {
        const pressure = getPressure();

        if ( pressure < HEALTH_PRESSURE_YELLOW_THRESHOLD ) {
            criticalArmed = true;
        }

        if ( onBackpressure ) {
            onBackpressure( pressure );
        }
    };

    /**
     * Health snapshot for operator monitoring (uniform across sinks).
     *
     * Returns the ADR-018 health floor `{status, connected, pressure}` plus
     * this adapter's own `stats` addition. `stats.unacked` is the live
     * counter — the number of messages
     * accepted but not yet acknowledged by the broker; exactly what a
     * process crash at this instant would cost (ADR-021).
     *
     * Status derivation (uniform with Terminal/QuestDB; see file header):
     * - `red`    when `!connected`
     * - `yellow` when connected AND `pressure >= HEALTH_PRESSURE_YELLOW_THRESHOLD`
     * - `green`  otherwise
     *
     * The wal-backed design's `storeHealth`, `circuitState`, and `metrics`
     * diagnostics died with the LevelDB store (ADR-021).
     *
     * @returns {Object} Health snapshot — required floor + live counter
     */
    const getHealth = function () {
        const pressure = getPressure();

        let status;
        if ( !state.connected ) {
            status = 'red';
        } else if ( pressure >= HEALTH_PRESSURE_YELLOW_THRESHOLD ) {
            status = 'yellow';
        } else {
            status = 'green';
        }

        return {
            // Required floor (ADR-018)
            status,
            connected: state.connected,
            pressure,
            // This adapter's addition beyond the floor
            stats: { ...state.stats, unacked: state.unacked }
        };
    };

    return { getPressure, checkCritical, checkBackpressure, getHealth };
}; // createHealth()

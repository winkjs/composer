// core/emitter-manager/mqtt/health.js

/**
 * @fileoverview Pressure and health of the MQTT emitter (ADR-018 §8,
 * ADR-021).
 *
 * One counter, `state.unacked`, feeds everything here. `getPressure()`
 * is that counter over the cap, `getHealth()` derives the status from
 * the link and the pressure, and `checkBackpressure()` signals the
 * two pressure callbacks after each acknowledgment. The factory builds
 * this once; nothing allocates on the pressure read.
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
 * @returns {{getPressure: function, checkBackpressure: function, getHealth: function}}
 */
export const createHealth = function ( { state, maxQueueSize, onCritical, onBackpressure } ) {

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
     * Check and signal backpressure
     */
    const checkBackpressure = function () {
        const pressure = getPressure();

        if ( ( pressure > QUEUE_CRITICAL_THRESHOLD ) && onCritical ) {
            onCritical( 'QUEUE_CRITICAL', pressure );
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

    return { getPressure, checkBackpressure, getHealth };
}; // createHealth()

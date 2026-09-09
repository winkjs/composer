// core/utils/jitter/index.js

/**
 * @fileoverview Adds a random share to a reconnect period, once per
 * client, so a fleet does not retry in step.
 *
 * mqtt.js retries at a fixed period. When one broker goes away, every
 * client that used it fails at the same moment and retries on the same
 * beat. Attempt `k` from every client lands on the recovering broker
 * at `k` times the period, all at once. This module gives each client
 * its own period: the configured one plus a random share of up to a
 * fifth of it. The share is drawn once at setup, and because attempt
 * `k` fires at `k` times the period, a fixed offset spreads the fleet
 * further with each attempt.
 *
 * The configured period is the operator's floor. The helper never
 * shortens it, and a period of zero stays zero, so a reconnect that
 * was switched off stays off. Both MQTT adapters use this module; the
 * reconnect loop itself stays the library's (ADR-018).
 *
 * The random source is a parameter, so a spec can name its result.
 * Nothing here runs on a message path.
 *
 * @see ADR-018
 */

/** The largest share of the period the jitter may add. */
export const RECONNECT_JITTER_FRACTION = 0.2;

/**
 * Returns the period plus the floor of a random share of it.
 *
 * @param {number} periodMs - The configured period, a finite number of milliseconds, zero or more
 * @param {Object} [options]
 * @param {number} [options.fraction=RECONNECT_JITTER_FRACTION] - The largest share to add, in `[0, 1]`
 * @param {Function} [options.random=Math.random] - Returns a number in `[0, 1)`
 * @returns {number} `periodMs + Math.floor( random() * periodMs * fraction )`
 * @throws {TypeError} when an argument is out of range
 */
export const jitteredPeriod = function ( periodMs, { fraction = RECONNECT_JITTER_FRACTION, random = Math.random } = {} ) {
    if ( ( typeof periodMs !== 'number' ) || !Number.isFinite( periodMs ) || ( periodMs < 0 ) ) {
        throw new TypeError( `winkComposer/jitter: periodMs must be a finite number of milliseconds, zero or more, got ${String( periodMs )}` );
    }
    if ( ( typeof fraction !== 'number' ) || !( ( fraction >= 0 ) && ( fraction <= 1 ) ) ) {
        throw new TypeError( `winkComposer/jitter: fraction must be a number in [0, 1], got ${String( fraction )}` );
    }
    if ( typeof random !== 'function' ) {
        throw new TypeError( 'winkComposer/jitter: random must be a function' );
    }
    return periodMs + Math.floor( random() * periodMs * fraction );
}; // jitteredPeriod()

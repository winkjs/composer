// core/source-manager/mqtt/dedup.js

/**
 * @fileoverview Time-bounded, count-capped dedup cache for MQTT QoS 1
 * retransmissions (ADR-022).
 *
 * QoS 1 is "at least once": a re-send after a connection break carries
 * the same `winkDedupId` as its original, and this cache drops the
 * repeat. A duplicate arrives roughly one outage after its original,
 * so the cache is specified in TIME (catch any duplicate within
 * `windowMs`) and guaranteed in MEMORY (never hold more than
 * `maxEntries` ids). Whichever bound binds first wins; at high message
 * rates the effective window is `maxEntries ÷ rate` — the trade is
 * documented in ADR-022, not hidden.
 *
 * One structure, no modes, no timers:
 * - A `Set` gives O(1) duplicate lookup.
 * - A pre-allocated ring (id slots + a Float64Array of arrival
 *   timestamps) gives O(1) insertion and eviction in arrival order.
 * - Expiry is checked at the ring head on each call — amortized O(1),
 *   no background sweep.
 *
 * Hot-path allocation profile (ADR-018 zero-alloc — allocation only where
 * unavoidable, each residual stated, no overclaiming):
 * - Our code allocates nothing per message: the ring, the timestamp
 *   array, and the Set are created at initialization; ids are stored
 *   by reference; no objects, arrays, or strings are built.
 * - Two unavoidable residuals, both bounded: (1) `Set.add`/`Set.delete`
 *   maintain V8's internal hash table — amortized O(1), memory bounded
 *   by `maxEntries`, and the identical profile the pre-ADR-022 cache
 *   already had (JS offers no pre-sized Set). (2) `Date.now()` exceeds
 *   the small-integer range, so the timestamp is transiently boxed; it
 *   unboxes on store into the Float64Array and dies in the nursery.
 * - Eviction clears the ring slot so an evicted id string is not
 *   retained past its window — that release is deliberate.
 *
 * Opt-in by construction: a message without a dedup id (null or
 * undefined) bypasses the cache entirely — identity is never guessed
 * from content (ADR-022 rejected content hashing: byte-identical
 * telemetry is routinely two real readings).
 *
 * Crash residue (accepted, per ADR-022): the cache is in-memory, so a
 * crash between processing and acknowledging a message means its
 * broker redelivery after restart is processed once more. At most one
 * duplicate per source crash; disk-backed dedup state was rejected.
 *
 *   ASSUMPTIONS
 *   -----------
 *   1. A dedup id is unique per message and repeats only on a QoS-1
 *      retransmission (the emitter stamps UUIDs).
 *   2. The clock moves forward at millisecond granularity. A backward
 *      clock jump can expire entries early or hold them one window too
 *      long — bounded either way, and self-healing within one window.
 *
 *   LIMITATIONS
 *   -----------
 *   1. In-memory: the cache dies with the process, so a duplicate
 *      arriving just after a restart may slip through. Deliberate
 *      (ADR-022 rejected disk-backed state); at most one per crash;
 *      QuestDB's at-rest dedup is the backstop.
 *   2. At high rates the count cap binds before the time window: the
 *      effective window is maxEntries ÷ rate (the full 120 s up to
 *      about 550 msg/s at defaults; ~6.5 s at 10 k msg/s). Stated in
 *      ADR-022, not hidden.
 *   3. Memory, measured (benchmark/mqtt-source/dedup-memory.js,
 *      2026-07-09): 86 bytes per production-shaped id, ~6.7 MB worst
 *      case at the 65,536 cap including bounded V8 Set slack.
 *
 * @see ADR-022 - The full decision
 */

import {
    DEFAULT_DEDUP_WINDOW_MS,
    DEFAULT_DEDUP_MAX_ENTRIES
} from './constants.js';

// ============================================================================
// VALIDATION HELPER
// ============================================================================

/**
 * Throws a classified INVALID_CONFIG error (ADR-018 fail-fast setup)
 * when `value` is not a positive integer.
 *
 * @param {*} value - Candidate value
 * @param {string} name - Field name for the error message
 */
const assertPositiveInteger = function ( value, name ) {
    if ( typeof value !== 'number' || value < 1 || !Number.isInteger( value ) ) {
        const err = new Error( `WinkComposer/mqtt-source: ${name} must be a positive integer` );
        err.code = 'INVALID_CONFIG';
        throw err;
    }
};

// ============================================================================
// DEDUP CACHE FACTORY
// ============================================================================

/**
 * Create a time-bounded, count-capped dedup cache.
 *
 * All hot-path operations are O(1) (expiry amortized): Set lookup,
 * ring-slot insertion, head eviction.
 *
 * @param {Object} [options={}] - Cache options
 * @param {number} [options.windowMs=120000] - Time bound: an entry
 *   expires once its age reaches this many milliseconds
 * @param {number} [options.maxEntries=65536] - Count cap: the memory
 *   guarantee; the oldest entry is evicted when the ring is full
 * @param {function} [options.nowFn=Date.now] - Clock source. Injection
 *   point for deterministic tests; production uses the default
 * @returns {Object} Cache instance with isDuplicate, size, clear, has
 */
const createDedupCache = function ( options = {} ) {
    if ( typeof options !== 'object' || options === null ) {
        const err = new Error( 'WinkComposer/mqtt-source: dedup options must be an object' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }

    const {
        windowMs = DEFAULT_DEDUP_WINDOW_MS,
        maxEntries = DEFAULT_DEDUP_MAX_ENTRIES,
        nowFn = Date.now
    } = options;

    assertPositiveInteger( windowMs, 'windowMs' );
    assertPositiveInteger( maxEntries, 'maxEntries' );
    if ( typeof nowFn !== 'function' ) {
        const err = new Error( 'WinkComposer/mqtt-source: nowFn must be a function' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }

    // Pre-allocated structures (zero allocation on the hot path).
    const seen = new Set();                           // O(1) duplicate lookup
    const ids = new Array( maxEntries );              // Ring: dedup ids in arrival order
    const stamps = new Float64Array( maxEntries );    // Ring: arrival timestamps
    let head = 0;                                     // Oldest live entry
    let tail = 0;                                     // Next insert slot
    let count = 0;                                    // Live entries

    /**
     * Evict the entry at the ring head. The slot is cleared so the id
     * string is not retained after eviction.
     */
    const evictHead = function () {
        seen.delete( ids[ head ] );
        ids[ head ] = undefined;
        head = ( head + 1 ) % maxEntries;
        count -= 1;
    };

    /**
     * Check whether dedupId was seen within the window. New ids are
     * cached; expired and cap-evicted ids count as new again.
     *
     * @param {string|null|undefined} dedupId - Deduplication identifier
     * @returns {boolean} true if duplicate (skip), false if new (process)
     */
    const isDuplicate = function ( dedupId ) {
        // No dedup id → bypass: the message is processed verbatim and
        // the cache is not touched (opt-in by construction, ADR-022).
        if ( dedupId === null || dedupId === undefined ) {
            return false;
        }

        const now = nowFn();

        // Sweep expired entries from the head. Bounded by the live
        // count so the loop provably terminates; each entry is evicted
        // at most once, so the sweep is amortized O(1) per call.
        const live = count;
        for ( let i = 0; i < live; i += 1 ) {
            if ( ( now - stamps[ head ] ) < windowMs ) {
                break;
            }
            evictHead();
        }

        if ( seen.has( dedupId ) ) {
            return true;
        }

        // Cap bound: a full ring evicts its oldest to admit the newest.
        if ( count === maxEntries ) {
            evictHead();
        }

        ids[ tail ] = dedupId;
        stamps[ tail ] = now;
        seen.add( dedupId );
        tail = ( tail + 1 ) % maxEntries;
        count += 1;

        return false;
    };

    /**
     * Get current number of cached entries.
     *
     * @returns {number} Number of live entries
     */
    const size = function () {
        return count;
    };

    /**
     * Clear all cached entries. Used for testing or reset.
     */
    const clear = function () {
        seen.clear();
        ids.fill( undefined );
        stamps.fill( 0 );
        head = 0;
        tail = 0;
        count = 0;
    };

    /**
     * Check if dedupId is in cache without modifying it. Test helper —
     * does not add, evict, or sweep.
     *
     * @param {string} dedupId - Deduplication identifier
     * @returns {boolean} true if in cache, false otherwise
     */
    const has = function ( dedupId ) {
        return seen.has( dedupId );
    };

    return {
        isDuplicate,
        size,
        clear,
        has
    };
};

// ============================================================================
// EXPORTS
// ============================================================================

export { createDedupCache };

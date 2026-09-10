// core/utils/clock/index.js

/**
 * @fileoverview The stopwatch clock for time rules that must not
 * follow the wall clock.
 *
 * `Date.now()` reads the wall clock, and the wall clock can step. NTP
 * corrects a board after boot or after a long time without network,
 * and an operator can set the time by hand. A rule such as "red after
 * 30 s disconnected" or "expire a dedup entry after 120 s" would then
 * fire early or late by the size of the step. `performance.now()`
 * reads a clock that only counts up, from process start, in
 * milliseconds with a fraction. A step in the wall clock does not
 * move it (ADR-018, long-running stability).
 *
 * The function reads `globalThis.performance` at every call, for two
 * reasons. The method must be called on its own object, so the bare
 * method cannot be passed around as a clock. And a test that fakes the
 * stopwatch replaces the global object rather than patching the
 * method, so a captured reference would keep reading the real clock.
 *
 * Use this clock for durations and expiry. Use `Date.now()` for
 * timestamps that leave the process, such as a record's time field.
 */

/**
 * Reads the stopwatch clock.
 *
 * @returns {number} Milliseconds since process start, with a fraction;
 *   never decreases.
 */
export const monotonicNow = function () {
    return globalThis.performance.now();
}; // monotonicNow()

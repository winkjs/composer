// core/test/timer-floor.js

/**
 * @fileoverview The margin a spec subtracts from a timer budget before
 * it asserts that the elapsed time reached the budget.
 *
 * A spec that proves "the code waited its whole budget" reads a clock
 * before and after the wait and asserts that the difference is at
 * least the budget. Read literally, that assertion can fail on any
 * machine. Node schedules a timer on its own clock, an integer count
 * of milliseconds that truncates, so a 200 ms timer may fire when a
 * clock with fractions has counted 199.x ms. On Linux that timer clock
 * may also come from a coarse system clock of up to one millisecond
 * resolution, which adds up to one more millisecond. So a timer can
 * fire up to about 2 ms before its budget as the stopwatch measures
 * it, and never more. A slow processor makes a timer late, never
 * early, so the margin does not grow with the hardware.
 *
 * Five milliseconds covers that with room and still proves the wait.
 * A wait that ended at once measures near zero, not near the budget.
 * Subtract one margin per timer in a chain, because each timer
 * truncates on its own.
 *
 * Specs measure the elapsed time on the stopwatch clock,
 * `monotonicNow`, the clock the production code reads for durations.
 * So a step in the wall clock during the wait cannot fail the spec
 * either (ADR-018, long-running stability).
 */

/** Milliseconds a timer may fire before its budget, with room to spare. */
export const TIMER_FLOOR_MARGIN_MS = 5;

// core/utils/line-rate/index.js

/**
 * @fileoverview Bounds how often a repeating event reaches the log.
 *
 * A dead sensor, a stuck callback, or an unreachable database produces
 * the same event once per row. Printing every one fills a log file with
 * one line per second for a whole night, and the line that matters is
 * lost in the repeats. This module keeps the first lines of such an
 * episode in full and then prints one summary per interval. An episode
 * is a run of events with no quiet interval between them. A quiet
 * interval ends the episode, so the next event prints in full again.
 *
 * The bound is a pure closure over a wall-clock timestamp. It holds no
 * timer, so it needs no shutdown and cannot keep a process alive. The
 * summary prints at the next event after the interval, never on a
 * timer. So a burst that stops shows its count only when the next
 * episode starts, or never. That is the accepted trade for zero timers.
 *
 * Two sites share this shape. The QuestDB adapter's flush-failure loss
 * line uses the same algorithm inline (ADR-029, the bounded loss line).
 * The adapter's default row-skip warning and the callback guard's
 * `CALLBACK_FAILED` line both use this module.
 */

/**
 * Creates a line bound.
 *
 * The returned function takes the event's arguments, up to three, and
 * forwards them by identity to `printFull` for the first `fullLines`
 * events of an episode. What the arguments mean is the caller's
 * business: the callback guard passes a severity, a callback name and
 * a fault description; the row-skip warning passes a raw value and a
 * partition id. Later events inside the interval are counted. The
 * first event a full interval after the last printed line calls
 * `printSummary` with the count since that line, the seconds elapsed,
 * and the latest arguments. When an episode ends with counted events,
 * their summary prints before the next episode's first full line.
 *
 * Three named parameters stand in for a rest parameter on purpose. A
 * rest parameter builds an array on every call, and the row-skip
 * warning runs once per skipped row.
 *
 * @param {Object} options
 * @param {number} options.fullLines - How many events per episode print in full.
 * @param {number} options.intervalMs - The summary interval, also the quiet gap that ends an episode.
 * @param {Function} options.printFull - Called as `printFull( arg1, arg2, arg3 )` with the event's arguments.
 * @param {Function} options.printSummary - Called as `printSummary( count, seconds, arg1, arg2, arg3 )`.
 * @returns {Function} `( arg1, arg2, arg3 ) => void`.
 */
export const createLineBound = function ( { fullLines, intervalMs, printFull, printSummary } ) {
    let lastEventAt = 0;
    let lastLineAt = 0;
    let printed = 0;
    let counted = 0;

    // The state clears before the printer runs, as on the full-line
    // path. A printer that throws then costs that one line only. With
    // the old order a throw left the count and the stamp behind, and
    // every later event ran straight into the printer again.
    const summarize = function ( now, arg1, arg2, arg3 ) {
        const seconds = Math.round( ( now - lastLineAt ) / 1000 );
        const count = counted;
        lastLineAt = now;
        counted = 0;
        printSummary( count, seconds, arg1, arg2, arg3 );
    }; // summarize()

    // The latest arguments are kept for the summary that closes an
    // episode. They belong to the last counted event, not the new one.
    let lastArg1;
    let lastArg2;
    let lastArg3;

    return function ( arg1, arg2, arg3 ) {
        const now = Date.now();
        if ( ( now - lastEventAt ) >= intervalMs ) {
            // A quiet interval ended the previous episode.
            if ( counted > 0 ) {
                summarize( now, lastArg1, lastArg2, lastArg3 );
            }
            printed = 0;
        }
        lastEventAt = now;
        lastArg1 = arg1;
        lastArg2 = arg2;
        lastArg3 = arg3;
        if ( printed < fullLines ) {
            printed += 1;
            lastLineAt = now;
            printFull( arg1, arg2, arg3 );
            return;
        }
        counted += 1;
        if ( ( now - lastLineAt ) < intervalMs ) {
            return;
        }
        summarize( now, arg1, arg2, arg3 );
    };
}; // createLineBound()

// nodes/spike-guard/update.js

/**
 * @fileoverview Core spike detection algorithm.
 *
 * Window: [left, middle, right]  (3-sample sliding window of VALUES)
 *
 * On each sample:
 *   1. Push new value into window
 *   2. If window full:
 *      - leftDiff  = |middle - left|
 *      - rightDiff = |middle - right|
 *      - detected = (leftDiff > threshold) AND (rightDiff > threshold)
 *      - clean = median(left, middle, right)
 *      - magnitude = (middle - avg(left, right)) if detected, else 0
 *   3. Output: clean, detected, magnitude (signed: negative=dip, positive=surge)
 *
 * Why This Works (No False Positives at Transitions):
 *
 * | Scenario      | Window           | leftDiff | rightDiff | Both > T? | Result     |
 * |---------------|------------------|----------|-----------|-----------|------------|
 * | Spike         | [90, 0.7, 90]    | 89.3     | 89.3      | YES       | DETECTED   |
 * | Falling edge  | [90, 90, 0.7]    | 0        | 89.3      | NO        | not spike  |
 * | Falling edge  | [90, 0.7, 0.7]   | 89.3     | 0         | NO        | not spike  |
 * | Rising edge   | [0.7, 0.7, 90]   | 0        | 89.3      | NO        | not spike  |
 * | Rising edge   | [0.7, 90, 90]    | 89.3     | 0         | NO        | not spike  |
 * | Normal        | [89, 91, 90]     | 2        | 1         | NO        | not spike  |
 */

import { push } from '../../windowing/count-sliding/index.js';

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;

    const xVal = msg[ state.x ];

    // Reset on each update
    state.inputValidationFailed = false;

    // Handle faults gracefully: ensure their isolation
    if ( !Number.isFinite( xVal ) ) {
        // Signals publishing NaN for all demanded `stats` in publishTo.
        state.inputValidationFailed = true;
        return state;
    }

    push( state.ring, xVal );

    // Need exactly 3 values for spike detection
    if ( state.ring.used < 3 ) {
        // Partial window: output current value, no detection
        state.clean = xVal;
        state.detected = false;
        state.magnitude = 0;
        return state;
    }

    // Extract window values in chronological order: [oldest, middle, newest]
    // The ring buffer's head points to the NEXT slot to write (= oldest value)
    const head = state.ring.head;
    const left = state.ring.buffer[ head ];              // oldest
    const middle = state.ring.buffer[ ( head + 1 ) % 3 ]; // middle (potential spike)
    const right = state.ring.buffer[ ( head + 2 ) % 3 ];  // newest (just pushed)

    // Compute differences from middle to neighbors
    const leftDiff = Math.abs( middle - left );
    const rightDiff = Math.abs( middle - right );

    // Spike = middle differs from BOTH neighbors by > threshold
    state.detected = ( leftDiff > state.threshold ) &&
                     ( rightDiff > state.threshold );

    // Compute median for clean value (same algorithm as median3)
    let a = left;
    let b = middle;
    let c = right;
    if ( a > b ) [ a, b ] = [ b, a ];
    if ( b > c ) [ b, c ] = [ c, b ];
    state.clean = ( a > b ) ? a : b;

    // Signed magnitude: deviation from expected (interpolated) value
    // Negative = dip (dropout), Positive = surge (noise)
    const expectedValue = ( left + right ) / 2;
    state.magnitude = state.detected ? ( middle - expectedValue ) : 0;

    return state;
}; // update()

export default update;

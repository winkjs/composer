/**
 * @fileoverview Update function for median3 node.
 *
 * Computes the median of the last 3 values using a 3-element sorting network.
 * For partial windows: 1 value returns itself, 2 values return their average.
 *
 * Algorithm: compare-swap (a,b), compare-swap (b,c), then max(a,b) yields
 * the median. This is a standard 3-element sorting network requiring exactly
 * 3 comparisons. Reference: Knuth, TAOCP Vol. 3, Section 5.3.4.
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

    let a = state.ring.buffer[ 0 ];
    let b = state.ring.buffer[ 1 ];
    let c = state.ring.buffer[ 2 ];

    if ( state.ring.used > 2 ) {
        let tmp;
        if ( a > b ) {
            tmp = a;
            a = b;
            b = tmp;
        }
        if ( b > c ) {
            tmp = b;
            b = c;
            c = tmp;
        }
        state.median3 = ( a > b ) ? a : b;
        return state;
    }

    if ( state.ring.used === 2 ) {
        state.median3 = ( a + b ) / 2;
        return state;
    }

    state.median3 = xVal;

    return state;
}; // update()

export default update;

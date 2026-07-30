/**
 * @fileoverview Reset for kernel node.
 *
 * Clears the ring buffer and result. Configuration properties (kernel,
 * field names, stats) are preserved across reset.
 */

import * as ring from '../../windowing/count-sliding/index.js';

const reset = function ( state ) {
    // Reset window state
    ring.reset( state.ring );

    // Clear result
    state.result = 0;

    return true;
}; // reset()

export default reset;

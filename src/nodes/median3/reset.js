/**
 * @fileoverview Reset median3 node state.
 *
 * Clears the ring buffer and resets the computed median value.
 */

import { reset as resetRing } from '../../windowing/count-sliding/index.js';

const reset = function ( state ) {
    resetRing( state.ring );
    state.median3 = 0;
    return true;
}; // reset()

export default reset;

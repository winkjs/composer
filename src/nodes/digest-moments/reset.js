// nodes/digest-moments/reset.js

/**
 * @fileoverview Reset function for digestMoments node.
 *
 * This is a stateless node (no accumulation), so reset is a no-op.
 * Returns true to indicate the node can continue processing.
 */

const reset = function ( _state ) {
    return true;
}; // reset()

export default reset;

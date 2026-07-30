// nodes/digest-moments/recompute.js

/**
 * @fileoverview Recompute function for digestMoments node.
 *
 * This is a stateless node (no accumulation), so recompute is a no-op.
 * Returns true to indicate the node can continue processing.
 */

const recompute = function ( _state ) {
    return true;
}; // recompute()

export default recompute;

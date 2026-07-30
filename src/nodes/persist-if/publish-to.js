// nodes/persist-if/publish-to.js

/**
 * @fileoverview PublishTo function for persistIf node
 *
 * Pass-through node - message continues unchanged.
 * No fields are added to the outgoing message.
 */

/**
 * Publish computed results to message.
 *
 * @param {Object} _state - Node state (unused)
 * @param {Object} _msg - Outgoing message (unchanged)
 */
const publishTo = function ( _state, _msg ) {
    // Pure pass-through node - message continues unchanged
    // No fields are added to the message
}; // publishTo()

export default publishTo;

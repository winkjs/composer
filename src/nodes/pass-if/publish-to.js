// nodes/pass-if/publish-to.js

/**
 * @fileoverview Publish-to function for passIf node
 *
 * No-op — pure gate node does not add any fields to the
 * message. Messages that pass the predicate continue unchanged.
 */

const publishTo = function ( _state, _msg ) {
    // PassIf is a pure gate - it doesn't publish any data to the message
    // Messages that pass through are unchanged
}; // publishTo()

export default publishTo;

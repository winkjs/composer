/**
 * Populates required fields and prepares projected inputs for predicate
 * @param {Object} state - Node state containing requires and predicateInput
 * @param {Object} msg - Message to validate
 * @returns {string|null} - Name of invalid field or null if all valid
 */
const populatePredicateInput = function ( state, msg ) {
    for ( let i = 0; i < state.requires.length; i += 1 ) {
        const field = state.requires[ i ];
        state.predicateInput[ field ] = msg[ field ];
    }
}; // copyRequiredFields()

export default populatePredicateInput;

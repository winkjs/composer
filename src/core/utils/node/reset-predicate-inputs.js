/**
 * Resets predicateInput object for next message
 * @param {Object} state - Node state containing requires and predicateInput
 */
const resetPredicateInput = function ( state ) {
    for ( let i = 0; i < state.requires.length; i += 1 ) {
        state.predicateInput[ state.requires[ i ] ] = undefined;
    }
}; // resetPredicateInput()

export default resetPredicateInput;

/**
 * @fileoverview Reset categorize node state.
 *
 * Restores categorization to init-time defaults: first category, cleared
 * error flags, and reset tunable error suppression.
 */

const reset = function ( state ) {
    state.inputValidationFailed = false;
    state.categoryIndex = 0;
    state.category = state.categories[ 0 ];
    state.tunableErrorLogged = false;
    return true;
}; // reset()

export default reset;

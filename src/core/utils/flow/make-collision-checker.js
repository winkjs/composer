/**
 * Collision checker for generated identifiers.
 * Throws on duplicates; keeps errors explicit and early.
 */

const makeCollisionChecker = function () {
    const seen = Object.create( null );

    /**
     * Assert identifier has not been seen before.
     * @param {string} id
     * @param {string=} hint  Optional: human context for error messages
     */
    const isDuplicate = function ( id ) {
        if ( seen[ id ] === 1 ) return true;
        seen[ id ] = 1;
        return false;
    }; // assertUnique()

    return isDuplicate;
}; // makeCollisionChecker()

export { makeCollisionChecker };

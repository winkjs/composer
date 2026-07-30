// nodes/persistence-check/publish-to.js

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;

    msg[ state.stats.persistenceConfirmed.storeAs ] = state.persistenceConfirmed;
    // Reset immediately after publishing it.
    state.persistenceConfirmed = false;
}; // publishTo()

export default publishTo;

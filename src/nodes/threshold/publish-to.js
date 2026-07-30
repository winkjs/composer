// nodes/threshold/publish-to.js

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;
    // Only publish active stat
    if ( state.stats.active ) {
        msg[ state.stats.active.storeAs ] = state.active;
    }
}; // publishTo()

export default publishTo;

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;

    // Publish failure information if present
    if ( state.failureReason ) {
        if ( state.stats.failureReason ) {
            msg[ state.stats.failureReason.storeAs ] = state.failureReason;
        }
        if ( state.stats.failedValue ) {
            msg[ state.stats.failedValue.storeAs ] = state.failedValue;
        }
    }
}; // publishTo()

export default publishTo;

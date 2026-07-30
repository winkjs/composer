// Forces publication of incomplete window.
// Used for graceful shutdown or event driven snapshots.
const flush = function ( state ) {
    // Cascade nodes cannot be directly flushed
    if ( state.isCascading ) {
        return false;
    }
    // Set flush true so that during publish, the stats will be
    // published even if window is incomplete. Note, the publishTo()
    // method calls reset in the end resetting everything including
    // the `state.flush` to `false`.
    state.flushLatched = true;

    return true;
}; // reset()

export default flush;

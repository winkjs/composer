// nodes/tw-stats/flush.js

/**
 * Forces publication of incomplete window.
 * Used for graceful shutdown or event-driven snapshots.
 */
const flush = function ( state ) {
    state.flushLatched = true;
    return true;
}; // flush()

export default flush;

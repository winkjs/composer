// nodes/moments-digest/prelude.js

import { copyFrom } from './copy-from.js';
import reset from './reset.js';

export const prelude = function ( state, msg ) {
    // Clear last tick’s plan
    state.planPublish = false;
    state.propagateFlush = false;

    if ( !state.flushLatched && !msg[ state.flushSignalKey ] ) return;
    // Either `state.flushLatched` or `msg[ state.flushSignalKey ]` is true
    // implies that it is time to copy and plan a publish.

    // Only ROOT nodes handle flush in prelude
    if ( !state.isCascading ) {
        state.propagateFlush = true;

        if ( state.n > 0 ) {
            copyFrom( state, state.snapshot );      // copy previous window
            state.planPublish = true;               // we will publish stats this tick
            reset( state );                         // exclude current message
        }
    }
    // Otherwise: signal-only flush (no stats) via planPublish === false

    state.flushLatched = false;                 // consume latch
}; // prelude()

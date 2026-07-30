// nodes/moments-digest/publish-to.js

const publishTo = function ( state, msg ) {
    if ( state.disable ) return;
    // Do not Skip publishing if we encountered NaN in this update cycle
    // `update()` already suppresses planning on invalid samples;
    // a flush snapshot planned in `prelude()` must still render.
    const f = state.fieldMap;

    if ( state.propagateFlush && ( !state.isCascading ) ) {
        msg[ state.flushSignalKey ] = true;
    }

    if ( state.planPublish ) {
        const s = state.snapshot;
        msg[ f.n ]   = s.n;
        msg[ f.M1 ]  = s.M1;
        msg[ f.M2 ]  = s.M2;
        msg[ f.M3 ]  = s.M3;
        msg[ f.M4 ]  = s.M4;
        msg[ f.min ] = s.min;
        msg[ f.max ] = s.max;
        msg[ state.name ] = true;
        return;
    }

    // signal-only or no publish → scrub
    msg[ f.n ] = msg[ f.M1 ] = msg[ f.M2 ] = msg[ f.M3 ] = msg[ f.M4 ] = msg[ f.min ] = msg[ f.max ] = undefined;
}; // publishTo()

export default publishTo;

/**
 * @fileoverview Hot path for the tally node.
 *
 * One linear pass reads each flag field by truthiness and counts the truthy
 * flags. The three reductions follow from that count with no second pass:
 * count is the number itself, any is ( count > 0 ), all is ( count === n ).
 *
 * Fault handling: a flag is read by truthiness, so null, undefined, false and 0
 * are not-true ( in composer null/undefined mean "no value this tick", not bad
 * data ). The one fault is NaN — a flag goes NaN only when its own producer
 * faulted — which marks the tick invalid so publishTo writes NaN to every output.
 * This is why the guard is Number.isNaN, not the numeric Number.isFinite.
 */

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    state.inputValidationFailed = false;

    const fields = state.fields;
    const n = state.n;

    let trueCount = 0;
    let i = 0;

    while ( i < n ) {
        const v = msg[ fields[ i ] ];
        if ( Number.isNaN( v ) ) {
            state.inputValidationFailed = true;
            return state;
        }
        if ( v ) {
            trueCount += 1;
        }
        i += 1;
    }

    state.count = trueCount;
    state.any = ( trueCount > 0 );
    state.all = ( trueCount === n );

    return state;
}; // update()

export default update;

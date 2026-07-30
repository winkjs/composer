/**
 * @fileoverview Hot path for the unbalance node.
 *
 * One linear pass computes the sum, the min and max, and the indices of those
 * extremes. The most-deviating-from-mean channel is always one of the extremes
 * ( for any xi, |xi - mean| <= max( max - mean, mean - min ) ), so maxDev,
 * worstIndex and worstDev follow with no second pass.
 *
 * Missing channels: a non-finite field ( NaN or +/-Infinity ) is skipped and the
 * present channels are counted. The tick blanks ( publishTo writes NaN to every
 * metric ) when fewer than state.minPresent channels are present. In the default
 * blank mode minPresent equals the full width, so any one missing field blanks
 * the tick — an incomplete set is an undefined cross-field metric. In skip mode
 * minPresent is lower, so the metric is computed over the channels present.
 * presentCount always carries the real count, even on a blanked tick.
 */

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    state.inputValidationFailed = false;

    const fields = state.fields;
    const n = state.n;

    let sum = 0;
    let minVal = Infinity;
    let maxVal = -Infinity;
    let minIdx = 0;
    let maxIdx = 0;
    let present = 0;
    let i = 0;

    while ( i < n ) {
        const v = msg[ fields[ i ] ];
        if ( Number.isFinite( v ) ) {
            sum += v;
            present += 1;
            if ( v < minVal ) {
                minVal = v;
                minIdx = i;
            }
            if ( v > maxVal ) {
                maxVal = v;
                maxIdx = i;
            }
        }
        i += 1;
    }

    // A fact about the input, always defined — set before any blank return.
    state.presentCount = present;

    if ( present < state.minPresent ) {
        state.inputValidationFailed = true;
        return state;
    }

    const mean = sum / present;
    state.mean = mean;
    state.min = minVal;
    state.max = maxVal;
    state.range = ( maxVal - minVal );

    if ( state.needDev === false ) return state;

    const devHigh = ( maxVal - mean );
    const devLow = ( mean - minVal );
    const highWins = ( devHigh >= devLow );

    const maxAbsDev = highWins ? devHigh : devLow;
    state.maxDev = maxAbsDev;
    state.worstIndex = highWins ? maxIdx : minIdx;
    state.worstDev = highWins ? devHigh : ( -devLow );

    const absMean = Math.abs( mean );
    state.unbalance = ( absMean < state.epsilon ) ?
        NaN :
        ( ( 100 * maxAbsDev ) / absMean );

    return state;
}; // update()

export default update;

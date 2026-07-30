// nodes/ratio/update.js

const LN_TO_DB = 20 / Math.LN10;  // ≈ 8.6858896380650365

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    const xVal = msg[ state.x ];
    // Reset on each update
    state.inputValidationFailed = false;
    // Handle faults gracefully: ensure their isolation
    if ( !Number.isFinite( xVal ) ) {
        // Signals publishing NaN for all demanded `stats` in publishTo.
        state.inputValidationFailed = true;
        return state;
    }

    const yVal = msg[ state.y ];
    // Handle faults gracefully: ensure their isolation
    if ( !Number.isFinite( yVal ) ) {
        // Signals publishing NaN for all demanded `stats` in publishTo.
        state.inputValidationFailed = true;
        return state;
    }

    // Protection against division by zero or very small numbers.
    // Returns NaN to signal invalid computation - downstream nodes
    // can detect and handle this appropriately.
    if ( Math.abs( yVal ) < state.minY ) {
        state.ratio = NaN;  // Signal invalid ratio
        return state;
    }

    // For log scale, both values must be positive.
    // Log of non-positive numbers is undefined.
    if ( state.logScale && ( xVal <= 0 || yVal <= 0 ) ) {
        state.ratio = NaN;  // log of non-positive is undefined
        return state;
    }

    state.ratio = ( state.logScale ) ?
            ( Math.log( xVal ) - Math.log( yVal ) ) * LN_TO_DB :
            ( xVal / yVal ) * state.scaleBy;

    return state;
}; // update()

export default update;

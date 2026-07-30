// nodes/lag/update.js
/* eslint-disable complexity */

/**
 * @fileoverview Hot path for lag node message processing.
 *
 * Computes lag-based statistics with zero allocation. Only requested stats
 * are computed, using pre-computed flags from init(). Follows ADR-004.
 *
 * Complexity is disabled for this file because the five conditional stat
 * computations are inherently complex but cannot be refactored without
 * adding function call overhead to the hot path.
 *
 * @see ADR-004
 */

import { push } from '../../windowing/count-sliding/index.js';

/**
 * Processes a message and computes lag-based statistics.
 *
 * Algorithm:
 * 1. Push x value to ring buffer, receive evicted x_lag
 * 2. If slope requested, push timestamp, receive evicted t_lag
 * 3. If buffer not full (xLag undefined), all stats are NaN
 * 4. Otherwise, compute only requested stats
 *
 * Division by zero protection:
 * - ratio, roc: return NaN if x_lag === 0
 * - slope: return NaN if t - t_lag === 0
 * - logReturn: return NaN if x <= 0 or x_lag <= 0
 *
 * @param {Object} state - Node state from init()
 * @param {Object} msg - Incoming message with field values
 * @returns {Object} Updated state
 */
const update = function ( state, msg ) {
    // Guard: skip if disabled
    if ( state.disable || state.pause ) return state;

    // Extract input value
    const xVal = msg[ state.x ];

    // Reset health flag
    state.inputValidationFailed = false;

    // Validate x input (catches NaN, Infinity, undefined)
    if ( !Number.isFinite( xVal ) ) {
        state.inputValidationFailed = true;
        return state;
    }

    // Handle timestamp if slope is requested
    let tVal;
    if ( state.hasSlope ) {
        tVal = msg[ state.timestamp ];
        if ( !Number.isFinite( tVal ) ) {
            state.inputValidationFailed = true;
            return state;
        }
    }

    // Push x to ring buffer, get evicted x_lag (undefined during startup)
    const xLag = push( state.ringX, xVal );

    // Push timestamp if slope is needed
    let tLag;
    if ( state.hasSlope ) {
        tLag = push( state.ringT, tVal );
    }

    // Check if buffer is full (xLag is finite when evicted value exists)
    const hasLag = Number.isFinite( xLag );

    // Compute only requested stats
    if ( hasLag ) {
        // ── xLag: the lagged input value itself ────────────────────────
        if ( state.hasXLag ) {
            state.xLag = xLag;
        }

        // ── delta: x - x_lag ───────────────────────────────────────────
        if ( state.hasDelta ) {
            state.delta = xVal - xLag;
            if ( state.absolute ) {
                state.delta = Math.abs( state.delta );
            }
        }

        // ── ratio: x / x_lag ───────────────────────────────────────────
        if ( state.hasRatio ) {
            state.ratio = ( xLag === 0 ) ? NaN : ( xVal / xLag );
        }

        // ── roc: (x - x_lag) / x_lag ───────────────────────────────────
        if ( state.hasRoc ) {
            state.roc = ( xLag === 0 ) ? NaN : ( ( xVal - xLag ) / xLag );
        }

        // ── slope: (x - x_lag) / (t - t_lag) ───────────────────────────
        if ( state.hasSlope ) {
            const tDiff = tVal - tLag;
            state.slope = ( tDiff === 0 ) ? NaN : ( ( xVal - xLag ) / tDiff );
            if ( state.absolute && Number.isFinite( state.slope ) ) {
                state.slope = Math.abs( state.slope );
            }
        }

        // ── logReturn: ln(x / x_lag) ───────────────────────────────────
        if ( state.hasLogReturn ) {
            state.logReturn = ( xVal > 0 && xLag > 0 ) ?
                Math.log( xVal / xLag ) :
                NaN;
        }

        // ── cumDelta: Σ(x - x_lag) ──────────────────────────────────────
        if ( state.hasCumDelta ) {
            state.cumDelta += ( xVal - xLag );
        }
    } else {
        // Startup period: buffer not full, all requested stats are NaN
        if ( state.hasXLag ) state.xLag = NaN;
        if ( state.hasDelta ) state.delta = NaN;
        if ( state.hasRatio ) state.ratio = NaN;
        if ( state.hasRoc ) state.roc = NaN;
        if ( state.hasSlope ) state.slope = NaN;
        if ( state.hasLogReturn ) state.logReturn = NaN;
    }

    return state;
}; // update()

export default update;

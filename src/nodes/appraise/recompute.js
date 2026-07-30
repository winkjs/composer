// nodes/appraise/recompute.js

/**
 * @fileoverview Numerical stability handler for two-layer SNN appraise node.
 *
 * Checks for NaN in L1 membranes, charges, and L2 membrane. If any NaN
 * is detected (catastrophic numerical failure), triggers a full reset.
 * Otherwise, clamps L1 charges to [0, 1], floors L1 membranes and L2
 * membrane at 0, and recomputes conviction via MM readout.
 *
 * @see ADR-004
 */

import reset from './reset.js';
import { readout } from './decision.js';

/**
 * Clamps state values and recomputes combined conviction.
 *
 * @param {Object} state - Node state
 * @returns {boolean} Always returns true
 */
const recompute = function ( state ) {
    const charges = state.charges;
    const membranes = state.membranes;
    const n = state.sourceCount;

    // ── NaN Catastrophe Check ───────────────────────────────────────────────
    // Check L1 charges, L1 membranes, and L2 membrane
    if ( Number.isNaN( state.l2Membrane ) ) {
        reset( state );
        return true;
    }

    for ( let i = 0; i < n; i += 1 ) {
        if ( Number.isNaN( charges[ i ] ) || Number.isNaN( membranes[ i ] ) ) {
            reset( state );
            return true;
        }
    }

    // ── Clamp L1 Charges to [0, 1] ─────────────────────────────────────────
    for ( let i = 0; i < n; i += 1 ) {
        if ( charges[ i ] > 1 ) {
            charges[ i ] = 1;
        } else if ( charges[ i ] < 0 ) {
            charges[ i ] = 0;
        }
    }

    // ── Floor L1 Membranes at 0 ─────────────────────────────────────────────
    for ( let i = 0; i < n; i += 1 ) {
        if ( membranes[ i ] < 0 ) {
            membranes[ i ] = 0;
        }
    }

    // ── Floor L2 Membrane at 0 ──────────────────────────────────────────────
    if ( state.l2Membrane < 0 ) {
        state.l2Membrane = 0;
    }

    // ── Recompute Conviction via MM Readout ─────────────────────────────────
    state.combined = readout( state.l2Membrane, state.l2Theta );

    // ── Reclassify State ────────────────────────────────────────────────────
    const levels = state.thresholdLevels;
    state.stateName = 'Normal';
    for ( let i = levels.length - 1; i >= 0; i -= 1 ) {
        if ( state.combined >= levels[ i ].at ) {
            state.stateName = levels[ i ].name;
            break;
        }
    }

    return true;
}; // recompute()

export default recompute;

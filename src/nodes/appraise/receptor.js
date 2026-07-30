// nodes/appraise/receptor.js

/**
 * @fileoverview L1 receptor neuron processing for the SNN appraise architecture.
 *
 * Each source has three parallel channels driven from the same MM-normalised input:
 *   LIF (Leaky Integrate-and-Fire) — graded spikes forwarded to L2 decision neuron
 *   BLI (Bounded Leaky Integrator) — charge in [0, 1] for intensity explanation
 *   Rate — smoothed firing count for persistence explanation
 *
 * LIF uses reset-by-subtraction: on spike, V -= Vth, carrying excess potential
 * into the next cycle. The graded spike value equals V at the moment of firing
 * (before subtraction), preserving magnitude information through to L2.
 *
 * Both functions are stateless, zero-alloc, and hot-path safe.
 *
 * @see Gerstner, W. & Kistler, W.M. (2002). Spiking Neuron Models. Cambridge.
 */

import { integrate } from './integrate.js';

/**
 * Processes one receptor neuron: LIF spike + BLI integration + Rate tracking.
 * Called when a valid, finite input is available for source i.
 *
 * @param {Object} state - Node state (mutated: membranes, spikes, fired, charges, rates)
 * @param {number} i - Source index
 * @param {number} norm - MM-normalised input from [0, 1)
 * @param {number} decayFactor - exp( -dt / tau_i ), from [0, 1]
 */
const processReceptor = function ( state, i, norm, decayFactor ) {
    // ── LIF Channel ─────────────────────────────────────────────────────────
    let v = ( state.membranes[ i ] * decayFactor ) + norm;

    if ( v >= state.VTH ) {
        state.spikes[ i ] = v;
        state.fired[ i ] = 1;
        v -= state.VTH;
    } else {
        state.spikes[ i ] = 0;
        state.fired[ i ] = 0;
    }

    state.membranes[ i ] = v;

    // ── BLI Channel (intensity) ─────────────────────────────────────────────
    state.charges[ i ] = integrate( state.charges[ i ], norm, decayFactor );

    // ── Rate Channel (persistence) ──────────────────────────────────────────
    state.rates[ i ] = ( state.rates[ i ] * decayFactor ) + state.fired[ i ];
}; // processReceptor()

/**
 * Pure decay on all channels when no valid input is available for source i.
 * No spike is emitted, and the fired flag is cleared.
 *
 * @param {Object} state - Node state (mutated: membranes, spikes, fired, charges, rates)
 * @param {number} i - Source index
 * @param {number} decayFactor - exp( -dt / tau_i ), from [0, 1]
 */
const decayReceptor = function ( state, i, decayFactor ) {
    state.membranes[ i ] *= decayFactor;
    state.charges[ i ] *= decayFactor;
    state.rates[ i ] *= decayFactor;
    state.spikes[ i ] = 0;
    state.fired[ i ] = 0;
}; // decayReceptor()

export { processReceptor, decayReceptor };

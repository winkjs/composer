// nodes/appraise/decision.js

/**
 * @fileoverview L2 decision neuron for the SNN appraise architecture.
 *
 * A single non-spiking neuron that accumulates weighted spike input from
 * all L1 receptor neurons. Signed weights enable excitatory (+) and
 * inhibitory (-) synapses — failure evidence drives conviction up,
 * recovery evidence drives it down.
 *
 * Pipeline: synaptic current -> leaky membrane -> MM readout.
 *   I2 = sum( wi * si ) / sum( |wi| )   normalised synaptic current
 *   V2 = max( 0, V2 * decay + I2 )      unbounded leaky accumulation, floored at 0
 *   conviction = V2 / ( V2 + Theta )     MM readout bounds to [0, 1)
 *
 * All functions are pure, stateless, and zero-alloc.
 *
 * @see Dayan, P. & Abbott, L.F. (2001). Theoretical Neuroscience. MIT Press.
 */

/**
 * Computes normalised synaptic current from L1 graded spikes.
 * Signed weights allow excitatory (positive) and inhibitory (negative) inputs.
 *
 * @param {Float64Array} spikes - Per-source graded spike values
 * @param {Float64Array} weights - Signed weights (+ excitatory, - inhibitory)
 * @param {number} totalAbsWeight - Pre-computed sum( |wi| )
 * @param {number} n - Source count
 * @returns {number} Normalised synaptic current I2
 */
const computeSynapticCurrent = function ( spikes, weights, totalAbsWeight, n ) {
    let sum = 0;
    for ( let i = 0; i < n; i += 1 ) {
        sum += weights[ i ] * spikes[ i ];
    }
    return sum / totalAbsWeight;
}; // computeSynapticCurrent()

/**
 * Updates the L2 membrane potential with leaky accumulation.
 * Floors at zero — negative conviction is not meaningful.
 *
 * @param {number} membrane - Current V2
 * @param {number} current - Synaptic current I2
 * @param {number} decayFactor - exp( -dt / tau2 )
 * @returns {number} Updated V2, always >= 0
 */
const updateMembrane = function ( membrane, current, decayFactor ) {
    const v = ( membrane * decayFactor ) + current;
    return v > 0 ? v : 0;
}; // updateMembrane()

/**
 * Michaelis-Menten readout — bounds unbounded membrane to [0, 1).
 * Guards against theta <= 0 (returns 0 to prevent division by zero).
 *
 * @param {number} membrane - V2, always >= 0
 * @param {number} theta - Half-saturation constant (must be > 0)
 * @returns {number} Conviction from [0, 1)
 */
const readout = function ( membrane, theta ) {
    if ( theta <= 0 ) return 0;
    return membrane / ( membrane + theta );
}; // readout()

export { computeSynapticCurrent, updateMembrane, readout };

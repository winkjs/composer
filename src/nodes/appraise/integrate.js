// nodes/appraise/integrate.js

/**
 * @fileoverview Pure functions for MM normalization and leaky integration.
 *
 * Both functions are stateless, zero-alloc, and used in the hot-path loop.
 *
 * MM normalization — Michaelis-Menten saturation:
 *   n = d / ( d + θ )
 * Properties: bounded [0, 1), output = 0.5 when d = θ.
 *
 * Integration — two-step: decay first, inject into post-decay headroom:
 *   charge = decayed + n × ( 1 - decayed )
 * This guarantees charge ∈ [0, 1] — the ceiling is provably unreachable
 * from below because injection fills only a fraction of the headroom.
 *
 * @see Michaelis, L. & Menten, M.L. (1913). Die Kinetik der Invertinwirkung.
 */

/**
 * Michaelis-Menten saturation. Maps non-negative deviation to [0, 1).
 *
 * @param {number} deviation - Non-negative deviation (from deviation closure)
 * @param {number} theta - Half-saturation constant (output = 0.5 when d = θ)
 * @returns {number} Normalised signal ∈ [0, 1)
 */
const normalise = function ( deviation, theta ) {
    return deviation / ( deviation + theta );
}; // normalise()

/**
 * Bounded leaky integration. Decays existing charge, then injects
 * normalised signal into the post-decay headroom.
 *
 * @param {number} charge - Current charge ∈ [0, 1]
 * @param {number} normalised - MM-normalised signal ∈ [0, 1)
 * @param {number} decayFactor - exp( -Δt / τ ), ∈ [0, 1]
 * @returns {number} Updated charge ∈ [0, 1]
 */
const integrate = function ( charge, normalised, decayFactor ) {
    const decayed = charge * decayFactor;
    return decayed + ( normalised * ( 1 - decayed ) );
}; // integrate()

export { normalise, integrate };

/**
 * Shared test fixtures for es-pairwise-correlation node tests.
 * Provides factory functions, deterministic RNG, and constants reused
 * across all test files.
 */
import * as ecv from '../index.js';

// ---------- Constants ----------
export const EPS = 1e-12;

// ---------- Math helpers ----------

export const isClose = function ( a, b, eps = EPS ) {
    return Math.abs( a - b ) <= eps;
};

/**
 * Derive alpha from half-life using the same formula as the node:
 * alpha = 1 - 2^(-1/HL) === -expm1( -ln(2)/HL )
 */
export const alphaFromHL = function ( hl ) {
    return ( hl > 0 ) ? ( -Math.expm1( -( Math.LN2 / hl ) ) ) : NaN;
};

// ---------- Message / run helpers ----------

/**
 * Build a prototype-free message from field names and values.
 * @param {string[]} fields - Field names.
 * @param {number[]} values - Corresponding values.
 * @returns {object} Message object.
 */
export const msgFrom = function ( fields, values ) {
    const m = Object.create( null );
    for ( let i = 0; i < fields.length; i += 1 ) {
        m[ fields[ i ] ] = values[ i ];
    }
    return m;
};

/**
 * Feed a sequence of value arrays through update.
 * @param {object} state - Node state.
 * @param {string[]} fields - Field names.
 * @param {number[][]} seq - Array of value arrays.
 */
export const steadyRun = function ( state, fields, seq ) {
    for ( let i = 0; i < seq.length; i += 1 ) {
        ecv.update( state, msgFrom( fields, seq[ i ] ) );
    }
};

// ---------- Deterministic RNG ----------

/**
 * Park-Miller minimal standard LCG: reproducible U(0,1).
 * @param {number} [seedInit=20250919] - Initial seed.
 * @returns {function} RNG function returning values in (0, 1).
 */
export const createRng = function ( seedInit = 20250919 ) {
    let seed = seedInit % 0x7fffffff;
    if ( seed <= 0 ) {
        seed += 0x7fffffff - 1;
    }
    return function () {
        seed = ( seed * 48271 ) % 0x7fffffff;
        return seed / 0x7fffffff;
    };
};

/**
 * Box-Muller transform for N(0,1) using a given RNG.
 * @param {function} rng - Uniform RNG function.
 * @returns {function} Gaussian RNG function.
 */
export const createRandn = function ( rng ) {
    let spare = null;
    return function () {
        if ( spare !== null ) {
            const z = spare;
            spare = null;
            return z;
        }
        let u = 0;
        let v = 0;
        while ( u === 0 ) {
            u = rng();
        }
        while ( v === 0 ) {
            v = rng();
        }
        const mag = Math.sqrt( -2 * Math.log( u ) );
        const z0 = mag * Math.cos( 2 * Math.PI * v );
        const z1 = mag * Math.sin( 2 * Math.PI * v );
        spare = z1;
        return z0;
    };
};

/**
 * Sample from N(mu, sigma).
 * @param {function} randn - Gaussian RNG function.
 * @param {number} mu - Mean.
 * @param {number} sigma - Standard deviation.
 * @returns {number} Sample.
 */
export const normal = function ( randn, mu, sigma ) {
    return mu + ( sigma * randn() );
};

// core/source-manager/test-harness/prng.js

/* eslint-disable no-bitwise -- Mulberry32 is fundamentally a bit-shuffling PRNG; bitwise ops are intentional and load-bearing. */

/**
 * @fileoverview Seeded random number generator for testHarness.
 *
 * Tests need to be reproducible: the same seed must give the same
 * sequence of numbers every run. We use Mulberry32 — a small, fast
 * generator with 32-bit state. Good enough for test data; not
 * suitable for anything cryptographic.
 *
 * Reference: https://github.com/bryc/code/blob/master/jshash/PRNGs.md
 */

/**
 * Builds a random-number generator from a numeric seed.
 *
 * @param {number} seed - any finite number; same seed → same sequence
 * @returns {{next: function(): number, intInRange: function(number, number): number, floatInRange: function(number, number): number, pickFrom: function(Array): *}}
 */
export const createPrng = function ( seed ) {
    // Force the seed into an unsigned 32-bit integer so the maths
    // below behaves the same on every platform.
    let state = seed >>> 0;

    const next = function () {
        state = ( state + 0x6D2B79F5 ) | 0;
        let t = state;
        t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
        t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
        return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
    };

    /**
     * Whole number in the inclusive range [min, max].
     */
    const intInRange = function ( min, max ) {
        return Math.floor( min + ( next() * ( ( max - min ) + 1 ) ) );
    };

    /**
     * Decimal number in the half-open range [min, max).
     */
    const floatInRange = function ( min, max ) {
        return min + ( next() * ( max - min ) );
    };

    /**
     * Picks one element from a non-empty array.
     */
    const pickFrom = function ( arr ) {
        return arr[ Math.floor( next() * arr.length ) ];
    };

    return { next, intInRange, floatInRange, pickFrom };
};

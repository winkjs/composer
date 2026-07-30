// Shared test fixtures for es-stats node tests.
// Provides factory functions and constants reused across test files.
/* eslint-disable no-bitwise */

import { readFileSync } from 'fs';

/**
 * Build a message object with a single keyed field.
 * Uses Object.create( null ) for prototype-free message objects.
 * @param {string} key - Key for the value.
 * @param {number} [value] - Value (omitted if undefined).
 * @returns {object} Message object.
 */
export const buildMsg = function ( key, value ) {
    const m = Object.create( null );
    if ( value !== undefined ) m[ key ] = value;
    return m;
};

/**
 * Deterministic 32-bit XorShift PRNG.
 * Returns values in (0, 1) — same range as Math.random().
 * @param {number} seed - 32-bit seed value.
 * @returns {Function} next() returning the next pseudo-random number.
 */
export const makeXorShift32 = function ( seed ) {
    let s = ( seed >>> 0 ) || 0x9E3779B9;
    const next = function () {
        s ^= ( s << 13 ) >>> 0;
        s ^= ( s >>> 17 ) >>> 0;
        s ^= ( s << 5 ) >>> 0;
        return ( ( s >>> 0 ) + 1 ) / 4294967297;
    };
    return next;
};

/**
 * Load the golden-truth JSON using import.meta.url for ESM compatibility.
 * @param {string} metaUrl - Caller's import.meta.url.
 * @returns {object} Parsed golden-truth data.
 */
export const loadGoldenTruth = function ( metaUrl ) {
    return JSON.parse(
        readFileSync( new URL( './golden-truth-es-stats.json', metaUrl ), 'utf8' )
    );
};

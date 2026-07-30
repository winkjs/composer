// nodes/appraise/deviation.js

/**
 * @fileoverview Pure deviation functions for the SNN appraise node.
 *
 * Each deviation type converts a raw detection signal into a non-negative
 * "badness" value. All five functions are module-level singletons shared
 * across every partition instance — no per-instance closures.
 *
 * The monomorphic dispatch function `computeDeviation` uses a switch on
 * dense integer type indices (0–4), enabling V8 to generate a jump table
 * and inline the entire dispatch into the caller's loop.
 *
 * Parameter encoding for typed arrays:
 *   identity, absolute       — p1 and p2 unused (0 from Float64Array default)
 *   highExceedance           — p1 = baseline
 *   lowExceedance            — p1 = baseline
 *   bandExceedance           — p1 = lower, p2 = upper
 */

// ── Type Constants (dense integers for switch jump table) ───────────────────

const IDENTITY = 0;
const ABSOLUTE = 1;
const HIGH_EXCEEDANCE = 2;
const LOW_EXCEEDANCE = 3;
const BAND_EXCEEDANCE = 4;

// ── Deviation Type Set (consumed by introspect.js for validation) ───────────

const DEVIATION_TYPES = new Set( [
    'identity',
    'absolute',
    'highExceedance',
    'lowExceedance',
    'bandExceedance'
] );

// ── String-to-Index Lookup (used at init time only) ─────────────────────────

const DEVIATION_TYPE_INDEX = Object.create( null );
DEVIATION_TYPE_INDEX.identity = IDENTITY;
DEVIATION_TYPE_INDEX.absolute = ABSOLUTE;
DEVIATION_TYPE_INDEX.highExceedance = HIGH_EXCEEDANCE;
DEVIATION_TYPE_INDEX.lowExceedance = LOW_EXCEEDANCE;
DEVIATION_TYPE_INDEX.bandExceedance = BAND_EXCEEDANCE;

// ── Pure Deviation Functions (module-level, shared across all instances) ────

/**
 * Identity — raw is already non-negative badness. Clamps negative to 0.
 *
 * @param {number} raw - Raw signal value
 * @returns {number} Non-negative deviation
 */
const identity = ( raw ) => ( raw > 0 ? raw : 0 );

/**
 * Absolute — both directions are bad.
 *
 * @param {number} raw - Raw signal value
 * @returns {number} Non-negative deviation
 */
const absolute = ( raw ) => Math.abs( raw );

/**
 * High exceedance — only exceeding a baseline is bad.
 *
 * @param {number} raw - Raw signal value
 * @param {number} baseline - Reference value (p1)
 * @returns {number} Non-negative deviation
 */
const highExceedance = function ( raw, baseline ) {
    const d = raw - baseline;
    return d > 0 ? d : 0;
}; // highExceedance()

/**
 * Low exceedance — only dropping below a baseline is bad.
 *
 * @param {number} raw - Raw signal value
 * @param {number} baseline - Reference value (p1)
 * @returns {number} Non-negative deviation
 */
const lowExceedance = function ( raw, baseline ) {
    const d = baseline - raw;
    return d > 0 ? d : 0;
}; // lowExceedance()

/**
 * Band exceedance — normal is a range; either direction is bad.
 *
 * @param {number} raw - Raw signal value
 * @param {number} lower - Lower bound of normal range (p1)
 * @param {number} upper - Upper bound of normal range (p2)
 * @returns {number} Non-negative deviation
 */
const bandExceedance = function ( raw, lower, upper ) {
    const above = raw - upper;
    const below = lower - raw;
    return ( above > 0 ? above : 0 ) + ( below > 0 ? below : 0 );
}; // bandExceedance()

// ── Monomorphic Dispatch ────────────────────────────────────────────────────

/**
 * Computes deviation via switch dispatch on integer type index.
 * V8 compiles dense-integer switch as a jump table; the single call site
 * is monomorphic, so the entire function (including named function calls)
 * is inlined into the caller's loop body.
 *
 * @param {number} type - Deviation type index (0–4, from Uint8Array)
 * @param {number} raw - Raw signal value
 * @param {number} p1 - Parameter 1 (baseline or band.lower, 0 if unused)
 * @param {number} p2 - Parameter 2 (band.upper, 0 if unused)
 * @returns {number} Non-negative deviation
 */
const computeDeviation = function ( type, raw, p1, p2 ) {
    switch ( type ) {
        case IDENTITY:
            return identity( raw );
        case ABSOLUTE:
            return absolute( raw );
        case HIGH_EXCEEDANCE:
            return highExceedance( raw, p1 );
        case LOW_EXCEEDANCE:
            return lowExceedance( raw, p1 );
        case BAND_EXCEEDANCE:
            return bandExceedance( raw, p1, p2 );
        default:
            return 0;
    }
}; // computeDeviation()

export {
    computeDeviation,
    identity, absolute, highExceedance, lowExceedance, bandExceedance,
    DEVIATION_TYPES, DEVIATION_TYPE_INDEX,
    IDENTITY, ABSOLUTE, HIGH_EXCEEDANCE, LOW_EXCEEDANCE, BAND_EXCEEDANCE
};

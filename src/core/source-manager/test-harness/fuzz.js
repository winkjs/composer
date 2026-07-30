// core/source-manager/test-harness/fuzz.js

/**
 * @fileoverview Fuzz patterns for testHarness.
 *
 * When a test enables fuzz, the harness injects one bad value into
 * the target column every Nth message. The patterns below are the
 * minimal set we agreed on — common ways production data goes wrong
 * (null, NaN, JS quirks). For each fuzz message, the harness picks
 * one pattern in rotation, so over the run every pattern gets
 * exercised the same number of times.
 *
 * If the chosen pattern does not make sense for the target field's
 * type (for example, NaN on a string field), we fall back to null —
 * always valid, always a useful "bad value" — so the rotation
 * still progresses.
 *
 * Both the pattern set and the null fallback were settled as design
 * decisions on 2026-04-29.
 */

/**
 * Names of the six fuzz patterns, in rotation order.
 * @type {string[]}
 */
export const FUZZ_PATTERN_NAMES = [
    'null',
    'NaN',
    'string-where-number',
    'undefined',
    'infinity',
    'empty-string'
];

const FUZZ_VALUES = {
    'null': null,
    'NaN': NaN,
    'string-where-number': 'not-a-number',
    'undefined': undefined,
    'infinity': Infinity,
    'empty-string': ''
};

/**
 * Tells whether a given fuzz pattern makes sense for a given
 * declared field type. Patterns that do not match the type fall
 * back to null at injection time.
 *
 * @param {string} patternName
 * @param {string} fieldType - 'float64' | 'int64' | 'bool' | 'string' | 'timestamp'
 * @returns {boolean}
 */
export const isCompatible = function ( patternName, fieldType ) {
    switch ( patternName ) {
        case 'null':
        case 'undefined':
            return true;
        case 'NaN':
        case 'infinity':
            return fieldType === 'float64';
        case 'string-where-number':
            return fieldType === 'float64' || fieldType === 'int64';
        case 'empty-string':
            return fieldType === 'string';
        default:
            return false;
    }
};

/**
 * Replaces the target column on the message with a fuzz value, and
 * adds a `_harnessFuzzPattern` field naming the pattern that was
 * applied. Mutates `msg` in place.
 *
 * @param {Object} msg          - The message being built
 * @param {string} fuzzTarget   - Name of the column to fuzz
 * @param {Object} targetSpec   - The target column's spec from messageTemplate.fields
 * @param {number} patternIndex - Index into FUZZ_PATTERN_NAMES (rotates)
 */
export const applyFuzz = function ( msg, fuzzTarget, targetSpec, patternIndex ) {
    const patternName = FUZZ_PATTERN_NAMES[ patternIndex ];
    const compatible = isCompatible( patternName, targetSpec.type );
    const value = compatible ? FUZZ_VALUES[ patternName ] : null;

    msg[ fuzzTarget ] = value;
    msg._harnessFuzzPattern = patternName;  // eslint-disable-line no-underscore-dangle
};

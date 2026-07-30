// core/source-manager/test-harness/field-generator.js

/**
 * @fileoverview Generates one value for one field of a generated message.
 *
 * Each call returns a value of the field's declared type, drawn from
 * the random generator (or built from message index for timestamps).
 * Float values snap to the declared resolution so the harness's output
 * matches what real sensors would produce — and what QuestDB will
 * store after its own quantization.
 *
 * The field spec shape (`type`, `range`, `resolution`, `values`) is
 * enforced at startup by `validate.js` (FIELD_SPEC_SCHEMA).
 */

const generateFloat = function ( spec, prng ) {
    const range = spec.range || [ 0, 1 ];
    const raw = prng.floatInRange( range[ 0 ], range[ 1 ] );
    if ( spec.resolution ) {
        // Snap to grid. Sensors quantize, so generated data should
        // too — otherwise the cross-sink check fails on values that
        // QuestDB rounds and terminal does not.
        return Math.round( raw / spec.resolution ) * spec.resolution;
    }
    return raw;
};

const generateInt = function ( spec, prng ) {
    const range = spec.range || [ 0, 100 ];
    return prng.intInRange( range[ 0 ], range[ 1 ] );
};

const generateBool = function ( spec, prng ) {
    if ( spec.values ) {
        return prng.pickFrom( spec.values );
    }
    return prng.next() < 0.5;
};

const generateString = function ( spec, prng ) {
    // Strings always need an explicit `values` list — validate.js
    // enforces this at startup.
    return prng.pickFrom( spec.values );
};

const generateTimestamp = function ( spec, msgIndex, intervalMs ) {
    if ( spec.mode === 'static' ) {
        return spec.seedValue || 0;
    }
    // monotonic-ms (default): timestamps go up by the message
    // gap, or 1ms per message when the harness is running flat
    // out (intervalMs = 0). First message gets the seed value.
    const start = spec.seedValue || 0;
    const step = ( intervalMs > 0 ) ? intervalMs : 1;
    return start + ( ( msgIndex - 1 ) * step );
};

/**
 * Returns one generated value for the given field spec.
 *
 * @param {Object} fieldSpec  - One entry from messageTemplate.fields
 * @param {Object} prng       - The random generator (from prng.js)
 * @param {number} msgIndex   - 1-based index of the current message
 * @param {number} intervalMs - Gap between messages; used as the
 *                              timestamp step for monotonic-ms mode
 * @returns {*} A value of the declared type
 */
export const generateField = function ( fieldSpec, prng, msgIndex, intervalMs ) {
    switch ( fieldSpec.type ) {
        case 'float64':
            return generateFloat( fieldSpec, prng );
        case 'int64':
            return generateInt( fieldSpec, prng );
        case 'bool':
            return generateBool( fieldSpec, prng );
        case 'string':
            return generateString( fieldSpec, prng );
        case 'timestamp':
            return generateTimestamp( fieldSpec, msgIndex, intervalMs );
        default:
            // Unreachable in practice — validate.js rejects unknown
            // types at startup. Kept for clarity at the boundary.
            throw new Error( `testHarness: unknown field type "${fieldSpec.type}"` );
    }
};

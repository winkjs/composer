// core/source-manager/record-shape.js

/**
 * @fileoverview One definition of "usable record" for every source.
 *
 * A source hands the pipeline record objects. A decoded payload or a
 * transform return can instead be a scalar, null, undefined, or a
 * bare array. All of those are valid JSON documents, so decoding
 * alone cannot reject them. Attaching metadata to them throws in
 * strict mode. This module gives every source the same two tools:
 * the guard predicate, and the plain name of the rejected shape for
 * the per-record report (skip-classify-continue, ADR-018).
 *
 * Kept as one shared module so the MQTT and CSV sources cannot
 * drift apart on what a usable record is (the cross-source
 * transform contract).
 */

/**
 * Tell whether a decoded value can carry pipeline fields: a real
 * object, not null, not an array. Hot-path cost is one comparison,
 * one typeof, and one Array.isArray — no allocation.
 *
 * @param {*} value - Decoded payload or transform return
 * @returns {boolean} True when the value is a usable record
 */
const isUsableRecord = function ( value ) {
    return ( value !== null ) && ( typeof value === 'object' ) && !Array.isArray( value );
};

/**
 * Name a rejected value's shape for an operator-facing report.
 * Called on the failure path only, so the string cost is fine.
 *
 * @param {*} value - The rejected value
 * @returns {string} Plain shape name, e.g. 'a number', 'an array'
 */
const describeShape = function ( value ) {
    if ( value === null ) {
        return 'null';
    }
    if ( value === undefined ) {
        return 'undefined';
    }
    if ( Array.isArray( value ) ) {
        return 'an array';
    }
    return `a ${typeof value}`;
};

// ============================================================================
// EXPORTS
// ============================================================================

export { isUsableRecord, describeShape };

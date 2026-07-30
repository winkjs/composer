// core/partition-manager/validate-flow.js

/**
 * @fileoverview Fail-fast validation of the `flow` object handed to
 * partition-manager's `init()`.
 *
 * Three live callers construct this object:
 *   - src/flow/run.js (production DSL — validated upstream)
 *   - composer-website/apps/docs/lib/demo-runner.js (hand-constructed)
 *   - composer-website/apps/docs/lib/benchmark-runner.js (hand-constructed)
 *
 * The last two bypass the DSL, so this module is their only contract
 * enforcement point. Invalid shapes here used to surface as silent
 * drops or late-throw errors on the first message; they now fail at
 * flow start with an aggregated error list.
 *
 * Contract:
 *   - partitionField        : null | non-empty string
 *   - specializationField   : null | non-empty string
 *   - specsBySpecialization : non-null object, ≥ 1 own key,
 *                             each value is a non-empty array
 *   - nodeModules           : non-null object
 *   - yieldThreshold        : number ≥ 0 (Infinity accepted — the
 *                             documented "never yield" sentinel used
 *                             by website benchmark / demo runners)
 *   - unknown top-level keys rejected (catches typos such as
 *     `yieldThreshhold: 100` that would otherwise silently disable
 *     yielding through a NaN comparison)
 *
 * Stricter checks (e.g. identifier-shape field names) are delegated to
 * the flow DSL. Partition-manager's guard is defence-in-depth, not a
 * re-implementation.
 */

import { validateWithSchema, validators } from '../utils/validate/index.js';

// Keys accepted at the top level. Anything else is rejected as a typo
// via _propertyNames whitelist enforcement in validateWithSchema.
const PROPERTY_NAMES = [
    'partitionField',
    'specializationField',
    'specsBySpecialization',
    'nodeModules',
    'yieldThreshold'
];

/**
 * Accepts `null` (documented single-partition / single-specialization
 * sentinel) or a non-empty string (field name for `msg[field]` lookup).
 *
 * @param { * } v - Value under validation.
 * @returns { boolean } True when shape is acceptable.
 */
const isNullOrNonEmptyString = function ( v ) {
    return v === null || ( typeof v === 'string' && v.length > 0 );
}; // isNullOrNonEmptyString()

/**
 * Accepts a plain object (not null, not array) that carries at least
 * one own key, with every value being a non-empty array. This is the
 * minimum shape the graph-build branch of `update()` depends on.
 *
 * @param { * } v - Value under validation.
 * @returns { boolean } True when shape is acceptable.
 */
const isNonNullObjectWithSpecArrays = function ( v ) {
    if ( v === null ) {
        return false;
    }
    if ( typeof v !== 'object' ) {
        return false;
    }
    if ( Array.isArray( v ) ) {
        return false;
    }
    const keys = Object.keys( v );
    if ( keys.length === 0 ) {
        return false;
    }
    for ( let i = 0; i < keys.length; i += 1 ) {
        const specs = v[ keys[ i ] ];
        if ( !Array.isArray( specs ) ) {
            return false;
        }
        if ( specs.length === 0 ) {
            return false;
        }
    }
    return true;
}; // isNonNullObjectWithSpecArrays()

// Schema consumed by validateWithSchema. Fields that accept null do
// not carry a `type` so that the schema framework's custom validator
// runs for null values (the framework short-circuits type validators
// ahead of custom ones only when type is set and fails).
const flowSchema = {
    partitionField: {
        required: true,
        validator: isNullOrNonEmptyString,
        error: 'partitionField must be null or a non-empty string'
    },
    specializationField: {
        required: true,
        validator: isNullOrNonEmptyString,
        error: 'specializationField must be null or a non-empty string'
    },
    specsBySpecialization: {
        required: true,
        validator: isNonNullObjectWithSpecArrays,
        error: 'specsBySpecialization must be a non-null object with at least one specialization, each mapping to a non-empty spec array'
    },
    nodeModules: {
        type: 'object',
        required: true,
        error: 'nodeModules must be a non-null object'
    },
    yieldThreshold: {
        type: 'number',
        required: true,
        validator: validators.nonNegative,
        error: 'yieldThreshold must be a number >= 0 (Infinity allowed)'
    },
    _propertyNames: PROPERTY_NAMES
};

/**
 * Validates the flow config and throws TypeError on any violation.
 * The error message aggregates every problem found, not just the first.
 *
 * @param { * } flow - Flow config object.
 * @throws { TypeError } With aggregated error list on any violation.
 */
const validateFlow = function ( flow ) {
    // Pre-check: validateWithSchema iterates `key in object`, which
    // throws on null/undefined and behaves oddly on arrays. Handle
    // those root-level shape errors up front with the same error
    // format throwIfInvalid uses for consistency.
    if ( flow === null || flow === undefined || typeof flow !== 'object' || Array.isArray( flow ) ) {
        let actualType;
        if ( flow === null ) {
            actualType = 'null';
        } else if ( Array.isArray( flow ) ) {
            actualType = 'array';
        } else {
            actualType = typeof flow;
        }
        throw new TypeError(
            `WinkComposer/partitionManager validation failed:\n  flow: Expected object, got ${actualType}`
        );
    }

    const validation = validateWithSchema( flowSchema, flow, 'flow' );
    validation.throwIfInvalid( 'partitionManager' );
}; // validateFlow()

export default validateFlow;
export { validateFlow };

// flow/flow-api-schemas.js

/**
 * @fileoverview Schema definitions for flow API-level methods.
 *
 * These schemas provide robust validation for flow configuration methods
 * (assetId, yield, source, emitter, switch) using the same
 * validation framework used by nodes.
 *
 * Usage:
 * - Import schemas for use with validateWithSchema()
 * - Each schema validates the config object passed to the corresponding API method
 *
 * Note: `.assetClass(def)` validation does NOT live here. A shallow
 * flow-side assetClassSchema (wrapping `validAssetClass`) used to, but
 * it was removed; flow.js now calls the deep semantics schema
 * (`core/semantics/schemas/asset-class-schema.js`) directly. Both
 * entry paths — `loadSemantics()` reading JSON files and
 * hand-construction via `.assetClass()` — agree on the same SSOT for
 * what makes a valid asset class.
 */

import { validators, validateWithSchema } from '../core/utils/validate/index.js';

// ============================================================================
// CONSTANTS
// ============================================================================

// ============================================================================
// CUSTOM VALIDATORS
// ============================================================================

/**
 * Validates source adapter has required start() function.
 *
 * @param {Object} adapter - Source adapter module
 * @returns {boolean} True if adapter is valid
 */
const validSourceAdapter = function ( adapter ) {
    return (
        typeof adapter === 'object' &&
        adapter !== null &&
        typeof adapter.start === 'function'
    );
};

/**
 * Validates emitter adapter has required id and createEmitter() function.
 *
 * @param {Object} adapter - Emitter adapter module
 * @returns {boolean} True if adapter is valid
 */
const validEmitterAdapter = function ( adapter ) {
    return (
        typeof adapter === 'object' &&
        adapter !== null &&
        typeof adapter.id === 'string' &&
        adapter.id.length > 0 &&
        typeof adapter.createEmitter === 'function'
    );
};

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Schema for .assetId(field) validation.
 *
 * Validates:
 * - field is a non-empty string
 * - field is a valid JavaScript identifier
 *
 * @type {Object}
 */
export const assetIdSchema = {
    field: {
        type: 'string',
        required: true,
        validator: validators.identifier,
        error: 'assetId field must be a valid identifier (letters, numbers, _ or $, not starting with number)'
    }
};

/**
 * Schema for .yield(options) validation.
 *
 * Validates:
 * - options is an object (handled by wrapper)
 * - threshold is a non-negative number (milliseconds)
 *
 * @type {Object}
 */
export const yieldSchema = {
    threshold: {
        type: 'number',
        required: true,
        validator: validators.nonNegative,
        error: 'threshold must be a non-negative number (milliseconds)'
    }
};

/**
 * Schema for .yield(options) wrapper - validates options is an object.
 * Used with validateOptionsObject helper.
 *
 * @type {Object}
 */
export const yieldOptionsSchema = {
    options: {
        type: 'object',
        required: true,
        error: 'options must be an object'
    }
};

/**
 * Schema for .source(adapter, config) adapter validation.
 *
 * Validates:
 * - adapter is an object with start() function
 *
 * Note: Config validation uses adapter.configSchema if available.
 *
 * @type {Object}
 */
export const sourceAdapterSchema = {
    adapter: {
        type: 'object',
        required: true,
        validator: validSourceAdapter,
        error: 'source adapter must be an object with a start() function'
    }
};

/**
 * Schema for .emitter(adapter, config) adapter validation.
 *
 * Validates:
 * - adapter is an object with id (string) and createEmitter() function
 *
 * Note: Config validation uses adapter.configSchema if available.
 *
 * @type {Object}
 */
export const emitterAdapterSchema = {
    adapter: {
        type: 'object',
        required: true,
        validator: validEmitterAdapter,
        error: 'emitter adapter must have an id (string) and createEmitter() function'
    }
};

/**
 * Schema for .switch(field) validation.
 *
 * Validates:
 * - field is a non-empty string
 * - field is a valid JavaScript identifier
 *
 * @type {Object}
 */
export const switchSchema = {
    field: {
        type: 'string',
        required: true,
        validator: validators.identifier,
        error: 'switch field must be a valid identifier (letters, numbers, _ or $, not starting with number)'
    }
};

/**
 * Schema for .groupBy(field, values) field validation.
 *
 * `.groupBy()` is syntactic sugar over `.switch()`/`.case()` — its `field`
 * becomes the same specialization field — so it carries the identical
 * identifier contract. A dedicated schema (rather than reusing switchSchema)
 * keeps the error message method-accurate.
 *
 * Validates:
 * - field is a non-empty string
 * - field is a valid JavaScript identifier
 *
 * @type {Object}
 */
export const groupBySchema = {
    field: {
        type: 'string',
        required: true,
        validator: validators.identifier,
        error: 'groupBy field must be a valid identifier (letters, numbers, _ or $, not starting with number)'
    }
};

// .assetClass() validation does NOT live here.
//
// The shallow wrapper that used to live in this file was removed.
// `flow.assetClass(def)` now calls the deep semantics schema directly
// (imported from `core/semantics/schemas`), so both entry paths —
// loadSemantics() reading JSON files and hand-construction via
// .assetClass() — agree on the same SSOT for "what makes a valid asset
// class". See flow.js's .assetClass() implementation.

// ============================================================================
// VALIDATION HELPERS (following node/validate-spec.js pattern)
// ============================================================================

/**
 * Validates a config object against a schema.
 * Follows the same pattern as node/validate-spec.js but adds
 * an upfront check for null/undefined inputs since flow API
 * methods are called directly by users.
 *
 * @param {*} config - Config to validate
 * @param {Object} schema - Schema definition
 * @param {string} methodName - Flow method name for error messages (e.g., 'yield')
 * @returns {Object} Validation result with valid, errors, and throwIfInvalid
 */
export const validateFlowConfig = function ( config, schema, methodName ) {
    // Pre-check: config must be an object (cannot be validated by validateWithSchema)
    if ( config === null || config === undefined || typeof config !== 'object' ) {
        const actualType = config === null ? 'null' : typeof config;
        const errors = [ `${methodName}: Expected object, got ${actualType}` ];
        return {
            valid: false,
            errors,
            throwIfInvalid: () => {
                throw new Error( `WinkComposer/flow.${methodName}: ${errors[ 0 ]}` );
            }
        };
    }

    // Delegate to standard schema validation
    const validation = validateWithSchema( schema, config, methodName );

    // Wrap throwIfInvalid to use flow-specific error format
    return {
        valid: validation.valid,
        errors: validation.errors,
        throwIfInvalid: () => {
            if ( !validation.valid ) {
                throw new Error(
                    `WinkComposer/flow.${methodName}: validation failed:\n  - ${validation.errors.join( '\n  - ' )}`
                );
            }
        }
    };
};

/**
 * Validates an array config against a schema.
 * For flow methods where the input must be an array.
 *
 * @param {*} config - Config to validate (expected to be array)
 * @param {Object} schema - Schema definition (should have 'items' type)
 * @param {string} methodName - Flow method name for error messages
 * @returns {Object} Validation result
 */
export const validateFlowArrayConfig = function ( config, schema, methodName ) {
    // Pre-check: config must be an array
    if ( !Array.isArray( config ) ) {
        const actualType = config === null ? 'null' : typeof config;
        const errors = [ `${methodName}: Expected array, got ${actualType}` ];
        return {
            valid: false,
            errors,
            throwIfInvalid: () => {
                throw new Error( `WinkComposer/flow.${methodName}: ${errors[ 0 ]}` );
            }
        };
    }

    // Wrap array in object for schema validation
    const validation = validateWithSchema( schema, { items: config }, methodName );

    return {
        valid: validation.valid,
        errors: validation.errors,
        throwIfInvalid: () => {
            if ( !validation.valid ) {
                throw new Error(
                    `WinkComposer/flow.${methodName}: validation failed:\n  - ${validation.errors.join( '\n  - ' )}`
                );
            }
        }
    };
};

// ============================================================================
// EXPORTS FOR CUSTOM VALIDATORS (for reuse in tests)
// ============================================================================

// validAssetClass was removed — see comment near where the shallow
// assetClassSchema used to live. .assetClass() validation now
// goes through the deep semantics schema in core/semantics/schemas.
export const customValidators = {
    validSourceAdapter,
    validEmitterAdapter
};

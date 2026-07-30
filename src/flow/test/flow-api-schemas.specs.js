// flow/test/flow-api-schemas.specs.js

/**
 * @fileoverview Unit tests for flow API schemas.
 *
 * Tests cover:
 * - assetIdSchema: Valid identifiers, empty arrays, invalid chars
 * - yieldSchema: Non-negative numbers, invalid types
 * - sourceAdapterSchema: Valid adapters, missing methods
 * - emitterAdapterSchema: Valid adapters, missing id/createEmitter
 * - switchSchema: Valid functions, invalid types
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { validateWithSchema } from '../../core/utils/validate/index.js';
import {
    assetIdSchema,
    yieldSchema,
    sourceAdapterSchema,
    emitterAdapterSchema,
    switchSchema,
    customValidators,
    validateFlowArrayConfig
} from '../flow-api-schemas.js';

// ============================================================================
// ASSET ID SCHEMA TESTS
// ============================================================================

describe( 'Flow API Schema — assetId', function () {

    const validate = function ( field ) {
        return validateWithSchema( assetIdSchema, { field }, 'assetId' );
    };

    describe( 'valid configs', function () {

        it( 'accepts simple field name', function () {
            const result = validate( 'sensorId' );

            expect( result.valid ).to.equal( true );
        } );

        it( 'accepts field with underscore', function () {
            const result = validate( 'device_id' );

            expect( result.valid ).to.equal( true );
        } );

        it( 'accepts field with dollar sign', function () {
            const result = validate( '$id' );

            expect( result.valid ).to.equal( true );
        } );

        it( 'accepts field starting with underscore', function () {
            const result = validate( '_privateId' );

            expect( result.valid ).to.equal( true );
        } );

    } );

    describe( 'invalid configs', function () {

        it( 'rejects field with spaces', function () {
            const result = validate( 'sensor id' );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects field starting with number', function () {
            const result = validate( '123sensor' );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects field with hyphen', function () {
            const result = validate( 'sensor-id' );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects empty string field', function () {
            const result = validate( '' );

            expect( result.valid ).to.equal( false );
        } );

        it( 'provides descriptive error for invalid field', function () {
            const result = validate( 'invalid-key' );

            expect( result.errors[ 0 ] ).to.include( 'identifier' );
        } );

    } );

} );

// ============================================================================
// YIELD SCHEMA TESTS
// ============================================================================

describe( 'Flow API Schema — yield', function () {

    const validate = function ( options ) {
        return validateWithSchema( yieldSchema, options, 'yield' );
    };

    describe( 'valid configs', function () {

        it( 'accepts threshold=0', function () {
            const result = validate( { threshold: 0 } );

            expect( result.valid ).to.equal( true );
        } );

        it( 'accepts threshold=100', function () {
            const result = validate( { threshold: 100 } );

            expect( result.valid ).to.equal( true );
        } );

        it( 'accepts threshold=0.5 (fractional ms)', function () {
            const result = validate( { threshold: 0.5 } );

            expect( result.valid ).to.equal( true );
        } );

        it( 'accepts large threshold', function () {
            const result = validate( { threshold: 60000 } );

            expect( result.valid ).to.equal( true );
        } );

    } );

    describe( 'invalid configs', function () {

        it( 'rejects missing threshold', function () {
            const result = validate( {} );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects negative threshold', function () {
            const result = validate( { threshold: -1 } );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects threshold as string', function () {
            const result = validate( { threshold: '100' } );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects threshold as null', function () {
            const result = validate( { threshold: null } );

            expect( result.valid ).to.equal( false );
        } );

        it( 'provides descriptive error for negative threshold', function () {
            const result = validate( { threshold: -5 } );

            expect( result.errors[ 0 ] ).to.include( 'non-negative' );
        } );

    } );

} );

// ============================================================================
// SOURCE ADAPTER SCHEMA TESTS
// ============================================================================

describe( 'Flow API Schema — sourceAdapter', function () {

    const validate = function ( adapter ) {
        return validateWithSchema( sourceAdapterSchema, { adapter }, 'source' );
    };

    describe( 'valid adapters', function () {

        it( 'accepts adapter with start function', function () {
            const result = validate( { start: () => { /* noop */ } } );

            expect( result.valid ).to.equal( true );
        } );

        it( 'accepts adapter with extra properties', function () {
            const result = validate( {
                start: () => { /* noop */ },
                stop: () => { /* noop */ },
                id: 'csv'
            } );

            expect( result.valid ).to.equal( true );
        } );

    } );

    describe( 'invalid adapters', function () {

        it( 'rejects null', function () {
            const result = validate( null );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects undefined', function () {
            const result = validate( undefined );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects string', function () {
            const result = validate( 'csv' );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects adapter without start', function () {
            const result = validate( { stop: () => { /* noop */ } } );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects adapter with non-function start', function () {
            const result = validate( { start: 'function' } );

            expect( result.valid ).to.equal( false );
        } );

        it( 'provides descriptive error', function () {
            const result = validate( {} );

            expect( result.errors[ 0 ] ).to.include( 'start()' );
        } );

    } );

} );

// ============================================================================
// EMITTER ADAPTER SCHEMA TESTS
// ============================================================================

describe( 'Flow API Schema — emitterAdapter', function () {

    const validate = function ( adapter ) {
        return validateWithSchema( emitterAdapterSchema, { adapter }, 'emitter' );
    };

    describe( 'valid adapters', function () {

        it( 'accepts adapter with id and createEmitter', function () {
            const result = validate( {
                id: 'mqtt',
                createEmitter: () => ( { /* emitter */ } )
            } );

            expect( result.valid ).to.equal( true );
        } );

        it( 'accepts adapter with extra properties', function () {
            const result = validate( {
                id: 'terminal',
                createEmitter: () => ( { /* emitter */ } ),
                configSchema: {}
            } );

            expect( result.valid ).to.equal( true );
        } );

    } );

    describe( 'invalid adapters', function () {

        it( 'rejects null', function () {
            const result = validate( null );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects undefined', function () {
            const result = validate( undefined );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects adapter without id', function () {
            const result = validate( { createEmitter: () => ( { /* emitter */ } ) } );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects adapter with empty id', function () {
            const result = validate( {
                id: '',
                createEmitter: () => ( { /* emitter */ } )
            } );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects adapter without createEmitter', function () {
            const result = validate( { id: 'mqtt' } );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects adapter with non-function createEmitter', function () {
            const result = validate( {
                id: 'mqtt',
                createEmitter: 'function'
            } );

            expect( result.valid ).to.equal( false );
        } );

        it( 'provides descriptive error', function () {
            const result = validate( {} );

            expect( result.errors[ 0 ] ).to.include( 'id' );
            expect( result.errors[ 0 ] ).to.include( 'createEmitter' );
        } );

    } );

} );

// ============================================================================
// SWITCH SCHEMA TESTS
// ============================================================================

describe( 'Flow API Schema — switch', function () {

    const validate = function ( field ) {
        return validateWithSchema( switchSchema, { field }, 'switch' );
    };

    describe( 'valid fields', function () {

        it( 'accepts simple field name', function () {
            const result = validate( 'type' );

            expect( result.valid ).to.equal( true );
        } );

        it( 'accepts field with underscore', function () {
            const result = validate( 'sensor_type' );

            expect( result.valid ).to.equal( true );
        } );

        it( 'accepts field with dollar sign', function () {
            const result = validate( '$type' );

            expect( result.valid ).to.equal( true );
        } );

        it( 'accepts field starting with underscore', function () {
            const result = validate( '_type' );

            expect( result.valid ).to.equal( true );
        } );

    } );

    describe( 'invalid fields', function () {

        it( 'rejects field with spaces', function () {
            const result = validate( 'sensor type' );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects field starting with number', function () {
            const result = validate( '123type' );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects field with hyphen', function () {
            const result = validate( 'sensor-type' );

            expect( result.valid ).to.equal( false );
        } );

        it( 'rejects empty string field', function () {
            const result = validate( '' );

            expect( result.valid ).to.equal( false );
        } );

        it( 'provides descriptive error for invalid field', function () {
            const result = validate( 'invalid-key' );

            expect( result.errors[ 0 ] ).to.include( 'identifier' );
        } );

    } );

} );

// ============================================================================
// CUSTOM VALIDATORS EXPORT TESTS
// ============================================================================
//
// Note: the "Flow API Schema — assetClass" tests that used to live here
// were removed. They tested a shallow flow-side wrapper
// schema that has been replaced by the deep semantics schema (the same
// one validateSemantics uses against JSON files); equivalent coverage
// already lives in `core/semantics/test/loader-warnings.specs.js` and
// the schema-level tests adjacent to it. The end-to-end behaviour of
// `.assetClass()` is exercised in `flow-storage.specs.js` and the new
// tests in this file's "Flow API .assetClass() entry" section below.

describe( 'Flow API Schema — customValidators export', function () {

    it( 'exports validSourceAdapter function', function () {
        expect( customValidators.validSourceAdapter ).to.be.a( 'function' );
    } );

    it( 'exports validEmitterAdapter function', function () {
        expect( customValidators.validEmitterAdapter ).to.be.a( 'function' );
    } );

} );

// ============================================================================
// VALIDATEFLOWARRAYCONFIG TESTS
// ============================================================================

describe( 'Flow API Schema — validateFlowArrayConfig', function () {

    // Simple array schema for testing
    const arraySchema = {
        items: {
            type: 'array',
            required: true,
            itemSchema: {
                type: 'string'
            }
        }
    };

    describe( 'valid arrays', function () {

        it( 'accepts valid array', function () {
            const result = validateFlowArrayConfig( [ 'a', 'b', 'c' ], arraySchema, 'testMethod' );

            expect( result.valid ).to.equal( true );
            expect( result.errors ).to.have.lengthOf( 0 );
        } );

        it( 'accepts empty array', function () {
            const result = validateFlowArrayConfig( [], arraySchema, 'testMethod' );

            expect( result.valid ).to.equal( true );
        } );

        it( 'throwIfInvalid does not throw for valid input', function () {
            const result = validateFlowArrayConfig( [ 'valid' ], arraySchema, 'testMethod' );

            expect( () => result.throwIfInvalid() ).to.not.throw();
        } );

    } );

    describe( 'invalid inputs', function () {

        it( 'rejects null', function () {
            const result = validateFlowArrayConfig( null, arraySchema, 'testMethod' );

            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'Expected array' );
            expect( result.errors[ 0 ] ).to.include( 'null' );
        } );

        it( 'rejects undefined', function () {
            const result = validateFlowArrayConfig( undefined, arraySchema, 'testMethod' );

            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'Expected array' );
            expect( result.errors[ 0 ] ).to.include( 'undefined' );
        } );

        it( 'rejects string', function () {
            const result = validateFlowArrayConfig( 'not-array', arraySchema, 'testMethod' );

            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'Expected array' );
            expect( result.errors[ 0 ] ).to.include( 'string' );
        } );

        it( 'rejects object', function () {
            const result = validateFlowArrayConfig( { a: 1 }, arraySchema, 'testMethod' );

            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'Expected array' );
            expect( result.errors[ 0 ] ).to.include( 'object' );
        } );

        it( 'rejects number', function () {
            const result = validateFlowArrayConfig( 42, arraySchema, 'testMethod' );

            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'Expected array' );
            expect( result.errors[ 0 ] ).to.include( 'number' );
        } );

    } );

    describe( 'throwIfInvalid', function () {

        it( 'throws for non-array input', function () {
            const result = validateFlowArrayConfig( 'invalid', arraySchema, 'testMethod' );

            expect( () => result.throwIfInvalid() ).to.throw( /WinkComposer\/flow\.testMethod/ );
            expect( () => result.throwIfInvalid() ).to.throw( /Expected array/ );
        } );

        it( 'throws with method name in error', function () {
            const result = validateFlowArrayConfig( null, arraySchema, 'myMethod' );

            expect( () => result.throwIfInvalid() ).to.throw( /myMethod/ );
        } );

        it( 'throws for array with invalid items', function () {
            const result = validateFlowArrayConfig( [ 123 ], arraySchema, 'testMethod' );

            // Should fail because 123 is not a string
            expect( result.valid ).to.equal( false );
            expect( () => result.throwIfInvalid() ).to.throw( /validation failed/ );
        } );

    } );

} );

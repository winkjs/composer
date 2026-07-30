// core/utils/validate/test/helpers.specs.js

/**
 * @fileoverview Tests for validation helper functions
 *
 * Tests cover:
 * - validateField: Field validation with type checking, constraints, nested objects/arrays
 * - checkExactValue: Exact value matching
 * - runCustomValidator: Custom validator execution
 * - Property names validation
 * - Item schema validation
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { validateField } from '../helpers.js';

describe( 'validateField', function () {

    // ========================================================================
    // TYPE VALIDATION
    // ========================================================================

    describe( 'type validation', function () {

        it( 'validates string type', function () {
            const errors = validateField( 'test', { type: 'string' }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails string type with number', function () {
            const errors = validateField( 123, { type: 'string' }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Expected string' );
        } );

        it( 'validates number type', function () {
            const errors = validateField( 42, { type: 'number' }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails number type with NaN', function () {
            const errors = validateField( NaN, { type: 'number' }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'NaN' );
        } );

        it( 'validates boolean type', function () {
            const errors = validateField( true, { type: 'boolean' }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails boolean type with string', function () {
            const errors = validateField( 'true', { type: 'boolean' }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Expected boolean' );
        } );

        it( 'validates function type', function () {
            const fn = function () {
                return 1;
            };
            const errors = validateField( fn, { type: 'function' }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails function type with non-function', function () {
            const errors = validateField( 'not a function', { type: 'function' }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Expected function' );
        } );

        it( 'validates function arity', function () {
            const fn = ( a, b ) => a + b;
            const errors = validateField( fn, { type: 'function', arity: 2 }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails function with wrong arity', function () {
            const fn = ( a ) => a;
            const errors = validateField( fn, { type: 'function', arity: 2 }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Expected function with 2 parameters' );
        } );

        it( 'validates array type', function () {
            const errors = validateField( [ 1, 2, 3 ], { type: 'array' }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails array type with object', function () {
            const errors = validateField( { a: 1 }, { type: 'array' }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Expected array' );
        } );

        it( 'validates object type', function () {
            const errors = validateField( { a: 1 }, { type: 'object' }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails object type with array', function () {
            const errors = validateField( [ 1 ], { type: 'object' }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Expected object' );
        } );

        it( 'fails object type with null', function () {
            const errors = validateField( null, { type: 'object' }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Expected object' );
            expect( errors[ 0 ] ).to.include( 'null' );
        } );

        it( 'early returns on type mismatch', function () {
            // If type check fails with "Expected", further validation should stop
            const errors = validateField( 'string', {
                type: 'number',
                min: 0,
                max: 100
            }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Expected number' );
        } );

    } );

    // ========================================================================
    // STRING CONSTRAINTS
    // ========================================================================

    describe( 'string constraints', function () {

        it( 'validates minLength', function () {
            const errors = validateField( 'abc', { type: 'string', minLength: 3 }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails minLength', function () {
            const errors = validateField( 'ab', { type: 'string', minLength: 3 }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Minimum length is 3' );
        } );

        it( 'validates maxLength', function () {
            const errors = validateField( 'abc', { type: 'string', maxLength: 5 }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails maxLength', function () {
            const errors = validateField( 'abcdef', { type: 'string', maxLength: 5 }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Maximum length is 5' );
        } );

        it( 'validates pattern', function () {
            const errors = validateField( 'hello', { type: 'string', pattern: /^[a-z]+$/ }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails pattern', function () {
            const errors = validateField( 'Hello', { type: 'string', pattern: /^[a-z]+$/ }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'does not match required pattern' );
        } );

    } );

    // ========================================================================
    // NUMBER CONSTRAINTS
    // ========================================================================

    describe( 'number constraints', function () {

        it( 'validates min', function () {
            const errors = validateField( 10, { type: 'number', min: 5 }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails min', function () {
            const errors = validateField( 3, { type: 'number', min: 5 }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Minimum value is 5' );
        } );

        it( 'validates max', function () {
            const errors = validateField( 50, { type: 'number', max: 100 }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails max', function () {
            const errors = validateField( 150, { type: 'number', max: 100 }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Maximum value is 100' );
        } );

        it( 'validates integer', function () {
            const errors = validateField( 42, { type: 'number', integer: true }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails integer', function () {
            const errors = validateField( 3.14, { type: 'number', integer: true }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Expected integer' );
        } );

    } );

    // ========================================================================
    // ARRAY CONSTRAINTS
    // ========================================================================

    describe( 'array constraints', function () {

        it( 'validates minItems', function () {
            const errors = validateField( [ 1, 2 ], { type: 'array', minItems: 2 }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails minItems', function () {
            const errors = validateField( [ 1 ], { type: 'array', minItems: 2 }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Minimum items is 2' );
        } );

        it( 'validates maxItems', function () {
            const errors = validateField( [ 1, 2 ], { type: 'array', maxItems: 3 }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails maxItems', function () {
            const errors = validateField( [ 1, 2, 3, 4 ], { type: 'array', maxItems: 3 }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Maximum items is 3' );
        } );

        it( 'validates array item schema', function () {
            const errors = validateField(
                [ 1, 2, 3 ],
                { type: 'array', itemSchema: { type: 'number' } },
                'field'
            );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails array item schema', function () {
            const errors = validateField(
                [ 1, 'two', 3 ],
                { type: 'array', itemSchema: { type: 'number' } },
                'field'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'field[1]' );
            expect( errors[ 0 ] ).to.include( 'Expected number' );
        } );

        it( 'validates all array items', function () {
            const errors = validateField(
                [ 'a', 123, true ],
                { type: 'array', itemSchema: { type: 'string' } },
                'field'
            );
            expect( errors ).to.have.lengthOf( 2 );
        } );

    } );

    // ========================================================================
    // OBJECT CONSTRAINTS
    // ========================================================================

    describe( 'object constraints', function () {

        it( 'validates minProperties', function () {
            const errors = validateField( { a: 1, b: 2 }, { type: 'object', minProperties: 2 }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails minProperties', function () {
            const errors = validateField( { a: 1 }, { type: 'object', minProperties: 2 }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Minimum properties is 2' );
        } );

        it( 'validates maxProperties', function () {
            const errors = validateField( { a: 1, b: 2 }, { type: 'object', maxProperties: 3 }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails maxProperties', function () {
            const errors = validateField(
                { a: 1, b: 2, c: 3, d: 4 },
                { type: 'object', maxProperties: 3 },
                'field'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Maximum properties is 3' );
        } );

        it( 'validates propertyNames', function () {
            const errors = validateField(
                { name: 'test', value: 42 },
                { type: 'object', propertyNames: [ 'name', 'value', 'type' ] },
                'field'
            );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails invalid propertyNames', function () {
            const errors = validateField(
                { name: 'test', invalid: 42 },
                { type: 'object', propertyNames: [ 'name', 'value' ] },
                'field'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Invalid property name' );
            expect( errors[ 0 ] ).to.include( 'invalid' );
        } );

        it( 'validates propertySchema for all properties', function () {
            const errors = validateField(
                { a: 1, b: 2, c: 3 },
                { type: 'object', propertySchema: { type: 'number' } },
                'field'
            );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails propertySchema validation', function () {
            const errors = validateField(
                { a: 1, b: 'two' },
                { type: 'object', propertySchema: { type: 'number' } },
                'field'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'field.b' );
            expect( errors[ 0 ] ).to.include( 'Expected number' );
        } );

        it( 'validates specific properties schema', function () {
            const errors = validateField(
                { name: 'test', value: 42 },
                {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        value: { type: 'number' }
                    }
                },
                'field'
            );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'validates required nested properties', function () {
            const errors = validateField(
                { name: 'test' },
                {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        value: { required: true, type: 'number' }
                    }
                },
                'field'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'field.value' );
            expect( errors[ 0 ] ).to.include( 'Required field missing' );
        } );

        it( 'validates nested property type', function () {
            const errors = validateField(
                { name: 123 },
                {
                    type: 'object',
                    properties: {
                        name: { type: 'string' }
                    }
                },
                'field'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'field.name' );
            expect( errors[ 0 ] ).to.include( 'Expected string' );
        } );

    } );

    // ========================================================================
    // EXACT VALUE
    // ========================================================================

    describe( 'exact value', function () {

        it( 'validates exact value match', function () {
            const errors = validateField( 'expected', { value: 'expected' }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails exact value mismatch', function () {
            const errors = validateField( 'wrong', { value: 'expected' }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Must be exactly' );
        } );

        it( 'validates exact numeric value', function () {
            const errors = validateField( 42, { value: 42 }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails strict equality check', function () {
            const errors = validateField( '42', { value: 42 }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
        } );

    } );

    // ========================================================================
    // CUSTOM VALIDATOR
    // ========================================================================

    describe( 'custom validator', function () {

        it( 'runs custom validator', function () {
            const errors = validateField(
                5,
                { validator: ( v ) => v > 0 },
                'field'
            );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails custom validator', function () {
            const errors = validateField(
                -5,
                { validator: ( v ) => v > 0, error: 'Must be positive' },
                'field'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.equal( 'Must be positive' );
        } );

        it( 'uses default error message when none provided', function () {
            const errors = validateField(
                -5,
                { validator: ( v ) => v > 0 },
                'field'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Validation failed' );
        } );

        it( 'passes full object to validator', function () {
            let receivedObject = null;
            const fullObject = { a: 1, b: 2 };
            const customValidator = function ( v, obj ) {
                receivedObject = obj;
                return true;
            };
            validateField(
                5,
                { validator: customValidator },
                'field',
                fullObject
            );
            expect( receivedObject ).to.equal( fullObject );
        } );

        it( 'handles validator that throws', function () {
            const throwingValidator = function () {
                throw new Error( 'Validator error' );
            };
            const errors = validateField(
                5,
                { validator: throwingValidator },
                'field'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Validator threw error' );
            expect( errors[ 0 ] ).to.include( 'Validator error' );
        } );

        it( 'skips validator for undefined value', function () {
            let called = false;
            const trackingValidator = function () {
                called = true;
                return false;
            };
            const errors = validateField(
                undefined,
                { validator: trackingValidator, error: 'Should not run' },
                'field'
            );
            expect( called ).to.equal( false );
            expect( errors ).to.deep.equal( [] );
        } );

    } );

    // ========================================================================
    // CUSTOM VALIDATOR ON A FIELD-KEYED MAP (per-entry application)
    // ========================================================================
    //
    // A custom validator describes one field's value. For a field-keyed-capable
    // type, a field-keyed map { field: value, ... } must have the validator run on
    // each entry's value, not on the whole map — otherwise a scalar check sees the
    // map object and always fails.

    describe( 'custom validator on a field-keyed map', function () {

        const positive = ( v ) => typeof v === 'number' && v > 0;

        it( 'applies the validator to each entry of a field-keyed map', function () {
            const errors = validateField(
                { temp: 5, pressure: 20 },
                { type: 'numberOrFieldKeyed', validator: positive, error: 'Must be positive' },
                'spec.opt'
            );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'reports a failing entry with a path that names the field', function () {
            const errors = validateField(
                { temp: 5, pressure: -3 },
                { type: 'numberOrFieldKeyed', validator: positive, error: 'Must be positive' },
                'spec.opt'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.equal( 'spec.opt.pressure: Must be positive' );
        } );

        it( 'reports every failing entry', function () {
            const errors = validateField(
                { temp: -1, pressure: -3 },
                { type: 'numberOrFieldKeyed', validator: positive, error: 'Must be positive' },
                'spec.opt'
            );
            expect( errors ).to.have.lengthOf( 2 );
            expect( errors[ 0 ] ).to.equal( 'spec.opt.temp: Must be positive' );
            expect( errors[ 1 ] ).to.equal( 'spec.opt.pressure: Must be positive' );
        } );

        it( 'uses a default per-field message when no error string is given', function () {
            const errors = validateField(
                { temp: -1 },
                { type: 'numberOrFieldKeyed', validator: positive },
                'spec.opt'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.equal( 'spec.opt.temp: Validation failed' );
        } );

        it( 'reports a throwing validator per entry with the field path', function () {
            const throwing = function () {
                throw new Error( 'boom' );
            };
            const errors = validateField(
                { temp: 5 },
                { type: 'numberOrFieldKeyed', validator: throwing },
                'spec.opt'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'spec.opt.temp: Validator threw error' );
            expect( errors[ 0 ] ).to.include( 'boom' );
        } );

        it( 'passes the full object to the validator for each entry', function () {
            const seen = [];
            const fullObject = { a: 1 };
            const spy = function ( v, obj ) {
                seen.push( obj );
                return true;
            };
            validateField(
                { temp: 5, pressure: 20 },
                { type: 'numberOrFieldKeyed', validator: spy },
                'spec.opt',
                fullObject
            );
            expect( seen ).to.have.lengthOf( 2 );
            expect( seen[ 0 ] ).to.equal( fullObject );
            expect( seen[ 1 ] ).to.equal( fullObject );
        } );

        it( 'runs a string enum validator per entry (oneOf pattern)', function () {
            const oneOf = ( v ) => [ 'sg5', 'trend5' ].includes( v );
            const ok = validateField(
                { temp: 'sg5' },
                { type: 'stringOrFieldKeyed', validator: oneOf, error: 'Unknown preset' },
                'spec.preset'
            );
            expect( ok ).to.deep.equal( [] );
            const bad = validateField(
                { temp: 'nope' },
                { type: 'stringOrFieldKeyed', validator: oneOf, error: 'Unknown preset' },
                'spec.preset'
            );
            expect( bad ).to.deep.equal( [ 'spec.preset.temp: Unknown preset' ] );
        } );

        it( 'runs the validator on a direct value as before (whole value, no path prefix)', function () {
            const errors = validateField(
                -5,
                { type: 'numberOrFieldKeyed', validator: positive, error: 'Must be positive' },
                'spec.opt'
            );
            expect( errors ).to.deep.equal( [ 'Must be positive' ] );
        } );

        it( 'treats a top-level function (tunable) as a whole value, not a map', function () {
            let receivedWholeFunction = false;
            const fn = () => 5;
            const spy = function ( v ) {
                receivedWholeFunction = ( v === fn );
                return true;
            };
            validateField(
                fn,
                { type: 'numberOrFunctionOrFieldKeyed', validator: spy },
                'spec.opt'
            );
            expect( receivedWholeFunction ).to.equal( true );
        } );

        it( 'does not treat an object as a map for a non-field-keyed type', function () {
            let receivedWholeObject = false;
            const obj = { min: 0, max: 10 };
            const spy = function ( v ) {
                receivedWholeObject = ( v === obj );
                return true;
            };
            validateField(
                obj,
                { type: 'objectOrFunction', validator: spy },
                'spec.opt'
            );
            expect( receivedWholeObject ).to.equal( true );
        } );

    } );

    // ========================================================================
    // ARRAYORSTRING TYPE
    // ========================================================================

    describe( 'arrayOrString type', function () {

        it( 'accepts array', function () {
            const errors = validateField( [ 'a', 'b' ], { type: 'arrayOrString' }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'accepts string', function () {
            const errors = validateField( 'test', { type: 'arrayOrString' }, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'rejects number', function () {
            const errors = validateField( 123, { type: 'arrayOrString' }, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Expected array or string' );
        } );

        it( 'validates minItems for array', function () {
            const errors = validateField(
                [ 'a' ],
                { type: 'arrayOrString', minItems: 2 },
                'field'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Minimum items is 2' );
        } );

        it( 'validates minItems for string (length)', function () {
            const errors = validateField(
                'ab',
                { type: 'arrayOrString', minItems: 3 },
                'field'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Minimum items is 3' );
        } );

        // --- itemSchema Support for arrayOrString ---

        it( 'validates itemSchema when value is array', function () {
            const errors = validateField(
                [ 'valid', 123 ],
                { type: 'arrayOrString', itemSchema: { type: 'string' } },
                'field'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'field[1]' );
            expect( errors[ 0 ] ).to.include( 'Expected string' );
        } );

        it( 'validates all invalid array items with itemSchema', function () {
            const errors = validateField(
                [ 'a', 1, 'b', 2 ],
                { type: 'arrayOrString', itemSchema: { type: 'string' } },
                'field'
            );
            expect( errors ).to.have.lengthOf( 2 );
            expect( errors[ 0 ] ).to.include( 'field[1]' );
            expect( errors[ 1 ] ).to.include( 'field[3]' );
        } );

        it( 'passes when all array items match itemSchema', function () {
            const errors = validateField(
                [ 'a', 'b', 'c' ],
                { type: 'arrayOrString', itemSchema: { type: 'string' } },
                'field'
            );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'skips itemSchema validation when value is string', function () {
            const errors = validateField(
                'hello',
                { type: 'arrayOrString', itemSchema: { type: 'number' } },
                'field'
            );
            // String passes because itemSchema only applies to array values
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'does not validate items when itemSchema not provided', function () {
            const errors = validateField(
                [ 'a', 1, true ],
                { type: 'arrayOrString' },
                'field'
            );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'combines minItems with itemSchema for arrays', function () {
            const errors = validateField(
                [ 123 ],
                { type: 'arrayOrString', minItems: 2, itemSchema: { type: 'string' } },
                'field'
            );
            // Should have: minItems error + itemSchema error
            expect( errors ).to.have.lengthOf( 2 );
            expect( errors.some( ( e ) => e.includes( 'Minimum items' ) ) ).to.equal( true );
            expect( errors.some( ( e ) => e.includes( 'Expected string' ) ) ).to.equal( true );
        } );

        it( 'validates nested itemSchema with custom validator', function () {
            const isUpperCase = ( v ) => v === v.toUpperCase();
            const errors = validateField(
                [ 'ABC', 'def', 'GHI' ],
                {
                    type: 'arrayOrString',
                    itemSchema: { type: 'string', validator: isUpperCase, error: 'Must be uppercase' }
                },
                'field'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.equal( 'Must be uppercase' );
        } );

    } );

    // ========================================================================
    // OBJECT KEY VALIDATOR
    // ========================================================================

    describe( 'keyValidator', function () {

        it( 'passes when all keys satisfy validator', function () {
            const schema = {
                type: 'object',
                keyValidator: ( k ) => ( /^\d+$/ ).test( k )
            };
            const errors = validateField( { '0': 'a', '1': 'b', '99': 'c' }, schema, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'fails when key does not satisfy validator', function () {
            const schema = {
                type: 'object',
                keyValidator: ( k ) => ( /^\d+$/ ).test( k )
            };
            const errors = validateField( { '0': 'a', 'bad': 'b' }, schema, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Invalid key \'bad\'' );
        } );

        it( 'reports multiple invalid keys', function () {
            const schema = {
                type: 'object',
                keyValidator: ( k ) => ( /^\d+$/ ).test( k )
            };
            const errors = validateField( { 'foo': 'a', 'bar': 'b' }, schema, 'field' );
            expect( errors ).to.have.lengthOf( 2 );
        } );

        it( 'can combine with propertySchema', function () {
            const schema = {
                type: 'object',
                keyValidator: ( k ) => ( /^\d+$/ ).test( k ),
                propertySchema: { type: 'string', minLength: 1 }
            };
            const errors = validateField( { '0': 'valid', '1': 'also' }, schema, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'reports both key and value errors', function () {
            const schema = {
                type: 'object',
                keyValidator: ( k ) => ( /^\d+$/ ).test( k ),
                propertySchema: { type: 'string', minLength: 1 }
            };
            const errors = validateField( { 'bad': '' }, schema, 'field' );
            expect( errors ).to.have.lengthOf( 2 );
            expect( errors.some( ( e ) => e.includes( 'Invalid key \'bad\'' ) ) ).to.equal( true );
            expect( errors.some( ( e ) => e.includes( 'Minimum length' ) ) ).to.equal( true );
        } );

        it( 'passes for empty object', function () {
            const schema = {
                type: 'object',
                keyValidator: ( k ) => ( /^\d+$/ ).test( k )
            };
            const errors = validateField( {}, schema, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'can use imported validators', function () {
            // Simulate using validators.integerString pattern
            const integerString = ( v ) => {
                if ( typeof v !== 'string' || v.length === 0 ) return false;
                if ( !( /^\d+$/ ).test( v ) ) return false;
                if ( v.length > 1 && v[ 0 ] === '0' ) return false;
                return true;
            };
            const schema = {
                type: 'object',
                keyValidator: integerString
            };
            const errors = validateField( { '0': 'a', '1': 'b', '01': 'c' }, schema, 'field' );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'Invalid key \'01\'' );
        } );

    } );

    // ========================================================================
    // NO SCHEMA TYPE
    // ========================================================================

    describe( 'no type specified', function () {

        it( 'skips type validation when no type specified', function () {
            const errors = validateField( 'anything', {}, 'field' );
            expect( errors ).to.deep.equal( [] );
        } );

        it( 'still runs custom validator without type', function () {
            const errors = validateField(
                'test',
                { validator: ( v ) => v.length > 5, error: 'Too short' },
                'field'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.equal( 'Too short' );
        } );

    } );

} );

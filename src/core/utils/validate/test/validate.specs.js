// core/utils/validate/test/validate.specs.js

/**
 * @fileoverview Tests for core validation logic
 *
 * Tests cover:
 * - validateWithSchema: Main validation function
 * - Required field validation
 * - Cross-field validators
 * - Error aggregation
 * - throwIfInvalid helper
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { validateWithSchema } from '../validate.js';

describe( 'validateWithSchema', function () {

    // ========================================================================
    // BASIC VALIDATION
    // ========================================================================

    describe( 'basic validation', function () {

        it( 'returns valid=true for empty schema and empty object', function () {
            const result = validateWithSchema( {}, {} );
            expect( result.valid ).to.equal( true );
            expect( result.errors ).to.deep.equal( [] );
        } );

        it( 'returns version in result', function () {
            const result = validateWithSchema( {}, {} );
            expect( result.version ).to.equal( '1.0.0' );
        } );

        it( 'uses default pathPrefix of "object"', function () {
            const schema = { name: { required: true } };
            const result = validateWithSchema( schema, {} );
            expect( result.errors[ 0 ] ).to.include( 'object.name' );
        } );

        it( 'uses custom pathPrefix', function () {
            const schema = { name: { required: true } };
            const result = validateWithSchema( schema, {}, 'spec' );
            expect( result.errors[ 0 ] ).to.include( 'spec.name' );
        } );

    } );

    // ========================================================================
    // REQUIRED FIELD VALIDATION
    // ========================================================================

    describe( 'required field validation', function () {

        it( 'fails when required field is missing', function () {
            const schema = {
                name: { required: true }
            };
            const result = validateWithSchema( schema, {} );
            expect( result.valid ).to.equal( false );
            expect( result.errors ).to.have.lengthOf( 1 );
            expect( result.errors[ 0 ] ).to.include( 'Required field missing' );
        } );

        it( 'passes when required field is present', function () {
            const schema = {
                name: { required: true }
            };
            const result = validateWithSchema( schema, { name: 'test' } );
            expect( result.valid ).to.equal( true );
        } );

        it( 'passes when optional field is missing', function () {
            const schema = {
                name: { required: false }
            };
            const result = validateWithSchema( schema, {} );
            expect( result.valid ).to.equal( true );
        } );

        it( 'validates multiple required fields', function () {
            const schema = {
                name: { required: true },
                type: { required: true },
                value: { required: true }
            };
            const result = validateWithSchema( schema, { name: 'test' } );
            expect( result.valid ).to.equal( false );
            expect( result.errors ).to.have.lengthOf( 2 );
        } );

    } );

    // ========================================================================
    // TYPE VALIDATION
    // ========================================================================

    describe( 'type validation', function () {

        it( 'validates string type', function () {
            const schema = {
                name: { type: 'string' }
            };
            const result = validateWithSchema( schema, { name: 'test' } );
            expect( result.valid ).to.equal( true );
        } );

        it( 'fails on invalid string type', function () {
            const schema = {
                name: { type: 'string' }
            };
            const result = validateWithSchema( schema, { name: 123 } );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'Expected string' );
        } );

        it( 'validates number type', function () {
            const schema = {
                value: { type: 'number' }
            };
            const result = validateWithSchema( schema, { value: 42 } );
            expect( result.valid ).to.equal( true );
        } );

        it( 'validates boolean type', function () {
            const schema = {
                flag: { type: 'boolean' }
            };
            const result = validateWithSchema( schema, { flag: true } );
            expect( result.valid ).to.equal( true );
        } );

        it( 'validates array type', function () {
            const schema = {
                items: { type: 'array' }
            };
            const result = validateWithSchema( schema, { items: [ 1, 2, 3 ] } );
            expect( result.valid ).to.equal( true );
        } );

        it( 'validates function type', function () {
            const schema = {
                callback: { type: 'function' }
            };
            const fn = function () {
                return 1;
            };
            const result = validateWithSchema( schema, { callback: fn } );
            expect( result.valid ).to.equal( true );
        } );

    } );

    // ========================================================================
    // SPECIAL KEY HANDLING
    // ========================================================================

    describe( 'special key handling', function () {

        it( 'skips keys starting with underscore', function () {
            const schema = {
                _internal: { required: true },
                name: { required: true }
            };
            const result = validateWithSchema( schema, { name: 'test' } );
            expect( result.valid ).to.equal( true );
        } );

        it( 'skips _crossFieldValidators key', function () {
            const schema = {
                _crossFieldValidators: [ { fields: [ 'a' ], validator: () => true, error: 'fail' } ],
                name: { required: true }
            };
            const result = validateWithSchema( schema, { name: 'test' } );
            expect( result.valid ).to.equal( true );
        } );

    } );

    // ========================================================================
    // CROSS-FIELD VALIDATORS
    // ========================================================================

    describe( 'cross-field validators', function () {

        it( 'runs cross-field validators when field validation passes', function () {
            const schema = {
                min: { type: 'number' },
                max: { type: 'number' },
                _crossFieldValidators: [ {
                    fields: [ 'min', 'max' ],
                    validator: ( obj ) => obj.min < obj.max,
                    error: 'min must be less than max'
                } ]
            };
            const result = validateWithSchema( schema, { min: 10, max: 5 } );
            expect( result.valid ).to.equal( false );
            expect( result.errors ).to.include( 'min must be less than max' );
        } );

        it( 'passes when cross-field validation succeeds', function () {
            const schema = {
                min: { type: 'number' },
                max: { type: 'number' },
                _crossFieldValidators: [ {
                    fields: [ 'min', 'max' ],
                    validator: ( obj ) => obj.min < obj.max,
                    error: 'min must be less than max'
                } ]
            };
            const result = validateWithSchema( schema, { min: 5, max: 10 } );
            expect( result.valid ).to.equal( true );
        } );

        it( 'skips cross-field validators when field validation fails', function () {
            const shouldNotRun = function () {
                throw new Error( 'should not run' );
            };
            const schema = {
                min: { type: 'number', required: true },
                max: { type: 'number', required: true },
                _crossFieldValidators: [ {
                    fields: [ 'min', 'max' ],
                    validator: shouldNotRun,
                    error: 'should not run'
                } ]
            };
            const result = validateWithSchema( schema, { min: 5 } );
            expect( result.valid ).to.equal( false );
            expect( result.errors ).to.have.lengthOf( 1 );
            expect( result.errors[ 0 ] ).to.include( 'Required field missing' );
        } );

        it( 'handles cross-field validator that throws', function () {
            const throwingValidator = function () {
                throw new Error( 'Validator error' );
            };
            const schema = {
                value: { type: 'number' },
                _crossFieldValidators: [ {
                    fields: [ 'value', 'other' ],
                    validator: throwingValidator,
                    error: 'unused'
                } ]
            };
            const result = validateWithSchema( schema, { value: 5 } );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'Cross-field validation' );
            expect( result.errors[ 0 ] ).to.include( 'threw error' );
            expect( result.errors[ 0 ] ).to.include( 'Validator error' );
        } );

        it( 'runs multiple cross-field validators', function () {
            const schema = {
                a: { type: 'number' },
                b: { type: 'number' },
                c: { type: 'number' },
                _crossFieldValidators: [
                    {
                        fields: [ 'a', 'b' ],
                        validator: ( obj ) => obj.a < obj.b,
                        error: 'a must be less than b'
                    },
                    {
                        fields: [ 'b', 'c' ],
                        validator: ( obj ) => obj.b < obj.c,
                        error: 'b must be less than c'
                    }
                ]
            };
            const result = validateWithSchema( schema, { a: 5, b: 10, c: 8 } );
            expect( result.valid ).to.equal( false );
            expect( result.errors ).to.include( 'b must be less than c' );
        } );

    } );

    // ========================================================================
    // throwIfInvalid
    // ========================================================================

    describe( 'throwIfInvalid', function () {

        it( 'does not throw when valid', function () {
            const result = validateWithSchema( {}, {} );
            expect( () => result.throwIfInvalid( 'TestNode' ) ).to.not.throw();
        } );

        it( 'throws TypeError when invalid', function () {
            const schema = { name: { required: true } };
            const result = validateWithSchema( schema, {} );
            expect( () => result.throwIfInvalid( 'TestNode' ) ).to.throw( TypeError );
        } );

        it( 'includes node type in error message', function () {
            const schema = { name: { required: true } };
            const result = validateWithSchema( schema, {} );
            try {
                result.throwIfInvalid( 'MyNode' );
                expect.fail( 'Should have thrown' );
            } catch ( e ) {
                expect( e.message ).to.include( 'winkComposer/MyNode' );
            }
        } );

        it( 'includes all errors in error message', function () {
            const schema = {
                name: { required: true },
                type: { required: true }
            };
            const result = validateWithSchema( schema, {} );
            try {
                result.throwIfInvalid( 'TestNode' );
                expect.fail( 'Should have thrown' );
            } catch ( e ) {
                expect( e.message ).to.include( 'name' );
                expect( e.message ).to.include( 'type' );
            }
        } );

    } );

    // ========================================================================
    // _PROPERTYNAMES VALIDATION
    // ========================================================================

    describe( '_propertyNames validation', function () {

        // --- Core Functionality ---

        it( 'detects single unknown property at top level', function () {
            const schema = {
                _propertyNames: [ 'name', 'value' ],
                name: { type: 'string' },
                value: { type: 'number' }
            };
            const result = validateWithSchema( schema, { name: 'test', typo: 123 } );
            expect( result.valid ).to.equal( false );
            expect( result.errors ).to.have.lengthOf( 1 );
            expect( result.errors[ 0 ] ).to.include( 'Unknown property \'typo\'' );
        } );

        it( 'reports multiple unknown properties', function () {
            const schema = {
                _propertyNames: [ 'name' ],
                name: { type: 'string' }
            };
            const result = validateWithSchema( schema, { name: 'test', foo: 1, bar: 2 } );
            expect( result.valid ).to.equal( false );
            expect( result.errors ).to.have.lengthOf( 2 );
            expect( result.errors.some( ( e ) => e.includes( '\'foo\'' ) ) ).to.equal( true );
            expect( result.errors.some( ( e ) => e.includes( '\'bar\'' ) ) ).to.equal( true );
        } );

        // --- Valid Cases ---

        it( 'passes when all properties are in allowed list', function () {
            const schema = {
                _propertyNames: [ 'name', 'value' ],
                name: { type: 'string' },
                value: { type: 'number' }
            };
            const result = validateWithSchema( schema, { name: 'test', value: 42 } );
            expect( result.valid ).to.equal( true );
            expect( result.errors ).to.deep.equal( [] );
        } );

        it( 'passes when optional allowed properties are missing', function () {
            const schema = {
                _propertyNames: [ 'name', 'value', 'optional' ],
                name: { type: 'string', required: true }
            };
            const result = validateWithSchema( schema, { name: 'test' } );
            expect( result.valid ).to.equal( true );
        } );

        it( 'passes for empty object when _propertyNames defined', function () {
            const schema = {
                _propertyNames: [ 'name', 'value' ]
            };
            const result = validateWithSchema( schema, {} );
            expect( result.valid ).to.equal( true );
        } );

        // --- Edge Cases ---

        it( 'rejects all properties when _propertyNames is empty array', function () {
            const schema = {
                _propertyNames: []
            };
            const result = validateWithSchema( schema, { any: 'value' } );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'Unknown property \'any\'' );
        } );

        it( 'passes empty object when _propertyNames is empty array', function () {
            const schema = {
                _propertyNames: []
            };
            const result = validateWithSchema( schema, {} );
            expect( result.valid ).to.equal( true );
        } );

        // --- Opt-in Behavior ---

        it( 'skips unknown property check when _propertyNames not defined', function () {
            const schema = {
                name: { type: 'string' }
            };
            const result = validateWithSchema( schema, { name: 'test', extra: 'ignored' } );
            expect( result.valid ).to.equal( true );
        } );

        // --- Error Message Format ---

        it( 'uses default pathPrefix in error messages', function () {
            const schema = {
                _propertyNames: [ 'name' ],
                name: { type: 'string' }
            };
            const result = validateWithSchema( schema, { typo: 1 } );
            expect( result.errors[ 0 ] ).to.include( 'object:' );
            expect( result.errors[ 0 ] ).to.include( 'Unknown property \'typo\'' );
        } );

        it( 'uses custom pathPrefix in error messages', function () {
            const schema = {
                _propertyNames: [ 'name' ],
                name: { type: 'string' }
            };
            const result = validateWithSchema( schema, { typo: 1 }, 'spec' );
            expect( result.errors[ 0 ] ).to.include( 'spec:' );
        } );

        // --- Integration with Other Validations ---

        it( 'combines with required field errors', function () {
            const schema = {
                _propertyNames: [ 'name', 'value' ],
                name: { type: 'string', required: true },
                value: { type: 'number', required: true }
            };
            const result = validateWithSchema( schema, { typo: 'oops' } );
            // Should have: 2 required field missing + 1 unknown property
            expect( result.errors ).to.have.lengthOf( 3 );
        } );

        it( 'combines with type validation errors', function () {
            const schema = {
                _propertyNames: [ 'name', 'value' ],
                name: { type: 'string' },
                value: { type: 'number' }
            };
            const result = validateWithSchema( schema, { name: 123, extra: 'bad' } );
            // Should have: 1 type error + 1 unknown property
            expect( result.errors ).to.have.lengthOf( 2 );
        } );

        it( 'does not affect cross-field validators execution', function () {
            const schema = {
                _propertyNames: [ 'min', 'max' ],
                min: { type: 'number' },
                max: { type: 'number' },
                _crossFieldValidators: [ {
                    fields: [ 'min', 'max' ],
                    validator: ( obj ) => obj.min < obj.max,
                    error: 'min must be less than max'
                } ]
            };
            const result = validateWithSchema( schema, { min: 10, max: 5 } );
            expect( result.valid ).to.equal( false );
            expect( result.errors ).to.include( 'min must be less than max' );
        } );

    } );

    // ========================================================================
    // INTEGRATION TESTS
    // ========================================================================

    describe( 'integration tests', function () {

        it( 'validates complex schema', function () {
            const schema = {
                name: { required: true, type: 'string' },
                value: { required: true, type: 'number', min: 0 },
                enabled: { type: 'boolean' },
                tags: { type: 'array' }
            };
            const result = validateWithSchema( schema, {
                name: 'test',
                value: 42,
                enabled: true,
                tags: [ 'a', 'b' ]
            }, 'spec' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'collects multiple errors', function () {
            const schema = {
                name: { required: true, type: 'string' },
                value: { required: true, type: 'number' },
                callback: { required: true, type: 'function' }
            };
            const result = validateWithSchema( schema, {
                name: 123,
                value: 'not a number'
            } );
            expect( result.valid ).to.equal( false );
            expect( result.errors.length ).to.be.greaterThanOrEqual( 3 );
        } );

    } );

} );

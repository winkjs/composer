// core/utils/validate/test/type-validators-extended.specs.js

/**
 * @fileoverview Extended tests for type validators
 *
 * Tests cover:
 * - arrayOrFunctionOrFieldKeyed
 * - objectOrFunction
 * - nestedObjectOrFunctionOrFieldKeyed
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { typeValidators } from '../type-validators.js';

const { arrayOrFunctionOrFieldKeyed, objectOrFunction } = typeValidators;

const { numberOrFunctionOrFieldKeyed, nestedObjectOrFunctionOrFieldKeyed } = typeValidators;

// Inner shape mirroring a sanitize range: both bounds required, numeric.
const RANGE_SCHEMA = {
    properties: {
        min: { type: 'number', required: true },
        max: { type: 'number', required: true }
    }
};

describe( 'Extended type validators', function () {

    // ========================================================================
    // numberOrFunctionOrFieldKeyed - additional coverage for nested validators
    // ========================================================================

    describe( 'numberOrFunctionOrFieldKeyed additional', function () {

        it( 'applies max constraint to numeric field values', function () {
            const errors = numberOrFunctionOrFieldKeyed(
                { temp: 100 },
                { max: 50 },
                'halfLife'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'halfLife.temp' );
            expect( errors[ 0 ] ).to.include( 'Maximum value is 50' );
        } );

        it( 'applies integer constraint to numeric field values', function () {
            const errors = numberOrFunctionOrFieldKeyed(
                { temp: 3.5 },
                { integer: true },
                'windowSize'
            );
            expect( errors ).to.have.lengthOf( 1 );
            expect( errors[ 0 ] ).to.include( 'windowSize.temp' );
            expect( errors[ 0 ] ).to.include( 'Expected integer' );
        } );

        it( 'collects max and integer errors from numeric fields', function () {
            const errors = numberOrFunctionOrFieldKeyed(
                { temp: 100.5, pressure: 50.5 },
                { max: 50, integer: true },
                'value'
            );
            // temp exceeds max and is not integer, pressure is not integer
            expect( errors.length ).to.be.greaterThan( 0 );
        } );

    } );

    // ========================================================================
    // arrayOrFunctionOrFieldKeyed
    // ========================================================================

    describe( 'arrayOrFunctionOrFieldKeyed', function () {

        describe( 'array values', function () {

            it( 'accepts array of numbers', function () {
                const errors = arrayOrFunctionOrFieldKeyed( [ 1, 2, 3 ], {}, 'thresholds' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts empty array', function () {
                const errors = arrayOrFunctionOrFieldKeyed( [], {}, 'items' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'applies minItems constraint', function () {
                const errors = arrayOrFunctionOrFieldKeyed(
                    [ 1 ],
                    { minItems: 2 },
                    'thresholds'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Minimum items is 2' );
            } );

            it( 'applies maxItems constraint', function () {
                const errors = arrayOrFunctionOrFieldKeyed(
                    [ 1, 2, 3, 4, 5 ],
                    { maxItems: 3 },
                    'thresholds'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Maximum items is 3' );
            } );

        } );

        describe( 'function values', function () {

            it( 'accepts function', function () {
                const fn = ( msg ) => [ msg.a, msg.b ];
                const errors = arrayOrFunctionOrFieldKeyed( fn, {}, 'thresholds' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts arrow function', function () {
                const errors = arrayOrFunctionOrFieldKeyed( ( x ) => [ x ], {}, 'items' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts function with correct arity', function () {
                const fn = ( msg ) => msg.values;
                const errors = arrayOrFunctionOrFieldKeyed( fn, { arity: 1 }, 'thresholds' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'rejects function with wrong arity', function () {
                const fn = ( a, b ) => [ a, b ];
                const errors = arrayOrFunctionOrFieldKeyed( fn, { arity: 1 }, 'thresholds' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected function with 1 parameter' );
            } );

        } );

        describe( 'field-keyed object with arrays', function () {

            it( 'accepts object with array values', function () {
                const errors = arrayOrFunctionOrFieldKeyed(
                    { temp: [ 15, 25 ], pressure: [ 30, 60 ] },
                    {},
                    'thresholds'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'applies minItems constraint to each field', function () {
                const errors = arrayOrFunctionOrFieldKeyed(
                    { temp: [ 1 ], pressure: [ 1, 2, 3 ] },
                    { minItems: 2 },
                    'thresholds'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'thresholds.temp' );
                expect( errors[ 0 ] ).to.include( 'Minimum items is 2' );
            } );

            it( 'applies maxItems constraint to each field', function () {
                const errors = arrayOrFunctionOrFieldKeyed(
                    { temp: [ 1, 2 ], pressure: [ 1, 2, 3, 4, 5 ] },
                    { maxItems: 3 },
                    'thresholds'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'thresholds.pressure' );
                expect( errors[ 0 ] ).to.include( 'Maximum items is 3' );
            } );

            it( 'rejects object with non-array values', function () {
                const errors = arrayOrFunctionOrFieldKeyed(
                    { temp: [ 1, 2 ], pressure: 'invalid' },
                    {},
                    'thresholds'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'thresholds.pressure' );
                expect( errors[ 0 ] ).to.include( 'Expected array or function' );
            } );

        } );

        describe( 'field-keyed object with functions', function () {

            it( 'accepts object with function values', function () {
                const errors = arrayOrFunctionOrFieldKeyed(
                    { temp: ( msg ) => [ msg.t ], pressure: ( msg ) => [ msg.p ] },
                    {},
                    'thresholds'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts object with mixed array and function values', function () {
                const errors = arrayOrFunctionOrFieldKeyed(
                    { temp: [ 1, 2 ], pressure: ( msg ) => [ msg.p ] },
                    {},
                    'thresholds'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'validates function arity in field-keyed object', function () {
                const errors = arrayOrFunctionOrFieldKeyed(
                    { temp: ( a, b ) => [ a, b ] },
                    { arity: 1 },
                    'thresholds'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'thresholds.temp' );
                expect( errors[ 0 ] ).to.include( 'Expected function with 1 parameter' );
            } );

        } );

        describe( 'invalid types', function () {

            it( 'rejects string', function () {
                const errors = arrayOrFunctionOrFieldKeyed( 'hello', {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected array, function, or per-field map' );
            } );

            it( 'rejects number', function () {
                const errors = arrayOrFunctionOrFieldKeyed( 42, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected array, function, or per-field map' );
            } );

            it( 'rejects boolean', function () {
                const errors = arrayOrFunctionOrFieldKeyed( true, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected array, function, or per-field map' );
            } );

            it( 'rejects null', function () {
                const errors = arrayOrFunctionOrFieldKeyed( null, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected array, function, or per-field map' );
            } );

        } );

    } );

    // ========================================================================
    // objectOrFunction
    // ========================================================================

    describe( 'objectOrFunction', function () {

        describe( 'object values', function () {

            it( 'accepts plain object', function () {
                const errors = objectOrFunction( { min: 0, max: 100 }, {}, 'range' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts empty object', function () {
                const errors = objectOrFunction( {}, {}, 'config' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'validates minProperties', function () {
                const errors = objectOrFunction(
                    { a: 1 },
                    { minProperties: 2 },
                    'config'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Minimum properties is 2' );
            } );

            it( 'validates maxProperties', function () {
                const errors = objectOrFunction(
                    { a: 1, b: 2, c: 3, d: 4 },
                    { maxProperties: 3 },
                    'config'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Maximum properties is 3' );
            } );

            it( 'rejects array', function () {
                const errors = objectOrFunction( [ 1, 2, 3 ], {}, 'config' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected object' );
                expect( errors[ 0 ] ).to.include( 'got array' );
            } );

            it( 'rejects null', function () {
                const errors = objectOrFunction( null, {}, 'config' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected object' );
                expect( errors[ 0 ] ).to.include( 'got null' );
            } );

        } );

        describe( 'function values', function () {

            it( 'accepts function', function () {
                const fn = ( msg ) => ( { min: msg.min, max: msg.max } );
                const errors = objectOrFunction( fn, {}, 'range' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts arrow function', function () {
                const errors = objectOrFunction( ( x ) => ( { value: x } ), {}, 'config' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts function with correct arity', function () {
                const fn = ( msg ) => msg.config;
                const errors = objectOrFunction( fn, { arity: 1 }, 'config' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'rejects function with wrong arity', function () {
                const fn = ( a, b ) => ( { sum: a + b } );
                const errors = objectOrFunction( fn, { arity: 1 }, 'config' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected function with 1 parameter' );
            } );

        } );

        describe( 'invalid types', function () {

            it( 'rejects string', function () {
                const errors = objectOrFunction( 'hello', {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected object' );
            } );

            it( 'rejects number', function () {
                const errors = objectOrFunction( 42, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected object' );
            } );

            it( 'rejects boolean', function () {
                const errors = objectOrFunction( true, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected object' );
            } );

        } );

    } );

    // ========================================================================
    // nestedObjectOrFunctionOrFieldKeyed
    // ========================================================================

    describe( 'nestedObjectOrFunctionOrFieldKeyed', function () {

        describe( 'function values', function () {

            it( 'accepts a function with no arity constraint', function () {
                const errors = nestedObjectOrFunctionOrFieldKeyed(
                    () => ( { min: 0, max: 100 } ), RANGE_SCHEMA, 'ranges'
                );
                expect( errors ).to.have.lengthOf( 0 );
            } );

            it( 'accepts a function matching the arity constraint', function () {
                const errors = nestedObjectOrFunctionOrFieldKeyed(
                    ( msg ) => ( { min: msg.lo, max: msg.hi } ),
                    { ...RANGE_SCHEMA, arity: 1 }, 'ranges'
                );
                expect( errors ).to.have.lengthOf( 0 );
            } );

            it( 'rejects a function with the wrong arity', function () {
                const errors = nestedObjectOrFunctionOrFieldKeyed(
                    () => ( { min: 0, max: 100 } ),
                    { ...RANGE_SCHEMA, arity: 1 }, 'ranges'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected function with 1 parameter' );
            } );

        } );

        describe( 'invalid top-level types', function () {

            it( 'rejects null', function () {
                const errors = nestedObjectOrFunctionOrFieldKeyed( null, RANGE_SCHEMA, 'ranges' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'got null' );
            } );

            it( 'rejects an array', function () {
                const errors = nestedObjectOrFunctionOrFieldKeyed( [ 1, 2 ], RANGE_SCHEMA, 'ranges' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'got array' );
            } );

            it( 'rejects a primitive (number)', function () {
                const errors = nestedObjectOrFunctionOrFieldKeyed( 42, RANGE_SCHEMA, 'ranges' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected object, function, or per-field map' );
                expect( errors[ 0 ] ).to.include( 'got number' );
            } );

        } );

        describe( 'direct shape', function () {

            it( 'accepts a direct range with numeric bounds', function () {
                const errors = nestedObjectOrFunctionOrFieldKeyed(
                    { min: 0, max: 100 }, RANGE_SCHEMA, 'ranges'
                );
                expect( errors ).to.have.lengthOf( 0 );
            } );

            it( 'rejects a direct range missing a required bound', function () {
                const errors = nestedObjectOrFunctionOrFieldKeyed(
                    { min: 0 }, RANGE_SCHEMA, 'ranges'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.equal( 'ranges.max: Required field missing' );
            } );

            it( 'rejects a direct range with a non-numeric bound', function () {
                const errors = nestedObjectOrFunctionOrFieldKeyed(
                    { min: 'a', max: 'b' }, RANGE_SCHEMA, 'ranges'
                );
                expect( errors ).to.have.lengthOf( 2 );
                expect( errors[ 0 ] ).to.equal( 'ranges.min: Expected number, got string' );
                expect( errors[ 1 ] ).to.equal( 'ranges.max: Expected number, got string' );
            } );

            it( 'applies inner numeric constraints to a direct range', function () {
                const schema = {
                    properties: {
                        min: { type: 'number', required: true, min: 0 },
                        max: { type: 'number', required: true }
                    }
                };
                const errors = nestedObjectOrFunctionOrFieldKeyed(
                    { min: -5, max: 100 }, schema, 'ranges'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Minimum value is 0' );
            } );

        } );

        describe( 'field-keyed shape', function () {

            it( 'accepts a field-keyed map of valid ranges', function () {
                const errors = nestedObjectOrFunctionOrFieldKeyed(
                    { temp: { min: -40, max: 85 }, pressure: { min: 0, max: 120 } },
                    RANGE_SCHEMA, 'ranges'
                );
                expect( errors ).to.have.lengthOf( 0 );
            } );

            it( 'rejects a field-keyed entry with a non-numeric bound', function () {
                const errors = nestedObjectOrFunctionOrFieldKeyed(
                    { temp: { min: 0, max: 'hot' } }, RANGE_SCHEMA, 'ranges'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.equal( 'ranges.temp.max: Expected number, got string' );
            } );

            it( 'rejects a field-keyed entry that is a number, not an object', function () {
                const errors = nestedObjectOrFunctionOrFieldKeyed(
                    { temp: 5 }, RANGE_SCHEMA, 'ranges'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.equal( 'ranges.temp: Expected object, got number' );
            } );

            it( 'rejects a field-keyed entry that is null', function () {
                const errors = nestedObjectOrFunctionOrFieldKeyed(
                    { temp: null }, RANGE_SCHEMA, 'ranges'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.equal( 'ranges.temp: Expected object, got null' );
            } );

            it( 'rejects a field-keyed entry that is an array', function () {
                const errors = nestedObjectOrFunctionOrFieldKeyed(
                    { temp: [ 0, 100 ] }, RANGE_SCHEMA, 'ranges'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.equal( 'ranges.temp: Expected object, got array' );
            } );

        } );

        describe( 'inner-shape edge cases', function () {

            it( 'allows an optional inner key to be absent', function () {
                const schema = {
                    properties: {
                        min: { type: 'number', required: true },
                        max: { type: 'number' }  // optional
                    }
                };
                const errors = nestedObjectOrFunctionOrFieldKeyed( { min: 0 }, schema, 'ranges' );
                expect( errors ).to.have.lengthOf( 0 );
            } );

            it( 'treats a schema with no properties as field-keyed and validates entries loosely', function () {
                const errors = nestedObjectOrFunctionOrFieldKeyed( { a: {} }, {}, 'opt' );
                expect( errors ).to.have.lengthOf( 0 );
            } );

        } );

    } );

} );

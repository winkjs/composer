// core/utils/validate/test/type-validators.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { typeValidators } from '../type-validators.js';

const {
    numberOrFieldKeyed,
    arrayOrFieldKeyed,
    stringOrFieldKeyed,
    numberOrFunction,
    numberOrFunctionOrFieldKeyed
} = typeValidators;

describe( 'Dual-mode type validators', function () {

    describe( 'numberOrFieldKeyed', function () {

        describe( 'direct number values', function () {

            it( 'accepts positive number', function () {
                const errors = numberOrFieldKeyed( 42, {}, 'halfLife' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts zero', function () {
                const errors = numberOrFieldKeyed( 0, {}, 'threshold' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts negative number', function () {
                const errors = numberOrFieldKeyed( -10, {}, 'offset' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts decimal number', function () {
                const errors = numberOrFieldKeyed( 3.14159, {}, 'alpha' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'rejects NaN', function () {
                const errors = numberOrFieldKeyed( NaN, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'NaN' );
            } );

            it( 'applies min constraint', function () {
                const errors = numberOrFieldKeyed( 5, { min: 10 }, 'halfLife' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Minimum value is 10' );
            } );

            it( 'applies max constraint', function () {
                const errors = numberOrFieldKeyed( 100, { max: 50 }, 'halfLife' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Maximum value is 50' );
            } );

            it( 'applies integer constraint', function () {
                const errors = numberOrFieldKeyed( 3.5, { integer: true }, 'count' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected integer' );
            } );

            it( 'passes when within min/max range', function () {
                const errors = numberOrFieldKeyed( 25, { min: 10, max: 50 }, 'value' );
                expect( errors ).to.deep.equal( [] );
            } );

        } );

        describe( 'field-keyed object values', function () {

            it( 'accepts object with numeric values', function () {
                const errors = numberOrFieldKeyed(
                    { temp: 5, pressure: 20 },
                    {},
                    'halfLife'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts object with single field', function () {
                const errors = numberOrFieldKeyed(
                    { temp: 10 },
                    {},
                    'halfLife'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts object with zero values', function () {
                const errors = numberOrFieldKeyed(
                    { temp: 0, pressure: 0 },
                    {},
                    'threshold'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts object with negative values', function () {
                const errors = numberOrFieldKeyed(
                    { temp: -5, pressure: -10 },
                    {},
                    'offset'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'rejects object with non-numeric values', function () {
                const errors = numberOrFieldKeyed(
                    { temp: 5, pressure: 'high' },
                    {},
                    'halfLife'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'halfLife.pressure' );
                expect( errors[ 0 ] ).to.include( 'Expected number' );
            } );

            it( 'rejects object with NaN values', function () {
                const errors = numberOrFieldKeyed(
                    { temp: 5, pressure: NaN },
                    {},
                    'halfLife'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'halfLife.pressure' );
                expect( errors[ 0 ] ).to.include( 'NaN' );
            } );

            it( 'applies min constraint to each field value', function () {
                const errors = numberOrFieldKeyed(
                    { temp: 5, pressure: 15 },
                    { min: 10 },
                    'halfLife'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'halfLife.temp' );
                expect( errors[ 0 ] ).to.include( 'Minimum value is 10' );
            } );

            it( 'applies max constraint to each field value', function () {
                const errors = numberOrFieldKeyed(
                    { temp: 100, pressure: 20 },
                    { max: 50 },
                    'halfLife'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'halfLife.temp' );
                expect( errors[ 0 ] ).to.include( 'Maximum value is 50' );
            } );

            it( 'applies integer constraint to each field value', function () {
                const errors = numberOrFieldKeyed(
                    { temp: 5, pressure: 10.5 },
                    { integer: true },
                    'windowSize'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'windowSize.pressure' );
                expect( errors[ 0 ] ).to.include( 'Expected integer' );
            } );

            it( 'collects multiple errors from different fields', function () {
                const errors = numberOrFieldKeyed(
                    { temp: 'invalid', pressure: NaN, humidity: 5 },
                    {},
                    'values'
                );
                expect( errors ).to.have.lengthOf( 2 );
            } );

            it( 'passes when all field values satisfy constraints', function () {
                const errors = numberOrFieldKeyed(
                    { temp: 15, pressure: 25, humidity: 30 },
                    { min: 10, max: 50 },
                    'halfLife'
                );
                expect( errors ).to.deep.equal( [] );
            } );

        } );

        describe( 'invalid types', function () {

            it( 'rejects string', function () {
                const errors = numberOrFieldKeyed( 'hello', {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number or per-field map' );
            } );

            it( 'rejects boolean', function () {
                const errors = numberOrFieldKeyed( true, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number or per-field map' );
            } );

            it( 'rejects array', function () {
                const errors = numberOrFieldKeyed( [ 1, 2, 3 ], {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number or per-field map' );
            } );

            it( 'rejects null', function () {
                const errors = numberOrFieldKeyed( null, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number or per-field map' );
            } );

            it( 'rejects undefined', function () {
                const errors = numberOrFieldKeyed( undefined, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number or per-field map' );
            } );

            it( 'rejects function', function () {
                const errors = numberOrFieldKeyed( () => 5, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number or per-field map' );
            } );

        } );

    } );

    describe( 'arrayOrFieldKeyed', function () {

        describe( 'direct array values', function () {

            it( 'accepts array of numbers', function () {
                const errors = arrayOrFieldKeyed( [ 1, 2, 3 ], {}, 'thresholds' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts array of strings', function () {
                const errors = arrayOrFieldKeyed(
                    [ 'low', 'medium', 'high' ],
                    {},
                    'categories'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts empty array', function () {
                const errors = arrayOrFieldKeyed( [], {}, 'items' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'applies minItems constraint', function () {
                const errors = arrayOrFieldKeyed(
                    [ 1 ],
                    { minItems: 2 },
                    'thresholds'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Minimum items is 2' );
            } );

            it( 'applies maxItems constraint', function () {
                const errors = arrayOrFieldKeyed(
                    [ 1, 2, 3, 4, 5 ],
                    { maxItems: 3 },
                    'thresholds'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Maximum items is 3' );
            } );

            it( 'passes when within minItems/maxItems range', function () {
                const errors = arrayOrFieldKeyed(
                    [ 1, 2, 3 ],
                    { minItems: 2, maxItems: 5 },
                    'thresholds'
                );
                expect( errors ).to.deep.equal( [] );
            } );

        } );

        describe( 'field-keyed object values', function () {

            it( 'accepts object with array values', function () {
                const errors = arrayOrFieldKeyed(
                    { temp: [ 15, 25 ], pressure: [ 30, 60 ] },
                    {},
                    'thresholds'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts object with single field', function () {
                const errors = arrayOrFieldKeyed(
                    { temp: [ 1, 2, 3 ] },
                    {},
                    'thresholds'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts object with empty arrays', function () {
                const errors = arrayOrFieldKeyed(
                    { temp: [], pressure: [] },
                    {},
                    'items'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'rejects object with non-array values', function () {
                const errors = arrayOrFieldKeyed(
                    { temp: [ 1, 2 ], pressure: 'invalid' },
                    {},
                    'thresholds'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'thresholds.pressure' );
                expect( errors[ 0 ] ).to.include( 'Expected array' );
            } );

            it( 'applies minItems constraint to each field array', function () {
                const errors = arrayOrFieldKeyed(
                    { temp: [ 1 ], pressure: [ 1, 2, 3 ] },
                    { minItems: 2 },
                    'thresholds'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'thresholds.temp' );
                expect( errors[ 0 ] ).to.include( 'Minimum items is 2' );
            } );

            it( 'applies maxItems constraint to each field array', function () {
                const errors = arrayOrFieldKeyed(
                    { temp: [ 1, 2 ], pressure: [ 1, 2, 3, 4, 5 ] },
                    { maxItems: 3 },
                    'thresholds'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'thresholds.pressure' );
                expect( errors[ 0 ] ).to.include( 'Maximum items is 3' );
            } );

            it( 'collects multiple errors from different fields', function () {
                const errors = arrayOrFieldKeyed(
                    { temp: 'invalid', pressure: 123, humidity: [ 1 ] },
                    {},
                    'values'
                );
                expect( errors ).to.have.lengthOf( 2 );
            } );

            it( 'passes when all field arrays satisfy constraints', function () {
                const errors = arrayOrFieldKeyed(
                    { temp: [ 1, 2 ], pressure: [ 3, 4, 5 ] },
                    { minItems: 2, maxItems: 5 },
                    'thresholds'
                );
                expect( errors ).to.deep.equal( [] );
            } );

        } );

        describe( 'invalid types', function () {

            it( 'rejects string', function () {
                const errors = arrayOrFieldKeyed( 'hello', {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected array or per-field map' );
            } );

            it( 'rejects number', function () {
                const errors = arrayOrFieldKeyed( 42, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected array or per-field map' );
            } );

            it( 'rejects boolean', function () {
                const errors = arrayOrFieldKeyed( true, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected array or per-field map' );
            } );

            it( 'rejects null', function () {
                const errors = arrayOrFieldKeyed( null, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected array or per-field map' );
            } );

            it( 'rejects undefined', function () {
                const errors = arrayOrFieldKeyed( undefined, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected array or per-field map' );
            } );

        } );

    } );

    describe( 'stringOrFieldKeyed', function () {

        describe( 'direct string values', function () {

            it( 'accepts non-empty string', function () {
                const errors = stringOrFieldKeyed( 'lowpass', {}, 'filterType' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts empty string', function () {
                const errors = stringOrFieldKeyed( '', {}, 'prefix' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'applies minLength constraint', function () {
                const errors = stringOrFieldKeyed(
                    'ab',
                    { minLength: 3 },
                    'name'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Minimum length is 3' );
            } );

            it( 'applies maxLength constraint', function () {
                const errors = stringOrFieldKeyed(
                    'toolongvalue',
                    { maxLength: 5 },
                    'code'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Maximum length is 5' );
            } );

            it( 'applies pattern constraint', function () {
                const errors = stringOrFieldKeyed(
                    'invalid123',
                    { pattern: /^[a-z]+$/ },
                    'name'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'does not match required pattern' );
            } );

            it( 'passes when satisfying all constraints', function () {
                const errors = stringOrFieldKeyed(
                    'valid',
                    { minLength: 3, maxLength: 10, pattern: /^[a-z]+$/ },
                    'name'
                );
                expect( errors ).to.deep.equal( [] );
            } );

        } );

        describe( 'field-keyed object values', function () {

            it( 'accepts object with string values', function () {
                const errors = stringOrFieldKeyed(
                    { temp: 'lowpass', pressure: 'highpass' },
                    {},
                    'filterType'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts object with single field', function () {
                const errors = stringOrFieldKeyed(
                    { temp: 'lowpass' },
                    {},
                    'filterType'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts object with empty string values', function () {
                const errors = stringOrFieldKeyed(
                    { temp: '', pressure: '' },
                    {},
                    'prefix'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'rejects object with non-string values', function () {
                const errors = stringOrFieldKeyed(
                    { temp: 'lowpass', pressure: 123 },
                    {},
                    'filterType'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'filterType.pressure' );
                expect( errors[ 0 ] ).to.include( 'Expected string' );
            } );

            it( 'applies minLength constraint to each field value', function () {
                const errors = stringOrFieldKeyed(
                    { temp: 'ab', pressure: 'valid' },
                    { minLength: 3 },
                    'name'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'name.temp' );
                expect( errors[ 0 ] ).to.include( 'Minimum length is 3' );
            } );

            it( 'applies maxLength constraint to each field value', function () {
                const errors = stringOrFieldKeyed(
                    { temp: 'ok', pressure: 'waytoolong' },
                    { maxLength: 5 },
                    'code'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'code.pressure' );
                expect( errors[ 0 ] ).to.include( 'Maximum length is 5' );
            } );

            it( 'applies pattern constraint to each field value', function () {
                const errors = stringOrFieldKeyed(
                    { temp: 'valid', pressure: 'invalid123' },
                    { pattern: /^[a-z]+$/ },
                    'name'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'name.pressure' );
                expect( errors[ 0 ] ).to.include( 'does not match required pattern' );
            } );

            it( 'collects multiple errors from different fields', function () {
                const errors = stringOrFieldKeyed(
                    { temp: 123, pressure: true, humidity: 'valid' },
                    {},
                    'values'
                );
                expect( errors ).to.have.lengthOf( 2 );
            } );

            it( 'passes when all field values satisfy constraints', function () {
                const errors = stringOrFieldKeyed(
                    { temp: 'alpha', pressure: 'beta' },
                    { minLength: 3, maxLength: 10, pattern: /^[a-z]+$/ },
                    'name'
                );
                expect( errors ).to.deep.equal( [] );
            } );

        } );

        describe( 'invalid types', function () {

            it( 'rejects number', function () {
                const errors = stringOrFieldKeyed( 42, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected string or per-field map' );
            } );

            it( 'rejects boolean', function () {
                const errors = stringOrFieldKeyed( true, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected string or per-field map' );
            } );

            it( 'rejects array', function () {
                const errors = stringOrFieldKeyed( [ 'a', 'b' ], {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected string or per-field map' );
            } );

            it( 'rejects null', function () {
                const errors = stringOrFieldKeyed( null, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected string or per-field map' );
            } );

            it( 'rejects undefined', function () {
                const errors = stringOrFieldKeyed( undefined, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected string or per-field map' );
            } );

        } );

    } );

    describe( 'numberOrFunction', function () {

        describe( 'number values', function () {

            it( 'accepts positive number', function () {
                const errors = numberOrFunction( 42, {}, 'threshold' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts zero', function () {
                const errors = numberOrFunction( 0, {}, 'offset' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts negative number', function () {
                const errors = numberOrFunction( -10, {}, 'delta' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts decimal number', function () {
                const errors = numberOrFunction( 3.14159, {}, 'alpha' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'rejects NaN', function () {
                const errors = numberOrFunction( NaN, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'NaN' );
            } );

            it( 'applies min constraint', function () {
                const errors = numberOrFunction( 5, { min: 10 }, 'threshold' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Minimum value is 10' );
            } );

            it( 'applies max constraint', function () {
                const errors = numberOrFunction( 100, { max: 50 }, 'threshold' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Maximum value is 50' );
            } );

            it( 'applies integer constraint', function () {
                const errors = numberOrFunction( 3.5, { integer: true }, 'count' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected integer' );
            } );

        } );

        describe( 'function values', function () {

            it( 'accepts function with no arity constraint', function () {
                const fn = ( msg ) => msg.value * 2;
                const errors = numberOrFunction( fn, {}, 'threshold' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts arrow function', function () {
                const errors = numberOrFunction( ( msg ) => msg.stdev * 0.5, {}, 'delta' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts function expression', function () {
                const fn = function ( msg ) {
                    return msg.baseline + 10;
                };
                const errors = numberOrFunction( fn, {}, 'threshold' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts function with correct arity', function () {
                const fn = ( msg ) => msg.value;
                const errors = numberOrFunction( fn, { arity: 1 }, 'threshold' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'rejects function with wrong arity', function () {
                const fn = ( a, b ) => a + b;
                const errors = numberOrFunction( fn, { arity: 1 }, 'threshold' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected function with 1 parameter' );
            } );

            it( 'accepts zero-arity function when specified', function () {
                const fn = () => 42;
                const errors = numberOrFunction( fn, { arity: 0 }, 'constant' );
                expect( errors ).to.deep.equal( [] );
            } );

        } );

        describe( 'invalid types', function () {

            it( 'rejects string', function () {
                const errors = numberOrFunction( 'hello', {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number or function' );
            } );

            it( 'rejects boolean', function () {
                const errors = numberOrFunction( true, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number or function' );
            } );

            it( 'rejects array', function () {
                const errors = numberOrFunction( [ 1, 2 ], {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number or function' );
            } );

            it( 'rejects object', function () {
                const errors = numberOrFunction( { temp: 5 }, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number or function' );
            } );

            it( 'rejects null', function () {
                const errors = numberOrFunction( null, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number or function' );
            } );

            it( 'rejects undefined', function () {
                const errors = numberOrFunction( undefined, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number or function' );
            } );

        } );

    } );

    describe( 'numberOrFunctionOrFieldKeyed', function () {

        describe( 'number values', function () {

            it( 'accepts positive number', function () {
                const errors = numberOrFunctionOrFieldKeyed( 42, {}, 'halfLife' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts zero', function () {
                const errors = numberOrFunctionOrFieldKeyed( 0, {}, 'threshold' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'rejects NaN', function () {
                const errors = numberOrFunctionOrFieldKeyed( NaN, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'NaN' );
            } );

            it( 'applies min constraint', function () {
                const errors = numberOrFunctionOrFieldKeyed( 5, { min: 10 }, 'halfLife' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Minimum value is 10' );
            } );

        } );

        describe( 'function values', function () {

            it( 'accepts function', function () {
                const fn = ( msg ) => msg.stdev * 0.5;
                const errors = numberOrFunctionOrFieldKeyed( fn, {}, 'delta' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts function with correct arity', function () {
                const fn = ( msg ) => msg.value;
                const errors = numberOrFunctionOrFieldKeyed( fn, { arity: 1 }, 'threshold' );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'rejects function with wrong arity', function () {
                const fn = () => 42;
                const errors = numberOrFunctionOrFieldKeyed( fn, { arity: 1 }, 'threshold' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected function with 1 parameter' );
            } );

        } );

        describe( 'field-keyed object with numbers', function () {

            it( 'accepts object with numeric values', function () {
                const errors = numberOrFunctionOrFieldKeyed(
                    { temp: 5, pressure: 20 },
                    {},
                    'halfLife'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'rejects object with NaN values', function () {
                const errors = numberOrFunctionOrFieldKeyed(
                    { temp: 5, pressure: NaN },
                    {},
                    'halfLife'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'halfLife.pressure' );
                expect( errors[ 0 ] ).to.include( 'NaN' );
            } );

            it( 'applies min constraint to each field', function () {
                const errors = numberOrFunctionOrFieldKeyed(
                    { temp: 5, pressure: 15 },
                    { min: 10 },
                    'halfLife'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'halfLife.temp' );
            } );

        } );

        describe( 'field-keyed object with functions', function () {

            it( 'accepts object with function values', function () {
                const errors = numberOrFunctionOrFieldKeyed(
                    { temp: ( msg ) => msg.t, pressure: ( msg ) => msg.p },
                    {},
                    'threshold'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'accepts object with mixed number and function values', function () {
                const errors = numberOrFunctionOrFieldKeyed(
                    { temp: 5, pressure: ( msg ) => msg.p },
                    {},
                    'halfLife'
                );
                expect( errors ).to.deep.equal( [] );
            } );

            it( 'validates function arity in field-keyed object', function () {
                const errors = numberOrFunctionOrFieldKeyed(
                    { temp: ( a, b ) => a + b },
                    { arity: 1 },
                    'threshold'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'threshold.temp' );
                expect( errors[ 0 ] ).to.include( 'Expected function with 1 parameter' );
            } );

        } );

        describe( 'invalid field-keyed values', function () {

            it( 'rejects object with string values', function () {
                const errors = numberOrFunctionOrFieldKeyed(
                    { temp: 5, pressure: 'high' },
                    {},
                    'halfLife'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'halfLife.pressure' );
                expect( errors[ 0 ] ).to.include( 'Expected number or function' );
            } );

            it( 'rejects object with boolean values', function () {
                const errors = numberOrFunctionOrFieldKeyed(
                    { temp: true },
                    {},
                    'flag'
                );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'flag.temp' );
            } );

            it( 'collects multiple errors', function () {
                const errors = numberOrFunctionOrFieldKeyed(
                    { temp: 'bad', pressure: null, humidity: 5 },
                    {},
                    'values'
                );
                expect( errors ).to.have.lengthOf( 2 );
            } );

        } );

        describe( 'invalid types', function () {

            it( 'rejects string', function () {
                const errors = numberOrFunctionOrFieldKeyed( 'hello', {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number, function, or per-field map' );
            } );

            it( 'rejects boolean', function () {
                const errors = numberOrFunctionOrFieldKeyed( true, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number, function, or per-field map' );
            } );

            it( 'rejects array', function () {
                const errors = numberOrFunctionOrFieldKeyed( [ 1, 2 ], {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number, function, or per-field map' );
            } );

            it( 'rejects null', function () {
                const errors = numberOrFunctionOrFieldKeyed( null, {}, 'value' );
                expect( errors ).to.have.lengthOf( 1 );
                expect( errors[ 0 ] ).to.include( 'Expected number, function, or per-field map' );
            } );

        } );

    } );

} );

/**
 * @fileoverview Tests for field-keyed option resolvers.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { resolveScalar, resolveNestedObject, resolveArray } from '../resolve-field-keyed.js';

describe( 'resolve-field-keyed utilities', function () {

    describe( 'resolveScalar', function () {

        describe( 'null/undefined handling', function () {
            it( 'returns undefined for null', function () {
                expect( resolveScalar( null, 'temp' ) ).to.equal( undefined );
            } );

            it( 'returns undefined for undefined', function () {
                expect( resolveScalar( undefined, 'temp' ) ).to.equal( undefined );
            } );
        } );

        describe( 'direct scalar values', function () {
            it( 'returns number directly', function () {
                expect( resolveScalar( 20, 'temp' ) ).to.equal( 20 );
            } );

            it( 'returns zero directly', function () {
                expect( resolveScalar( 0, 'temp' ) ).to.equal( 0 );
            } );

            it( 'returns negative number directly', function () {
                expect( resolveScalar( -15, 'temp' ) ).to.equal( -15 );
            } );

            it( 'returns string directly', function () {
                expect( resolveScalar( 'lowpass', 'temp' ) ).to.equal( 'lowpass' );
            } );

            it( 'returns empty string directly', function () {
                expect( resolveScalar( '', 'temp' ) ).to.equal( '' );
            } );

            it( 'returns boolean true directly', function () {
                expect( resolveScalar( true, 'temp' ) ).to.equal( true );
            } );

            it( 'returns boolean false directly', function () {
                expect( resolveScalar( false, 'temp' ) ).to.equal( false );
            } );

            it( 'returns function directly', function () {
                const fn = ( msg ) => msg.speed;
                expect( resolveScalar( fn, 'temp' ) ).to.equal( fn );
            } );
        } );

        describe( 'field-keyed scalar values', function () {
            it( 'extracts number by field name', function () {
                const option = { temp: 5, pressure: 20 };
                expect( resolveScalar( option, 'temp' ) ).to.equal( 5 );
                expect( resolveScalar( option, 'pressure' ) ).to.equal( 20 );
            } );

            it( 'extracts zero by field name', function () {
                const option = { temp: 0, pressure: 20 };
                expect( resolveScalar( option, 'temp' ) ).to.equal( 0 );
            } );

            it( 'extracts string by field name', function () {
                const option = { temp: 'lowpass', pressure: 'highpass' };
                expect( resolveScalar( option, 'temp' ) ).to.equal( 'lowpass' );
            } );

            it( 'extracts boolean by field name', function () {
                const option = { temp: true, pressure: false };
                expect( resolveScalar( option, 'temp' ) ).to.equal( true );
                expect( resolveScalar( option, 'pressure' ) ).to.equal( false );
            } );

            it( 'extracts function by field name', function () {
                const fnTemp = ( msg ) => msg.t;
                const fnPressure = ( msg ) => msg.p;
                const option = { temp: fnTemp, pressure: fnPressure };
                expect( resolveScalar( option, 'temp' ) ).to.equal( fnTemp );
                expect( resolveScalar( option, 'pressure' ) ).to.equal( fnPressure );
            } );

            it( 'returns undefined for missing field', function () {
                const option = { temp: 5, pressure: 20 };
                expect( resolveScalar( option, 'humidity' ) ).to.equal( undefined );
            } );
        } );

        describe( 'edge cases', function () {
            it( 'returns undefined for array (use resolveArray instead)', function () {
                expect( resolveScalar( [ 1, 2, 3 ], 'temp' ) ).to.equal( undefined );
            } );

            it( 'returns undefined for nested object in field-keyed', function () {
                // { temp: { min: 0, max: 100 } } is NOT a scalar — use resolveNestedObject
                const option = { temp: { min: 0, max: 100 } };
                expect( resolveScalar( option, 'temp' ) ).to.equal( undefined );
            } );

            it( 'returns undefined for plain object without field key', function () {
                // { min: 0, max: 100 } is a direct nested object, not a scalar
                const option = { min: 0, max: 100 };
                expect( resolveScalar( option, 'temp' ) ).to.equal( undefined );
            } );
        } );

    } );

    describe( 'resolveNestedObject', function () {

        describe( 'null/undefined handling', function () {
            it( 'returns undefined for null', function () {
                expect( resolveNestedObject( null, 'temp', [ 'min', 'max' ] ) ).to.equal( undefined );
            } );

            it( 'returns undefined for undefined', function () {
                expect( resolveNestedObject( undefined, 'temp', [ 'min', 'max' ] ) ).to.equal( undefined );
            } );
        } );

        describe( 'direct nested object', function () {
            it( 'returns object with expected keys directly', function () {
                const option = { min: 0, max: 100 };
                const result = resolveNestedObject( option, 'temp', [ 'min', 'max' ] );
                expect( result ).to.deep.equal( { min: 0, max: 100 } );
            } );

            it( 'returns object with partial expected keys', function () {
                const option = { min: 0 };  // Only min, no max
                const result = resolveNestedObject( option, 'temp', [ 'min', 'max' ] );
                expect( result ).to.deep.equal( { min: 0 } );
            } );

            it( 'handles function values in nested object', function () {
                const fn = ( msg ) => msg.maxPressure;
                const option = { min: 0, max: fn };
                const result = resolveNestedObject( option, 'temp', [ 'min', 'max' ] );
                expect( result.min ).to.equal( 0 );
                expect( result.max ).to.equal( fn );
            } );
        } );

        describe( 'field-keyed nested object', function () {
            it( 'extracts nested object by field name', function () {
                const option = {
                    temp: { min: -40, max: 85 },
                    pressure: { min: 0, max: 120 }
                };
                expect( resolveNestedObject( option, 'temp', [ 'min', 'max' ] ) )
                    .to.deep.equal( { min: -40, max: 85 } );
                expect( resolveNestedObject( option, 'pressure', [ 'min', 'max' ] ) )
                    .to.deep.equal( { min: 0, max: 120 } );
            } );

            it( 'returns undefined for missing field', function () {
                const option = {
                    temp: { min: -40, max: 85 }
                };
                expect( resolveNestedObject( option, 'humidity', [ 'min', 'max' ] ) )
                    .to.equal( undefined );
            } );

            it( 'handles function values in field-keyed nested object', function () {
                const fn = ( msg ) => msg.maxTemp;
                const option = {
                    temp: { min: 0, max: fn }
                };
                const result = resolveNestedObject( option, 'temp', [ 'min', 'max' ] );
                expect( result.min ).to.equal( 0 );
                expect( result.max ).to.equal( fn );
            } );
        } );

        describe( 'edge cases', function () {
            it( 'returns undefined for array', function () {
                expect( resolveNestedObject( [ 1, 2 ], 'temp', [ 'min', 'max' ] ) )
                    .to.equal( undefined );
            } );

            it( 'returns undefined for scalar', function () {
                expect( resolveNestedObject( 42, 'temp', [ 'min', 'max' ] ) )
                    .to.equal( undefined );
            } );

            it( 'returns undefined when no expected keys present', function () {
                const option = { foo: 1, bar: 2 };
                expect( resolveNestedObject( option, 'temp', [ 'min', 'max' ] ) )
                    .to.equal( undefined );
            } );

            it( 'prefers field-keyed over direct when field exists', function () {
                // Ambiguous: { temp: { min: 1 }, min: 0, max: 100 }
                // Field-keyed wins because option[ 'temp' ] has expected key
                const option = { temp: { min: 1 }, min: 0, max: 100 };
                expect( resolveNestedObject( option, 'temp', [ 'min', 'max' ] ) )
                    .to.deep.equal( { min: 1 } );
            } );
        } );

    } );

    describe( 'resolveArray', function () {

        describe( 'null/undefined handling', function () {
            it( 'returns undefined for null', function () {
                expect( resolveArray( null, 'temp' ) ).to.equal( undefined );
            } );

            it( 'returns undefined for undefined', function () {
                expect( resolveArray( undefined, 'temp' ) ).to.equal( undefined );
            } );
        } );

        describe( 'direct array', function () {
            it( 'returns array directly', function () {
                const option = [ 10, 50, 90 ];
                expect( resolveArray( option, 'temp' ) ).to.deep.equal( [ 10, 50, 90 ] );
            } );

            it( 'returns empty array directly', function () {
                expect( resolveArray( [], 'temp' ) ).to.deep.equal( [] );
            } );

            it( 'returns array of strings directly', function () {
                const option = [ 'low', 'normal', 'high' ];
                expect( resolveArray( option, 'temp' ) ).to.deep.equal( [ 'low', 'normal', 'high' ] );
            } );
        } );

        describe( 'field-keyed array', function () {
            it( 'extracts array by field name', function () {
                const option = {
                    temp: [ 15, 25 ],
                    pressure: [ 30, 60 ]
                };
                expect( resolveArray( option, 'temp' ) ).to.deep.equal( [ 15, 25 ] );
                expect( resolveArray( option, 'pressure' ) ).to.deep.equal( [ 30, 60 ] );
            } );

            it( 'returns undefined for missing field', function () {
                const option = {
                    temp: [ 15, 25 ]
                };
                expect( resolveArray( option, 'humidity' ) ).to.equal( undefined );
            } );

            it( 'returns undefined when field value is not array', function () {
                const option = {
                    temp: 42  // Not an array
                };
                expect( resolveArray( option, 'temp' ) ).to.equal( undefined );
            } );
        } );

        describe( 'edge cases', function () {
            it( 'returns undefined for scalar', function () {
                expect( resolveArray( 42, 'temp' ) ).to.equal( undefined );
            } );

            it( 'returns undefined for string', function () {
                expect( resolveArray( 'hello', 'temp' ) ).to.equal( undefined );
            } );

            it( 'returns undefined for nested object without arrays', function () {
                const option = { min: 0, max: 100 };
                expect( resolveArray( option, 'temp' ) ).to.equal( undefined );
            } );
        } );

    } );

    describe( 'mixed parameter patterns', function () {

        it( 'handles mixed direct and field-keyed in same spec', function () {
            // Simulates: { thresholds: { temp: [...], pressure: [...] }, categories: [...] }
            const thresholdsOption = {
                temp: [ 15, 25 ],
                pressure: [ 30, 60 ]
            };
            const categoriesOption = [ 'low', 'normal', 'high' ];

            // temp node
            expect( resolveArray( thresholdsOption, 'temp' ) ).to.deep.equal( [ 15, 25 ] );
            expect( resolveArray( categoriesOption, 'temp' ) ).to.deep.equal( [ 'low', 'normal', 'high' ] );

            // pressure node
            expect( resolveArray( thresholdsOption, 'pressure' ) ).to.deep.equal( [ 30, 60 ] );
            expect( resolveArray( categoriesOption, 'pressure' ) ).to.deep.equal( [ 'low', 'normal', 'high' ] );
        } );

        it( 'handles mixed scalar and nested object in same spec', function () {
            // Simulates: { halfLife: 20, ranges: { temp: {...}, pressure: {...} } }
            const halfLifeOption = 20;
            const rangesOption = {
                temp: { min: -40, max: 85 },
                pressure: { min: 0, max: 120 }
            };

            // temp node
            expect( resolveScalar( halfLifeOption, 'temp' ) ).to.equal( 20 );
            expect( resolveNestedObject( rangesOption, 'temp', [ 'min', 'max' ] ) )
                .to.deep.equal( { min: -40, max: 85 } );

            // pressure node
            expect( resolveScalar( halfLifeOption, 'pressure' ) ).to.equal( 20 );
            expect( resolveNestedObject( rangesOption, 'pressure', [ 'min', 'max' ] ) )
                .to.deep.equal( { min: 0, max: 120 } );
        } );

    } );

} );

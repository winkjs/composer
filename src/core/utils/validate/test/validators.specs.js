// core/utils/validate/test/validators.specs.js

/**
 * @fileoverview Tests for general-purpose validators
 *
 * Tests cover:
 * - identifier: JavaScript identifier validation
 * - noSpaces: Whitespace-free string validation
 * - inRange: Range validator factory
 * - oneOf: Enum validator factory
 * - matches: Pattern validator factory
 * - positive/nonNegative/nonNegativeFinite: Number sign validators
 * - integer/positiveInteger: Integer validators
 * - isFinite: Finite number validation
 * - nonNegativeOrFunction/positiveOrFunction: Tunable-aware validators
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { validators } from '../validators.js';

describe( 'General-purpose validators', function () {

    // ========================================================================
    // identifier
    // ========================================================================

    describe( 'identifier', function () {

        it( 'accepts valid identifier starting with letter', function () {
            expect( validators.identifier( 'myVar' ) ).to.equal( true );
        } );

        it( 'accepts valid identifier starting with underscore', function () {
            expect( validators.identifier( '_private' ) ).to.equal( true );
        } );

        it( 'accepts valid identifier starting with dollar sign', function () {
            expect( validators.identifier( '$jquery' ) ).to.equal( true );
        } );

        it( 'accepts identifier with numbers after first char', function () {
            expect( validators.identifier( 'var123' ) ).to.equal( true );
        } );

        it( 'accepts single character identifier', function () {
            expect( validators.identifier( 'x' ) ).to.equal( true );
        } );

        it( 'accepts underscore-only identifier', function () {
            expect( validators.identifier( '_' ) ).to.equal( true );
        } );

        it( 'accepts camelCase identifier', function () {
            expect( validators.identifier( 'myVariableName' ) ).to.equal( true );
        } );

        it( 'rejects identifier starting with number', function () {
            expect( validators.identifier( '123abc' ) ).to.equal( false );
        } );

        it( 'rejects identifier with hyphen', function () {
            expect( validators.identifier( 'my-var' ) ).to.equal( false );
        } );

        it( 'rejects identifier with space', function () {
            expect( validators.identifier( 'my var' ) ).to.equal( false );
        } );

        it( 'rejects empty string', function () {
            expect( validators.identifier( '' ) ).to.equal( false );
        } );

        it( 'rejects identifier with special characters', function () {
            expect( validators.identifier( 'my@var' ) ).to.equal( false );
        } );

        it( 'rejects null', function () {
            expect( validators.identifier( null ) ).to.equal( false );
        } );

        it( 'rejects undefined', function () {
            expect( validators.identifier( undefined ) ).to.equal( false );
        } );

        it( 'rejects number', function () {
            expect( validators.identifier( 123 ) ).to.equal( false );
        } );

        it( 'rejects object', function () {
            expect( validators.identifier( {} ) ).to.equal( false );
        } );

        it( 'rejects array', function () {
            expect( validators.identifier( [] ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // noSpaces
    // ========================================================================

    describe( 'noSpaces', function () {

        it( 'accepts string without whitespace', function () {
            expect( validators.noSpaces( 'nospaces' ) ).to.equal( true );
        } );

        it( 'accepts string with special characters but no whitespace', function () {
            expect( validators.noSpaces( 'hello@world.com' ) ).to.equal( true );
        } );

        it( 'accepts single character', function () {
            expect( validators.noSpaces( 'x' ) ).to.equal( true );
        } );

        it( 'rejects empty string', function () {
            expect( validators.noSpaces( '' ) ).to.equal( false );
        } );

        it( 'rejects string with space', function () {
            expect( validators.noSpaces( 'has space' ) ).to.equal( false );
        } );

        it( 'rejects string with multiple spaces', function () {
            expect( validators.noSpaces( 'has  many  spaces' ) ).to.equal( false );
        } );

        it( 'rejects string with leading space', function () {
            expect( validators.noSpaces( ' leading' ) ).to.equal( false );
        } );

        it( 'rejects string with trailing space', function () {
            expect( validators.noSpaces( 'trailing ' ) ).to.equal( false );
        } );

        it( 'rejects whitespace-only string', function () {
            expect( validators.noSpaces( '   ' ) ).to.equal( false );
        } );

        it( 'rejects string with tab', function () {
            expect( validators.noSpaces( 'has\ttab' ) ).to.equal( false );
        } );

        it( 'rejects string with newline', function () {
            expect( validators.noSpaces( 'has\nnewline' ) ).to.equal( false );
        } );

        it( 'rejects tab-only string', function () {
            expect( validators.noSpaces( '\t' ) ).to.equal( false );
        } );

        it( 'rejects non-string (number)', function () {
            expect( validators.noSpaces( 123 ) ).to.equal( false );
        } );

        it( 'rejects non-string (null)', function () {
            expect( validators.noSpaces( null ) ).to.equal( false );
        } );

        it( 'rejects non-string (undefined)', function () {
            expect( validators.noSpaces( undefined ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // inRange
    // ========================================================================

    describe( 'inRange', function () {

        it( 'accepts value within range', function () {
            const validator = validators.inRange( 0, 100 );
            expect( validator( 50 ) ).to.equal( true );
        } );

        it( 'accepts value at minimum boundary', function () {
            const validator = validators.inRange( 0, 100 );
            expect( validator( 0 ) ).to.equal( true );
        } );

        it( 'accepts value at maximum boundary', function () {
            const validator = validators.inRange( 0, 100 );
            expect( validator( 100 ) ).to.equal( true );
        } );

        it( 'accepts negative value in negative range', function () {
            const validator = validators.inRange( -100, -10 );
            expect( validator( -50 ) ).to.equal( true );
        } );

        it( 'accepts decimal within range', function () {
            const validator = validators.inRange( 0, 1 );
            expect( validator( 0.5 ) ).to.equal( true );
        } );

        it( 'rejects value below minimum', function () {
            const validator = validators.inRange( 0, 100 );
            expect( validator( -1 ) ).to.equal( false );
        } );

        it( 'rejects value above maximum', function () {
            const validator = validators.inRange( 0, 100 );
            expect( validator( 101 ) ).to.equal( false );
        } );

        it( 'rejects non-number (string)', function () {
            const validator = validators.inRange( 0, 100 );
            expect( validator( '50' ) ).to.equal( false );
        } );

        it( 'rejects NaN', function () {
            const validator = validators.inRange( 0, 100 );
            expect( validator( NaN ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // oneOf
    // ========================================================================

    describe( 'oneOf', function () {

        it( 'accepts value in options', function () {
            const validator = validators.oneOf( [ 'a', 'b', 'c' ] );
            expect( validator( 'b' ) ).to.equal( true );
        } );

        it( 'accepts first option', function () {
            const validator = validators.oneOf( [ 'first', 'second', 'third' ] );
            expect( validator( 'first' ) ).to.equal( true );
        } );

        it( 'accepts last option', function () {
            const validator = validators.oneOf( [ 'first', 'second', 'third' ] );
            expect( validator( 'third' ) ).to.equal( true );
        } );

        it( 'accepts number option', function () {
            const validator = validators.oneOf( [ 1, 2, 3 ] );
            expect( validator( 2 ) ).to.equal( true );
        } );

        it( 'rejects value not in options', function () {
            const validator = validators.oneOf( [ 'a', 'b', 'c' ] );
            expect( validator( 'd' ) ).to.equal( false );
        } );

        it( 'rejects similar but different value', function () {
            const validator = validators.oneOf( [ 'abc' ] );
            expect( validator( 'ABC' ) ).to.equal( false );
        } );

        it( 'uses strict equality', function () {
            const validator = validators.oneOf( [ 1, 2, 3 ] );
            expect( validator( '1' ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // matches
    // ========================================================================

    describe( 'matches', function () {

        it( 'accepts string matching pattern', function () {
            const validator = validators.matches( /^[a-z]+$/ );
            expect( validator( 'hello' ) ).to.equal( true );
        } );

        it( 'accepts string matching complex pattern', function () {
            const validator = validators.matches( /^\d{3}-\d{4}$/ );
            expect( validator( '123-4567' ) ).to.equal( true );
        } );

        it( 'rejects string not matching pattern', function () {
            const validator = validators.matches( /^[a-z]+$/ );
            expect( validator( 'Hello' ) ).to.equal( false );
        } );

        it( 'rejects non-string (number)', function () {
            const validator = validators.matches( /^\d+$/ );
            expect( validator( 123 ) ).to.equal( false );
        } );

        it( 'rejects non-string (object)', function () {
            const validator = validators.matches( /.*/ );
            expect( validator( {} ) ).to.equal( false );
        } );

        it( 'rejects null', function () {
            const validator = validators.matches( /.*/ );
            expect( validator( null ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // positive
    // ========================================================================

    describe( 'positive', function () {

        it( 'accepts positive integer', function () {
            expect( validators.positive( 5 ) ).to.equal( true );
        } );

        it( 'accepts positive decimal', function () {
            expect( validators.positive( 0.001 ) ).to.equal( true );
        } );

        it( 'accepts large positive number', function () {
            expect( validators.positive( 1e10 ) ).to.equal( true );
        } );

        it( 'rejects zero', function () {
            expect( validators.positive( 0 ) ).to.equal( false );
        } );

        it( 'rejects negative number', function () {
            expect( validators.positive( -1 ) ).to.equal( false );
        } );

        it( 'rejects non-number (string)', function () {
            expect( validators.positive( '5' ) ).to.equal( false );
        } );

        it( 'rejects NaN', function () {
            expect( validators.positive( NaN ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // nonNegative
    // ========================================================================

    describe( 'nonNegative', function () {

        it( 'accepts positive number', function () {
            expect( validators.nonNegative( 5 ) ).to.equal( true );
        } );

        it( 'accepts zero', function () {
            expect( validators.nonNegative( 0 ) ).to.equal( true );
        } );

        it( 'accepts small positive decimal', function () {
            expect( validators.nonNegative( 0.001 ) ).to.equal( true );
        } );

        it( 'rejects negative number', function () {
            expect( validators.nonNegative( -1 ) ).to.equal( false );
        } );

        it( 'rejects small negative decimal', function () {
            expect( validators.nonNegative( -0.001 ) ).to.equal( false );
        } );

        it( 'rejects non-number (string)', function () {
            expect( validators.nonNegative( '0' ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // nonNegativeFinite
    // ========================================================================

    describe( 'nonNegativeFinite', function () {

        it( 'accepts positive finite number', function () {
            expect( validators.nonNegativeFinite( 5 ) ).to.equal( true );
        } );

        it( 'accepts zero', function () {
            expect( validators.nonNegativeFinite( 0 ) ).to.equal( true );
        } );

        it( 'accepts small positive decimal', function () {
            expect( validators.nonNegativeFinite( 0.001 ) ).to.equal( true );
        } );

        it( 'rejects negative number', function () {
            expect( validators.nonNegativeFinite( -1 ) ).to.equal( false );
        } );

        it( 'rejects Infinity', function () {
            expect( validators.nonNegativeFinite( Infinity ) ).to.equal( false );
        } );

        it( 'rejects negative Infinity', function () {
            expect( validators.nonNegativeFinite( -Infinity ) ).to.equal( false );
        } );

        it( 'rejects NaN', function () {
            expect( validators.nonNegativeFinite( NaN ) ).to.equal( false );
        } );

        it( 'rejects non-number (string)', function () {
            expect( validators.nonNegativeFinite( '0' ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // integer
    // ========================================================================

    describe( 'integer', function () {

        it( 'accepts positive integer', function () {
            expect( validators.integer( 42 ) ).to.equal( true );
        } );

        it( 'accepts zero', function () {
            expect( validators.integer( 0 ) ).to.equal( true );
        } );

        it( 'accepts negative integer', function () {
            expect( validators.integer( -10 ) ).to.equal( true );
        } );

        it( 'rejects decimal number', function () {
            expect( validators.integer( 3.14 ) ).to.equal( false );
        } );

        it( 'rejects non-number (string)', function () {
            expect( validators.integer( '42' ) ).to.equal( false );
        } );

        it( 'rejects Infinity', function () {
            expect( validators.integer( Infinity ) ).to.equal( false );
        } );

        it( 'rejects NaN', function () {
            expect( validators.integer( NaN ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // positiveInteger
    // ========================================================================

    describe( 'positiveInteger', function () {

        it( 'accepts positive integer', function () {
            expect( validators.positiveInteger( 1 ) ).to.equal( true );
        } );

        it( 'accepts large positive integer', function () {
            expect( validators.positiveInteger( 1000000 ) ).to.equal( true );
        } );

        it( 'rejects zero', function () {
            expect( validators.positiveInteger( 0 ) ).to.equal( false );
        } );

        it( 'rejects negative integer', function () {
            expect( validators.positiveInteger( -5 ) ).to.equal( false );
        } );

        it( 'rejects positive decimal', function () {
            expect( validators.positiveInteger( 3.14 ) ).to.equal( false );
        } );

        it( 'rejects non-number', function () {
            expect( validators.positiveInteger( '1' ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // nonZero
    // ========================================================================

    describe( 'nonZero', function () {

        it( 'accepts positive number', function () {
            expect( validators.nonZero( 1 ) ).to.equal( true );
        } );

        it( 'accepts negative number', function () {
            expect( validators.nonZero( -1 ) ).to.equal( true );
        } );

        it( 'accepts decimal', function () {
            expect( validators.nonZero( 0.001 ) ).to.equal( true );
        } );

        it( 'rejects zero', function () {
            expect( validators.nonZero( 0 ) ).to.equal( false );
        } );

        it( 'rejects non-number (string)', function () {
            expect( validators.nonZero( '1' ) ).to.equal( false );
        } );

        it( 'rejects non-number (null)', function () {
            expect( validators.nonZero( null ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // isFinite
    // ========================================================================

    describe( 'isFinite', function () {

        it( 'accepts positive finite number', function () {
            expect( validators.isFinite( 42 ) ).to.equal( true );
        } );

        it( 'accepts zero', function () {
            expect( validators.isFinite( 0 ) ).to.equal( true );
        } );

        it( 'accepts negative finite number', function () {
            expect( validators.isFinite( -42 ) ).to.equal( true );
        } );

        it( 'accepts decimal', function () {
            expect( validators.isFinite( 3.14159 ) ).to.equal( true );
        } );

        it( 'rejects Infinity', function () {
            expect( validators.isFinite( Infinity ) ).to.equal( false );
        } );

        it( 'rejects negative Infinity', function () {
            expect( validators.isFinite( -Infinity ) ).to.equal( false );
        } );

        it( 'rejects NaN', function () {
            expect( validators.isFinite( NaN ) ).to.equal( false );
        } );

        it( 'rejects non-number (string)', function () {
            expect( validators.isFinite( '42' ) ).to.equal( false );
        } );

        it( 'rejects non-number (null)', function () {
            expect( validators.isFinite( null ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // nonNegativeOrFunction
    // ========================================================================

    describe( 'nonNegativeOrFunction', function () {

        it( 'accepts positive finite number', function () {
            expect( validators.nonNegativeOrFunction( 5 ) ).to.equal( true );
        } );

        it( 'accepts zero', function () {
            expect( validators.nonNegativeOrFunction( 0 ) ).to.equal( true );
        } );

        it( 'accepts function', function () {
            const fn = () => 5;
            expect( validators.nonNegativeOrFunction( fn ) ).to.equal( true );
        } );

        it( 'accepts arrow function', function () {
            expect( validators.nonNegativeOrFunction( ( msg ) => msg.value ) ).to.equal( true );
        } );

        it( 'rejects negative number', function () {
            expect( validators.nonNegativeOrFunction( -1 ) ).to.equal( false );
        } );

        it( 'rejects Infinity', function () {
            expect( validators.nonNegativeOrFunction( Infinity ) ).to.equal( false );
        } );

        it( 'rejects NaN', function () {
            expect( validators.nonNegativeOrFunction( NaN ) ).to.equal( false );
        } );

        it( 'rejects string', function () {
            expect( validators.nonNegativeOrFunction( '5' ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // positiveOrFunction
    // ========================================================================

    describe( 'positiveOrFunction', function () {

        it( 'accepts positive finite number', function () {
            expect( validators.positiveOrFunction( 5 ) ).to.equal( true );
        } );

        it( 'accepts small positive number', function () {
            expect( validators.positiveOrFunction( 0.001 ) ).to.equal( true );
        } );

        it( 'accepts function', function () {
            const fn = () => 5;
            expect( validators.positiveOrFunction( fn ) ).to.equal( true );
        } );

        it( 'accepts arrow function', function () {
            expect( validators.positiveOrFunction( ( msg ) => msg.value ) ).to.equal( true );
        } );

        it( 'rejects zero', function () {
            expect( validators.positiveOrFunction( 0 ) ).to.equal( false );
        } );

        it( 'rejects negative number', function () {
            expect( validators.positiveOrFunction( -1 ) ).to.equal( false );
        } );

        it( 'rejects Infinity', function () {
            expect( validators.positiveOrFunction( Infinity ) ).to.equal( false );
        } );

        it( 'rejects NaN', function () {
            expect( validators.positiveOrFunction( NaN ) ).to.equal( false );
        } );

        it( 'rejects string', function () {
            expect( validators.positiveOrFunction( '5' ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // nonEmptyString
    // ========================================================================

    describe( 'nonEmptyString', function () {

        it( 'accepts non-empty string', function () {
            expect( validators.nonEmptyString( 'hello' ) ).to.equal( true );
        } );

        it( 'accepts single character', function () {
            expect( validators.nonEmptyString( 'x' ) ).to.equal( true );
        } );

        it( 'accepts string with spaces', function () {
            expect( validators.nonEmptyString( '  ' ) ).to.equal( true );
        } );

        it( 'rejects empty string', function () {
            expect( validators.nonEmptyString( '' ) ).to.equal( false );
        } );

        it( 'rejects null', function () {
            expect( validators.nonEmptyString( null ) ).to.equal( false );
        } );

        it( 'rejects undefined', function () {
            expect( validators.nonEmptyString( undefined ) ).to.equal( false );
        } );

        it( 'rejects number', function () {
            expect( validators.nonEmptyString( 123 ) ).to.equal( false );
        } );

        it( 'rejects object', function () {
            expect( validators.nonEmptyString( {} ) ).to.equal( false );
        } );

        it( 'rejects array', function () {
            expect( validators.nonEmptyString( [] ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // integerString
    // ========================================================================

    describe( 'integerString', function () {

        it( 'accepts "0"', function () {
            expect( validators.integerString( '0' ) ).to.equal( true );
        } );

        it( 'accepts "1"', function () {
            expect( validators.integerString( '1' ) ).to.equal( true );
        } );

        it( 'accepts "123"', function () {
            expect( validators.integerString( '123' ) ).to.equal( true );
        } );

        it( 'accepts large number "999999"', function () {
            expect( validators.integerString( '999999' ) ).to.equal( true );
        } );

        it( 'rejects negative "-1"', function () {
            expect( validators.integerString( '-1' ) ).to.equal( false );
        } );

        it( 'rejects leading zero "01"', function () {
            expect( validators.integerString( '01' ) ).to.equal( false );
        } );

        it( 'rejects leading zeros "007"', function () {
            expect( validators.integerString( '007' ) ).to.equal( false );
        } );

        it( 'rejects multiple zeros "00"', function () {
            expect( validators.integerString( '00' ) ).to.equal( false );
        } );

        it( 'rejects empty string', function () {
            expect( validators.integerString( '' ) ).to.equal( false );
        } );

        it( 'rejects non-numeric "abc"', function () {
            expect( validators.integerString( 'abc' ) ).to.equal( false );
        } );

        it( 'rejects mixed "12a"', function () {
            expect( validators.integerString( '12a' ) ).to.equal( false );
        } );

        it( 'rejects decimal "1.5"', function () {
            expect( validators.integerString( '1.5' ) ).to.equal( false );
        } );

        it( 'rejects number type', function () {
            expect( validators.integerString( 123 ) ).to.equal( false );
        } );

        it( 'rejects null', function () {
            expect( validators.integerString( null ) ).to.equal( false );
        } );

        it( 'rejects undefined', function () {
            expect( validators.integerString( undefined ) ).to.equal( false );
        } );

        it( 'rejects object', function () {
            expect( validators.integerString( {} ) ).to.equal( false );
        } );

    } );

} );

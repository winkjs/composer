// src/core/semantics/test/enum-schema.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    enumSchema,
    validEnumKey,
    validEnumKeys,
    validEnumValues
} from '../schemas/index.js';
import { validateWithSchema } from '../../utils/validate/index.js';

describe( 'Enum Schema Validators', function () {

    // ========================================================================
    // validEnumKey
    // ========================================================================

    describe( 'validEnumKey', function () {

        // Valid numeric strings (canonical form)
        it( 'should accept zero', function () {
            expect( validEnumKey( '0' ) ).to.equal( true );
        } );

        it( 'should accept positive integers', function () {
            expect( validEnumKey( '1' ) ).to.equal( true );
            expect( validEnumKey( '42' ) ).to.equal( true );
            expect( validEnumKey( '123' ) ).to.equal( true );
        } );

        it( 'should accept negative integers', function () {
            expect( validEnumKey( '-1' ) ).to.equal( true );
            expect( validEnumKey( '-99' ) ).to.equal( true );
        } );

        it( 'should accept floating point numbers', function () {
            expect( validEnumKey( '0.5' ) ).to.equal( true );
            expect( validEnumKey( '3.14' ) ).to.equal( true );
            expect( validEnumKey( '-2.5' ) ).to.equal( true );
        } );

        // Valid boolean strings
        it( 'should accept "true"', function () {
            expect( validEnumKey( 'true' ) ).to.equal( true );
        } );

        it( 'should accept "false"', function () {
            expect( validEnumKey( 'false' ) ).to.equal( true );
        } );

        // Valid identifiers
        it( 'should accept single letter identifiers', function () {
            expect( validEnumKey( 'R' ) ).to.equal( true );
            expect( validEnumKey( 'G' ) ).to.equal( true );
            expect( validEnumKey( 'B' ) ).to.equal( true );
        } );

        it( 'should accept word identifiers', function () {
            expect( validEnumKey( 'idle' ) ).to.equal( true );
            expect( validEnumKey( 'running' ) ).to.equal( true );
            expect( validEnumKey( 'ERROR' ) ).to.equal( true );
        } );

        it( 'should accept identifiers with underscores', function () {
            expect( validEnumKey( 'state_1' ) ).to.equal( true );
            expect( validEnumKey( '_private' ) ).to.equal( true );
            expect( validEnumKey( 'MACHINE_STATE' ) ).to.equal( true );
        } );

        it( 'should accept identifiers with dollar sign', function () {
            expect( validEnumKey( '$special' ) ).to.equal( true );
            expect( validEnumKey( 'value$1' ) ).to.equal( true );
        } );

        // Invalid keys - not numeric, boolean, or identifier
        it( 'should reject non-canonical numeric forms', function () {
            expect( validEnumKey( '01' ) ).to.equal( false );   // Leading zero
            expect( validEnumKey( '007' ) ).to.equal( false );  // Leading zeros
            expect( validEnumKey( '+1' ) ).to.equal( false );   // Explicit plus
            expect( validEnumKey( '1.' ) ).to.equal( false );   // Trailing decimal
            expect( validEnumKey( '.5' ) ).to.equal( false );   // Leading decimal
        } );

        it( 'should accept NaN and Infinity as valid identifiers', function () {
            // NaN and Infinity are valid JS identifiers, so they pass
            expect( validEnumKey( 'NaN' ) ).to.equal( true );
            expect( validEnumKey( 'Infinity' ) ).to.equal( true );
        } );

        it( 'should reject malformed numeric strings', function () {
            expect( validEnumKey( '-Infinity' ) ).to.equal( false ); // Starts with -
            expect( validEnumKey( '3.14.5' ) ).to.equal( false );    // Invalid number
        } );

        it( 'should reject mixed alphanumeric starting with digit', function () {
            expect( validEnumKey( '123abc' ) ).to.equal( false );
            expect( validEnumKey( '1state' ) ).to.equal( false );
        } );

        it( 'should reject special characters', function () {
            expect( validEnumKey( '@#$%' ) ).to.equal( false );
            expect( validEnumKey( 'has-dash' ) ).to.equal( false );
            expect( validEnumKey( 'has.dot' ) ).to.equal( false );
        } );

        it( 'should reject keys with whitespace', function () {
            expect( validEnumKey( 'has space' ) ).to.equal( false );
            expect( validEnumKey( ' leading' ) ).to.equal( false );
            expect( validEnumKey( 'trailing ' ) ).to.equal( false );
            expect( validEnumKey( 'has\ttab' ) ).to.equal( false );
            expect( validEnumKey( '   ' ) ).to.equal( false );
        } );

        it( 'should reject empty string', function () {
            expect( validEnumKey( '' ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // validEnumKeys
    // ========================================================================

    describe( 'validEnumKeys', function () {

        it( 'should accept non-negative integer string keys', function () {
            const values = { '0': 'a', '1': 'b', '2': 'c' };
            expect( validEnumKeys( values ) ).to.equal( true );
        } );

        it( 'should accept negative integer string keys', function () {
            const values = { '-1': 'negative', '0': 'zero', '1': 'positive' };
            expect( validEnumKeys( values ) ).to.equal( true );
        } );

        it( 'should accept floating point string keys', function () {
            const values = { '0.5': 'half', '3.14': 'pi' };
            expect( validEnumKeys( values ) ).to.equal( true );
        } );

        it( 'should accept boolean string keys', function () {
            const values = { 'true': 'Yes', 'false': 'No' };
            expect( validEnumKeys( values ) ).to.equal( true );
        } );

        it( 'should accept text code keys', function () {
            const values = { 'R': 'Red', 'G': 'Green', 'B': 'Blue' };
            expect( validEnumKeys( values ) ).to.equal( true );
        } );

        it( 'should accept single key', function () {
            const values = { 'idle': 'Idle State' };
            expect( validEnumKeys( values ) ).to.equal( true );
        } );

        it( 'should reject keys with spaces', function () {
            const values = { 'has space': 'value' };
            expect( validEnumKeys( values ) ).to.equal( false );
        } );

        it( 'should reject keys with tabs', function () {
            const values = { 'has\ttab': 'value' };
            expect( validEnumKeys( values ) ).to.equal( false );
        } );

        it( 'should reject whitespace-only keys', function () {
            const values = { '   ': 'value' };
            expect( validEnumKeys( values ) ).to.equal( false );
        } );

        it( 'should reject invalid mixed alphanumeric keys', function () {
            const values = { '123abc': 'bad key' };
            expect( validEnumKeys( values ) ).to.equal( false );
        } );

        it( 'should reject non-canonical numeric keys', function () {
            const values = { '01': 'leading zero' };
            expect( validEnumKeys( values ) ).to.equal( false );
        } );

        it( 'should reject special character keys', function () {
            const values = { 'has-dash': 'value' };
            expect( validEnumKeys( values ) ).to.equal( false );
        } );

        it( 'should reject empty object', function () {
            expect( validEnumKeys( {} ) ).to.equal( false );
        } );

        it( 'should reject non-object', function () {
            expect( validEnumKeys( null ) ).to.equal( false );
            expect( validEnumKeys( undefined ) ).to.equal( false );
            expect( validEnumKeys( 'string' ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // validEnumValues
    // ========================================================================

    describe( 'validEnumValues', function () {

        it( 'should accept non-empty string values', function () {
            const values = { '0': 'Idle', '1': 'Running' };
            expect( validEnumValues( values ) ).to.equal( true );
        } );

        it( 'should accept values with spaces', function () {
            const values = { '0': 'Error State', '1': 'In Progress' };
            expect( validEnumValues( values ) ).to.equal( true );
        } );

        it( 'should reject empty string values', function () {
            const values = { '0': '' };
            expect( validEnumValues( values ) ).to.equal( false );
        } );

        it( 'should reject non-string values', function () {
            const values = { '0': 123 };
            expect( validEnumValues( values ) ).to.equal( false );
        } );

        it( 'should reject null values', function () {
            const values = { '0': null };
            expect( validEnumValues( values ) ).to.equal( false );
        } );

        it( 'should reject null object', function () {
            expect( validEnumValues( null ) ).to.equal( false );
        } );

        it( 'should reject non-object', function () {
            expect( validEnumValues( 'string' ) ).to.equal( false );
            expect( validEnumValues( 123 ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // Unknown Property Detection
    // ========================================================================

    describe( 'Unknown Property Detection', function () {

        it( 'should accept valid enum with all known properties', function () {
            const validEnum = {
                name: 'testEnum',
                description: 'A test enum',
                values: { '0': 'Zero', '1': 'One' }
            };
            const result = validateWithSchema( enumSchema, validEnum, 'enum' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'should accept valid enum without optional description', function () {
            const validEnum = {
                name: 'testEnum',
                values: { '0': 'Zero', '1': 'One' }
            };
            const result = validateWithSchema( enumSchema, validEnum, 'enum' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'should reject enum with unknown property', function () {
            const invalidEnum = {
                name: 'testEnum',
                values: { '0': 'Zero' },
                unknownProperty: 'should cause error'
            };
            const result = validateWithSchema( enumSchema, invalidEnum, 'enum' );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'Unknown property \'unknownProperty\'' );
        } );

        it( 'should reject enum with multiple unknown properties', function () {
            const invalidEnum = {
                name: 'testEnum',
                values: { '0': 'Zero' },
                extra1: 'bad',
                extra2: 'also bad'
            };
            const result = validateWithSchema( enumSchema, invalidEnum, 'enum' );
            expect( result.valid ).to.equal( false );
            expect( result.errors.length ).to.be.at.least( 2 );
        } );

        it( 'should detect typo in property name', function () {
            const invalidEnum = {
                name: 'testEnum',
                vaules: { '0': 'Zero' }  // typo: vaules instead of values
            };
            const result = validateWithSchema( enumSchema, invalidEnum, 'enum' );
            expect( result.valid ).to.equal( false );
            // Should report both missing required 'values' and unknown 'vaules'
            expect( result.errors.some( ( e ) => e.includes( 'vaules' ) ) ).to.equal( true );
        } );

    } );

} );

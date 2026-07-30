// core/source-manager/test-harness/test/fuzz.specs.js

/**
 * @fileoverview Tests for fuzz pattern selection and injection.
 *
 * Two things to check:
 *  1. The compatibility table (which patterns make sense for which
 *     field types).
 *  2. applyFuzz mutates the message correctly: replaces the target
 *     field with the chosen value, adds the `_harnessFuzzPattern`
 *     marker, falls back to null when the pattern is incompatible.
 */

/* eslint-disable no-underscore-dangle -- harness fields use a leading underscore by convention. */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { applyFuzz, isCompatible, FUZZ_PATTERN_NAMES } from '../fuzz.js';

describe( 'testHarness — fuzz pattern compatibility', function () {

    it( 'null is compatible with every field type', function () {
        for ( const fieldType of [ 'float64', 'int64', 'bool', 'string', 'timestamp' ] ) {
            expect( isCompatible( 'null', fieldType ) ).to.equal( true );
        }
    } );

    it( 'undefined is compatible with every field type', function () {
        for ( const fieldType of [ 'float64', 'int64', 'bool', 'string', 'timestamp' ] ) {
            expect( isCompatible( 'undefined', fieldType ) ).to.equal( true );
        }
    } );

    it( 'NaN is only compatible with float64', function () {
        expect( isCompatible( 'NaN', 'float64' ) ).to.equal( true );
        expect( isCompatible( 'NaN', 'int64' ) ).to.equal( false );
        expect( isCompatible( 'NaN', 'string' ) ).to.equal( false );
        expect( isCompatible( 'NaN', 'bool' ) ).to.equal( false );
    } );

    it( 'infinity is only compatible with float64', function () {
        expect( isCompatible( 'infinity', 'float64' ) ).to.equal( true );
        expect( isCompatible( 'infinity', 'int64' ) ).to.equal( false );
    } );

    it( 'string-where-number is compatible with both numeric types', function () {
        expect( isCompatible( 'string-where-number', 'float64' ) ).to.equal( true );
        expect( isCompatible( 'string-where-number', 'int64' ) ).to.equal( true );
        expect( isCompatible( 'string-where-number', 'string' ) ).to.equal( false );
    } );

    it( 'empty-string is only compatible with string', function () {
        expect( isCompatible( 'empty-string', 'string' ) ).to.equal( true );
        expect( isCompatible( 'empty-string', 'float64' ) ).to.equal( false );
    } );

    it( 'unknown patterns are not compatible with anything', function () {
        expect( isCompatible( 'something-else', 'float64' ) ).to.equal( false );
    } );

} );

describe( 'testHarness — applyFuzz', function () {

    it( 'replaces the target with the pattern value when compatible', function () {
        const msg = { temperature: 25.0, _harnessId: 100 };
        const targetSpec = { type: 'float64' };
        // Pattern index 1 = 'NaN' (compatible with float64).
        applyFuzz( msg, 'temperature', targetSpec, 1 );
        expect( Number.isNaN( msg.temperature ) ).to.equal( true );
        expect( msg._harnessFuzzPattern ).to.equal( 'NaN' );
    } );

    it( 'replaces the target with null when the pattern is incompatible', function () {
        const msg = { state: 'idle', _harnessId: 200 };
        const targetSpec = { type: 'string' };
        // Pattern index 1 = 'NaN', not compatible with string → falls back to null.
        applyFuzz( msg, 'state', targetSpec, 1 );
        expect( msg.state ).to.equal( null );
        expect( msg._harnessFuzzPattern ).to.equal( 'NaN' );
    } );

    it( 'always records the pattern name even on the null fallback', function () {
        const msg = { temperature: 25.0, _harnessId: 300 };
        const stringFieldSpec = { type: 'string' };
        // Apply each pattern in turn against a string field. NaN, infinity,
        // string-where-number all fall back to null; the marker is always set.
        for ( let i = 0; i < FUZZ_PATTERN_NAMES.length; i += 1 ) {
            applyFuzz( msg, 'temperature', stringFieldSpec, i );
            expect( msg._harnessFuzzPattern ).to.equal( FUZZ_PATTERN_NAMES[ i ] );
        }
    } );

    it( 'handles each compatible pattern correctly on a float field', function () {
        const targetSpec = { type: 'float64' };

        const m1 = { temperature: 25.0 };
        applyFuzz( m1, 'temperature', targetSpec, 0 );  // null
        expect( m1.temperature ).to.equal( null );

        const m2 = { temperature: 25.0 };
        applyFuzz( m2, 'temperature', targetSpec, 1 );  // NaN
        expect( Number.isNaN( m2.temperature ) ).to.equal( true );

        const m3 = { temperature: 25.0 };
        applyFuzz( m3, 'temperature', targetSpec, 2 );  // string-where-number
        expect( m3.temperature ).to.equal( 'not-a-number' );

        const m4 = { temperature: 25.0 };
        applyFuzz( m4, 'temperature', targetSpec, 3 );  // undefined
        expect( m4.temperature ).to.equal( undefined );

        const m5 = { temperature: 25.0 };
        applyFuzz( m5, 'temperature', targetSpec, 4 );  // infinity
        expect( m5.temperature ).to.equal( Infinity );

        const m6 = { temperature: 25.0 };
        applyFuzz( m6, 'temperature', targetSpec, 5 );  // empty-string (incompatible → null)
        expect( m6.temperature ).to.equal( null );
    } );

} );

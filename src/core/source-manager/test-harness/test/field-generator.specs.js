// core/source-manager/test-harness/test/field-generator.specs.js

/**
 * @fileoverview Tests for per-field value generation.
 *
 * Each field type has its own rules (range for numerics, snap-to-grid
 * for floats, pick-from-values for strings, monotonic step for
 * timestamps). These tests verify each rule against a seeded PRNG so
 * the assertions are deterministic.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { createPrng } from '../prng.js';
import { generateField } from '../field-generator.js';

describe( 'testHarness — generateField (float64)', function () {

    it( 'returns numbers within the declared range', function () {
        const prng = createPrng( 1 );
        const spec = { type: 'float64', range: [ 10, 20 ] };
        for ( let i = 1; i <= 200; i += 1 ) {
            const v = generateField( spec, prng, i, 0 );
            expect( v ).to.be.at.least( 10 );
            expect( v ).to.be.lessThan( 20 );
        }
    } );

    it( 'snaps values to the declared resolution grid', function () {
        const prng = createPrng( 1 );
        const spec = { type: 'float64', range: [ 0, 100 ], resolution: 0.01 };
        for ( let i = 1; i <= 200; i += 1 ) {
            const v = generateField( spec, prng, i, 0 );
            // Multiplying by 100 must yield an integer if the value
            // is on the 0.01 grid. Allow tiny floating-point slop.
            const onGrid = Math.abs( ( v * 100 ) - Math.round( v * 100 ) );
            expect( onGrid ).to.be.lessThan( 1e-9 );
        }
    } );

    it( 'falls back to [0, 1) when no range is supplied', function () {
        const prng = createPrng( 1 );
        const spec = { type: 'float64' };
        for ( let i = 1; i <= 100; i += 1 ) {
            const v = generateField( spec, prng, i, 0 );
            expect( v ).to.be.at.least( 0 );
            expect( v ).to.be.lessThan( 1 );
        }
    } );

} );

describe( 'testHarness — generateField (int64)', function () {

    it( 'returns whole numbers within the declared range', function () {
        const prng = createPrng( 1 );
        const spec = { type: 'int64', range: [ -5, 5 ] };
        for ( let i = 1; i <= 200; i += 1 ) {
            const v = generateField( spec, prng, i, 0 );
            expect( Number.isInteger( v ) ).to.equal( true );
            expect( v ).to.be.at.least( -5 );
            expect( v ).to.be.at.most( 5 );
        }
    } );

    it( 'falls back to [0, 100] when no range is supplied', function () {
        const prng = createPrng( 1 );
        const spec = { type: 'int64' };
        for ( let i = 1; i <= 100; i += 1 ) {
            const v = generateField( spec, prng, i, 0 );
            expect( v ).to.be.at.least( 0 );
            expect( v ).to.be.at.most( 100 );
        }
    } );

} );

describe( 'testHarness — generateField (bool)', function () {

    it( 'picks from the values list when supplied', function () {
        const prng = createPrng( 1 );
        const spec = { type: 'bool', values: [ true ] };
        for ( let i = 1; i <= 50; i += 1 ) {
            expect( generateField( spec, prng, i, 0 ) ).to.equal( true );
        }
    } );

    it( 'returns true or false when no values list is supplied', function () {
        const prng = createPrng( 1 );
        const spec = { type: 'bool' };
        for ( let i = 1; i <= 100; i += 1 ) {
            const v = generateField( spec, prng, i, 0 );
            expect( typeof v ).to.equal( 'boolean' );
        }
    } );

} );

describe( 'testHarness — generateField (string)', function () {

    it( 'always returns one of the supplied values', function () {
        const prng = createPrng( 1 );
        const spec = { type: 'string', values: [ 'idle', 'running', 'fault' ] };
        for ( let i = 1; i <= 200; i += 1 ) {
            expect( spec.values ).to.include( generateField( spec, prng, i, 0 ) );
        }
    } );

} );

describe( 'testHarness — generateField (timestamp)', function () {

    it( 'returns the seedValue for static mode regardless of message index', function () {
        const prng = createPrng( 1 );
        const spec = { type: 'timestamp', mode: 'static', seedValue: 1700000000 };
        for ( let i = 1; i <= 50; i += 1 ) {
            expect( generateField( spec, prng, i, 0 ) ).to.equal( 1700000000 );
        }
    } );

    it( 'increments by intervalMs for monotonic-ms mode when paced', function () {
        const prng = createPrng( 1 );
        const spec = { type: 'timestamp', seedValue: 1000 };
        // intervalMs = 100 — each message's timestamp is 100ms after the previous.
        expect( generateField( spec, prng, 1, 100 ) ).to.equal( 1000 );
        expect( generateField( spec, prng, 2, 100 ) ).to.equal( 1100 );
        expect( generateField( spec, prng, 5, 100 ) ).to.equal( 1400 );
    } );

    it( 'uses 1ms step for monotonic-ms when running flat out (intervalMs = 0)', function () {
        const prng = createPrng( 1 );
        const spec = { type: 'timestamp', seedValue: 0 };
        expect( generateField( spec, prng, 1, 0 ) ).to.equal( 0 );
        expect( generateField( spec, prng, 2, 0 ) ).to.equal( 1 );
        expect( generateField( spec, prng, 10, 0 ) ).to.equal( 9 );
    } );

    it( 'defaults seedValue to 0 when not supplied', function () {
        const prng = createPrng( 1 );
        const spec = { type: 'timestamp' };
        expect( generateField( spec, prng, 1, 0 ) ).to.equal( 0 );
    } );

    it( 'static mode without seedValue returns 0 every time', function () {
        const prng = createPrng( 1 );
        const spec = { type: 'timestamp', mode: 'static' };
        for ( let i = 1; i <= 20; i += 1 ) {
            expect( generateField( spec, prng, i, 0 ) ).to.equal( 0 );
        }
    } );

} );

describe( 'testHarness — generateField (unknown type)', function () {

    it( 'throws when given an unknown type at the boundary', function () {
        const prng = createPrng( 1 );
        const spec = { type: 'date' };
        expect( () => generateField( spec, prng, 1, 0 ) ).to.throw( /unknown field type "date"/ );
    } );

} );

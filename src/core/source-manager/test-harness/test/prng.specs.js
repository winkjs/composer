// core/source-manager/test-harness/test/prng.specs.js

/**
 * @fileoverview Tests for the seeded random number generator.
 *
 * Two things matter for testHarness's PRNG:
 *  1. Same seed → same sequence (reproducibility — the whole point
 *     of seeding it).
 *  2. The helpers (intInRange, floatInRange, pickFrom) return values
 *     in the right shape and range.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { createPrng } from '../prng.js';

describe( 'testHarness — PRNG reproducibility', function () {

    it( 'same seed gives the same sequence of next() calls', function () {
        const a = createPrng( 42 );
        const b = createPrng( 42 );

        const sequenceA = [];
        const sequenceB = [];
        for ( let i = 0; i < 20; i += 1 ) {
            sequenceA.push( a.next() );
            sequenceB.push( b.next() );
        }
        expect( sequenceA ).to.deep.equal( sequenceB );
    } );

    it( 'different seeds give different sequences', function () {
        const a = createPrng( 1 );
        const b = createPrng( 2 );

        const valueA = a.next();
        const valueB = b.next();
        expect( valueA ).to.not.equal( valueB );
    } );

    it( 'next() returns numbers in [0, 1)', function () {
        const prng = createPrng( 7 );
        for ( let i = 0; i < 1000; i += 1 ) {
            const v = prng.next();
            expect( v ).to.be.at.least( 0 );
            expect( v ).to.be.lessThan( 1 );
        }
    } );

} );

describe( 'testHarness — PRNG helpers', function () {

    it( 'intInRange returns whole numbers within the inclusive range', function () {
        const prng = createPrng( 13 );
        const min = -3;
        const max = 5;
        for ( let i = 0; i < 500; i += 1 ) {
            const v = prng.intInRange( min, max );
            expect( Number.isInteger( v ) ).to.equal( true );
            expect( v ).to.be.at.least( min );
            expect( v ).to.be.at.most( max );
        }
    } );

    it( 'floatInRange returns numbers within [min, max)', function () {
        const prng = createPrng( 13 );
        const min = 1.5;
        const max = 9.5;
        for ( let i = 0; i < 500; i += 1 ) {
            const v = prng.floatInRange( min, max );
            expect( v ).to.be.at.least( min );
            expect( v ).to.be.lessThan( max );
        }
    } );

    it( 'pickFrom always returns one of the supplied values', function () {
        const prng = createPrng( 13 );
        const choices = [ 'red', 'green', 'blue' ];
        for ( let i = 0; i < 200; i += 1 ) {
            expect( choices ).to.include( prng.pickFrom( choices ) );
        }
    } );

    it( 'pickFrom returns the only value when the array has one element', function () {
        const prng = createPrng( 1 );
        expect( prng.pickFrom( [ 'only' ] ) ).to.equal( 'only' );
    } );

} );

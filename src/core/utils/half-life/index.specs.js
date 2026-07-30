// core/utils/half-life/index.specs.js

/**
 * @fileoverview Comprehensive functional tests for half-life utilities
 *
 * Tests cover:
 * - halfLifeToAlpha: conversion with numeric stability, edge cases, errors
 * - alphaToHalfLife: inverse conversion, round-trip consistency
 * - halfLifeToWarmupSamples: warmup calculation, known values
 * - halfLifeToEffectiveWindow: alias behavior
 * - clamp: boundary clamping behavior
 *
 * Mathematical background:
 * - EWMA alpha = 1 - exp(-ln(2)/halfLife)
 * - Half-life = ln(2) / -ln(1 - alpha)
 * - Warmup samples = halfLife * (-log1p(-settledFraction) / ln(2))
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    halfLifeToAlpha,
    alphaToHalfLife,
    halfLifeToWarmupSamples,
    halfLifeToEffectiveWindow,
    clamp
} from './index.js';

describe( 'half-life utilities', function () {

    // ========================================================================
    // HALF-LIFE TO ALPHA
    // ========================================================================

    describe( 'halfLifeToAlpha()', function () {

        describe( 'valid conversions', function () {

            it( 'converts half-life of 1 to alpha ≈ 0.5', function () {
                // halfLife=1 → alpha = 1 - exp(-ln2) = 1 - 0.5 = 0.5
                const alpha = halfLifeToAlpha( 1 );
                expect( alpha ).to.be.closeTo( 0.5, 1e-10 );
            } );

            it( 'converts half-life of 10 to correct alpha', function () {
                // alpha = 1 - exp(-ln2/10) ≈ 0.0669
                const alpha = halfLifeToAlpha( 10 );
                const expected = 1 - Math.exp( -Math.LN2 / 10 );
                expect( alpha ).to.be.closeTo( expected, 1e-10 );
            } );

            it( 'converts half-life of 100 to correct alpha', function () {
                const alpha = halfLifeToAlpha( 100 );
                const expected = 1 - Math.exp( -Math.LN2 / 100 );
                expect( alpha ).to.be.closeTo( expected, 1e-10 );
            } );

            it( 'converts small half-life (0.1) to large alpha', function () {
                const alpha = halfLifeToAlpha( 0.1 );
                // Small half-life → fast decay → large alpha (close to 1)
                expect( alpha ).to.be.greaterThan( 0.99 );
                expect( alpha ).to.be.lessThan( 1 );
            } );

            it( 'converts large half-life (10000) to small alpha', function () {
                const alpha = halfLifeToAlpha( 10000 );
                // Large half-life → slow decay → small alpha (close to 0)
                expect( alpha ).to.be.greaterThan( 0 );
                expect( alpha ).to.be.lessThan( 0.001 );
            } );

            it( 'returns alpha in (0, 1) range', function () {
                const testValues = [ 0.001, 0.1, 1, 10, 100, 1000, 10000 ];
                for ( const hl of testValues ) {
                    const alpha = halfLifeToAlpha( hl );
                    expect( alpha ).to.be.greaterThan( 0, `halfLife=${hl}` );
                    expect( alpha ).to.be.lessThan( 1, `halfLife=${hl}` );
                }
            } );

        } );

        describe( 'numeric stability and defensive clamping', function () {

            it( 'clamps alpha to MIN_ALPHA for very large half-life', function () {
                // Very large half-life would produce alpha near 0
                const alpha = halfLifeToAlpha( 1e15 );
                const MIN_ALPHA = 32 * Number.EPSILON;
                expect( alpha ).to.be.at.least( MIN_ALPHA );
            } );

            it( 'clamps alpha to MAX_ALPHA for very small half-life', function () {
                // Very small half-life would produce alpha near 1
                const alpha = halfLifeToAlpha( 1e-15 );
                const MAX_ALPHA = 1 - ( 8 * Number.EPSILON );
                expect( alpha ).to.be.at.most( MAX_ALPHA );
            } );

            it( 'produces stable results for extreme half-life values', function () {
                // Should not produce NaN or Infinity
                expect( halfLifeToAlpha( 1e-10 ) ).to.be.a( 'number' );
                expect( halfLifeToAlpha( 1e10 ) ).to.be.a( 'number' );
                expect( Number.isFinite( halfLifeToAlpha( 1e-10 ) ) ).to.equal( true );
                expect( Number.isFinite( halfLifeToAlpha( 1e10 ) ) ).to.equal( true );
            } );

        } );

        describe( 'error handling', function () {

            it( 'throws for non-number input', function () {
                expect( () => halfLifeToAlpha( '10' ) )
                    .to.throw( 'Half-life must be a finite number > 0' );
            } );

            it( 'throws for NaN', function () {
                expect( () => halfLifeToAlpha( NaN ) )
                    .to.throw( 'Half-life must be a finite number > 0' );
            } );

            it( 'throws for Infinity', function () {
                expect( () => halfLifeToAlpha( Infinity ) )
                    .to.throw( 'Half-life must be a finite number > 0' );
            } );

            it( 'throws for negative Infinity', function () {
                expect( () => halfLifeToAlpha( -Infinity ) )
                    .to.throw( 'Half-life must be a finite number > 0' );
            } );

            it( 'throws for zero', function () {
                expect( () => halfLifeToAlpha( 0 ) )
                    .to.throw( 'Half-life must be a finite number > 0' );
            } );

            it( 'throws for negative number', function () {
                expect( () => halfLifeToAlpha( -10 ) )
                    .to.throw( 'Half-life must be a finite number > 0' );
            } );

            it( 'throws for null', function () {
                expect( () => halfLifeToAlpha( null ) )
                    .to.throw( 'Half-life must be a finite number > 0' );
            } );

            it( 'throws for undefined', function () {
                expect( () => halfLifeToAlpha( undefined ) )
                    .to.throw( 'Half-life must be a finite number > 0' );
            } );

        } );

    } );

    // ========================================================================
    // ALPHA TO HALF-LIFE
    // ========================================================================

    describe( 'alphaToHalfLife()', function () {

        describe( 'valid conversions', function () {

            it( 'converts alpha of 0.5 to half-life of 1', function () {
                const halfLife = alphaToHalfLife( 0.5 );
                expect( halfLife ).to.be.closeTo( 1, 1e-10 );
            } );

            it( 'converts small alpha to large half-life', function () {
                const halfLife = alphaToHalfLife( 0.01 );
                // Small alpha → slow decay → large half-life
                expect( halfLife ).to.be.greaterThan( 50 );
            } );

            it( 'converts large alpha (0.9) to small half-life', function () {
                const halfLife = alphaToHalfLife( 0.9 );
                // Large alpha → fast decay → small half-life
                expect( halfLife ).to.be.lessThan( 1 );
                expect( halfLife ).to.be.greaterThan( 0 );
            } );

            it( 'produces positive half-life for all valid alpha', function () {
                const testValues = [ 0.001, 0.01, 0.1, 0.5, 0.9, 0.99, 0.999 ];
                for ( const alpha of testValues ) {
                    const halfLife = alphaToHalfLife( alpha );
                    expect( halfLife ).to.be.greaterThan( 0, `alpha=${alpha}` );
                }
            } );

        } );

        describe( 'round-trip consistency', function () {

            it( 'round-trips halfLife → alpha → halfLife', function () {
                const testValues = [ 0.1, 1, 5, 10, 50, 100, 1000 ];
                for ( const originalHL of testValues ) {
                    const alpha = halfLifeToAlpha( originalHL );
                    const recoveredHL = alphaToHalfLife( alpha );
                    expect( recoveredHL ).to.be.closeTo( originalHL, originalHL * 1e-10 );
                }
            } );

            it( 'round-trips alpha → halfLife → alpha', function () {
                const testValues = [ 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99 ];
                for ( const originalAlpha of testValues ) {
                    const halfLife = alphaToHalfLife( originalAlpha );
                    const recoveredAlpha = halfLifeToAlpha( halfLife );
                    expect( recoveredAlpha ).to.be.closeTo( originalAlpha, 1e-10 );
                }
            } );

        } );

        describe( 'numeric stability', function () {

            it( 'handles alpha very close to 0', function () {
                const halfLife = alphaToHalfLife( 1e-10 );
                expect( Number.isFinite( halfLife ) ).to.equal( true );
                expect( halfLife ).to.be.greaterThan( 0 );
            } );

            it( 'handles alpha very close to 1', function () {
                const halfLife = alphaToHalfLife( 1 - 1e-10 );
                expect( Number.isFinite( halfLife ) ).to.equal( true );
                expect( halfLife ).to.be.greaterThan( 0 );
            } );

        } );

        describe( 'error handling', function () {

            it( 'throws for non-number input', function () {
                expect( () => alphaToHalfLife( '0.5' ) )
                    .to.throw( 'Alpha must be a finite number in (0,1)' );
            } );

            it( 'throws for NaN', function () {
                expect( () => alphaToHalfLife( NaN ) )
                    .to.throw( 'Alpha must be a finite number in (0,1)' );
            } );

            it( 'throws for Infinity', function () {
                expect( () => alphaToHalfLife( Infinity ) )
                    .to.throw( 'Alpha must be a finite number in (0,1)' );
            } );

            it( 'throws for alpha = 0 (boundary)', function () {
                expect( () => alphaToHalfLife( 0 ) )
                    .to.throw( 'Alpha must be a finite number in (0,1)' );
            } );

            it( 'throws for alpha = 1 (boundary)', function () {
                expect( () => alphaToHalfLife( 1 ) )
                    .to.throw( 'Alpha must be a finite number in (0,1)' );
            } );

            it( 'throws for alpha < 0', function () {
                expect( () => alphaToHalfLife( -0.1 ) )
                    .to.throw( 'Alpha must be a finite number in (0,1)' );
            } );

            it( 'throws for alpha > 1', function () {
                expect( () => alphaToHalfLife( 1.1 ) )
                    .to.throw( 'Alpha must be a finite number in (0,1)' );
            } );

            it( 'throws for null', function () {
                expect( () => alphaToHalfLife( null ) )
                    .to.throw( 'Alpha must be a finite number in (0,1)' );
            } );

            it( 'throws for undefined', function () {
                expect( () => alphaToHalfLife( undefined ) )
                    .to.throw( 'Alpha must be a finite number in (0,1)' );
            } );

        } );

    } );

    // ========================================================================
    // HALF-LIFE TO WARMUP SAMPLES
    // ========================================================================

    describe( 'halfLifeToWarmupSamples()', function () {

        describe( 'known values from documentation', function () {

            it( 'computes warmup for 95% settled (default)', function () {
                // From notes: s=0.95 → 4.322 half-lives
                // halfLife=20, s=0.95 → ceil(20 × 4.322) = 87
                const samples = halfLifeToWarmupSamples( 20 );
                expect( samples ).to.equal( 87 );
            } );

            it( 'computes warmup for 75% settled', function () {
                // s=0.75 → 2.000 half-lives
                // halfLife=10 → ceil(10 × 2) = 20
                const samples = halfLifeToWarmupSamples( 10, 0.75 );
                expect( samples ).to.equal( 20 );
            } );

            it( 'computes warmup for 90% settled', function () {
                // s=0.90 → 3.322 half-lives
                // halfLife=10 → ceil(10 × 3.322) = 34
                const samples = halfLifeToWarmupSamples( 10, 0.90 );
                expect( samples ).to.equal( 34 );
            } );

            it( 'computes warmup for 98% settled', function () {
                // s=0.98 → 5.644 half-lives (corrected from notes which says 6.644)
                // Actually: -log1p(-0.98)/ln2 ≈ 5.644
                // halfLife=10 → ceil(10 × 5.644) = 57
                const samples = halfLifeToWarmupSamples( 10, 0.98 );
                const nHalfLives = -Math.log1p( -0.98 ) / Math.LN2;
                const expected = Math.ceil( 10 * nHalfLives );
                expect( samples ).to.equal( expected );
            } );

        } );

        describe( 'general behavior', function () {

            it( 'returns ceiling of computed samples', function () {
                // Result should always be an integer (ceil)
                const samples = halfLifeToWarmupSamples( 7, 0.80 );
                expect( samples ).to.equal( Math.floor( samples ) );
            } );

            it( 'increases with half-life', function () {
                const s1 = halfLifeToWarmupSamples( 10, 0.95 );
                const s2 = halfLifeToWarmupSamples( 20, 0.95 );
                const s3 = halfLifeToWarmupSamples( 50, 0.95 );
                expect( s2 ).to.be.greaterThan( s1 );
                expect( s3 ).to.be.greaterThan( s2 );
            } );

            it( 'increases with settled fraction', function () {
                const s1 = halfLifeToWarmupSamples( 10, 0.50 );
                const s2 = halfLifeToWarmupSamples( 10, 0.75 );
                const s3 = halfLifeToWarmupSamples( 10, 0.95 );
                expect( s2 ).to.be.greaterThan( s1 );
                expect( s3 ).to.be.greaterThan( s2 );
            } );

            it( 'handles fractional half-life', function () {
                const samples = halfLifeToWarmupSamples( 2.5, 0.95 );
                expect( samples ).to.be.a( 'number' );
                expect( samples ).to.be.greaterThan( 0 );
            } );

            it( 'handles very small settled fraction', function () {
                const samples = halfLifeToWarmupSamples( 10, 0.01 );
                // Very low settled fraction → few samples needed
                expect( samples ).to.be.greaterThan( 0 );
                expect( samples ).to.be.lessThan( 10 );
            } );

            it( 'handles settled fraction very close to 1', function () {
                const samples = halfLifeToWarmupSamples( 10, 0.999 );
                // Very high settled fraction → many samples needed
                // s=0.999 → ~9.97 half-lives → ceil(10 * 9.97) = 100
                expect( samples ).to.be.at.least( 100 );
            } );

        } );

        describe( 'error handling', function () {

            it( 'throws for non-number halfLifeSamples', function () {
                expect( () => halfLifeToWarmupSamples( '10' ) )
                    .to.throw( 'halfLifeSamples must be a finite number > 0' );
            } );

            it( 'throws for zero halfLifeSamples', function () {
                expect( () => halfLifeToWarmupSamples( 0 ) )
                    .to.throw( 'halfLifeSamples must be a finite number > 0' );
            } );

            it( 'throws for negative halfLifeSamples', function () {
                expect( () => halfLifeToWarmupSamples( -5 ) )
                    .to.throw( 'halfLifeSamples must be a finite number > 0' );
            } );

            it( 'throws for NaN halfLifeSamples', function () {
                expect( () => halfLifeToWarmupSamples( NaN ) )
                    .to.throw( 'halfLifeSamples must be a finite number > 0' );
            } );

            it( 'throws for Infinity halfLifeSamples', function () {
                expect( () => halfLifeToWarmupSamples( Infinity ) )
                    .to.throw( 'halfLifeSamples must be a finite number > 0' );
            } );

            it( 'throws for non-number settledFraction', function () {
                expect( () => halfLifeToWarmupSamples( 10, '0.95' ) )
                    .to.throw( 'settledFraction must be a finite number in (0,1)' );
            } );

            it( 'throws for settledFraction = 0', function () {
                expect( () => halfLifeToWarmupSamples( 10, 0 ) )
                    .to.throw( 'settledFraction must be a finite number in (0,1)' );
            } );

            it( 'throws for settledFraction = 1', function () {
                expect( () => halfLifeToWarmupSamples( 10, 1 ) )
                    .to.throw( 'settledFraction must be a finite number in (0,1)' );
            } );

            it( 'throws for negative settledFraction', function () {
                expect( () => halfLifeToWarmupSamples( 10, -0.5 ) )
                    .to.throw( 'settledFraction must be a finite number in (0,1)' );
            } );

            it( 'throws for settledFraction > 1', function () {
                expect( () => halfLifeToWarmupSamples( 10, 1.5 ) )
                    .to.throw( 'settledFraction must be a finite number in (0,1)' );
            } );

            it( 'throws for NaN settledFraction', function () {
                expect( () => halfLifeToWarmupSamples( 10, NaN ) )
                    .to.throw( 'settledFraction must be a finite number in (0,1)' );
            } );

        } );

    } );

    // ========================================================================
    // HALF-LIFE TO EFFECTIVE WINDOW
    // ========================================================================

    describe( 'halfLifeToEffectiveWindow()', function () {

        it( 'uses default settledFraction of 0.75', function () {
            // s=0.75 → 2 half-lives
            // halfLife=10 → ceil(10 × 2) = 20
            const window = halfLifeToEffectiveWindow( 10 );
            expect( window ).to.equal( 20 );
        } );

        it( 'is equivalent to halfLifeToWarmupSamples with same parameters', function () {
            const halfLife = 15;
            const fraction = 0.80;
            const window = halfLifeToEffectiveWindow( halfLife, fraction );
            const warmup = halfLifeToWarmupSamples( halfLife, fraction );
            expect( window ).to.equal( warmup );
        } );

        it( 'accepts custom settledFraction', function () {
            const window = halfLifeToEffectiveWindow( 10, 0.95 );
            const expected = halfLifeToWarmupSamples( 10, 0.95 );
            expect( window ).to.equal( expected );
        } );

        it( 'propagates errors from halfLifeToWarmupSamples', function () {
            expect( () => halfLifeToEffectiveWindow( -5 ) )
                .to.throw( 'halfLifeSamples must be a finite number > 0' );
        } );

    } );

    // ========================================================================
    // CLAMP
    // ========================================================================

    describe( 'clamp()', function () {

        describe( 'basic clamping', function () {

            it( 'returns value when within range', function () {
                expect( clamp( 5, 0, 10 ) ).to.equal( 5 );
            } );

            it( 'clamps to lower bound when below', function () {
                expect( clamp( -3, 0, 10 ) ).to.equal( 0 );
            } );

            it( 'clamps to upper bound when above', function () {
                expect( clamp( 15, 0, 10 ) ).to.equal( 10 );
            } );

            it( 'returns lower bound when at lower bound', function () {
                expect( clamp( 0, 0, 10 ) ).to.equal( 0 );
            } );

            it( 'returns upper bound when at upper bound', function () {
                expect( clamp( 10, 0, 10 ) ).to.equal( 10 );
            } );

        } );

        describe( 'edge cases', function () {

            it( 'handles negative range', function () {
                expect( clamp( -5, -10, -1 ) ).to.equal( -5 );
                expect( clamp( -15, -10, -1 ) ).to.equal( -10 );
                expect( clamp( 0, -10, -1 ) ).to.equal( -1 );
            } );

            it( 'handles range crossing zero', function () {
                expect( clamp( 0, -5, 5 ) ).to.equal( 0 );
                expect( clamp( -10, -5, 5 ) ).to.equal( -5 );
                expect( clamp( 10, -5, 5 ) ).to.equal( 5 );
            } );

            it( 'handles single-point range (lo === hi)', function () {
                expect( clamp( 0, 5, 5 ) ).to.equal( 5 );
                expect( clamp( 5, 5, 5 ) ).to.equal( 5 );
                expect( clamp( 10, 5, 5 ) ).to.equal( 5 );
            } );

            it( 'handles fractional values', function () {
                expect( clamp( 0.5, 0, 1 ) ).to.equal( 0.5 );
                expect( clamp( -0.1, 0, 1 ) ).to.equal( 0 );
                expect( clamp( 1.1, 0, 1 ) ).to.equal( 1 );
            } );

            it( 'handles very large values', function () {
                expect( clamp( 1e100, 0, 1e50 ) ).to.equal( 1e50 );
                expect( clamp( -1e100, -1e50, 0 ) ).to.equal( -1e50 );
            } );

            it( 'handles very small values', function () {
                expect( clamp( 1e-100, 0, 1 ) ).to.equal( 1e-100 );
                expect( clamp( 1e-100, 1e-50, 1 ) ).to.equal( 1e-50 );
            } );

            it( 'handles Infinity', function () {
                expect( clamp( Infinity, 0, 100 ) ).to.equal( 100 );
                expect( clamp( -Infinity, 0, 100 ) ).to.equal( 0 );
            } );

            it( 'handles zero as bounds', function () {
                expect( clamp( -1, 0, 0 ) ).to.equal( 0 );
                expect( clamp( 1, 0, 0 ) ).to.equal( 0 );
                expect( clamp( 0, 0, 0 ) ).to.equal( 0 );
            } );

        } );

        describe( 'return type', function () {

            it( 'returns a number', function () {
                expect( typeof clamp( 5, 0, 10 ) ).to.equal( 'number' );
                expect( typeof clamp( -5, 0, 10 ) ).to.equal( 'number' );
                expect( typeof clamp( 15, 0, 10 ) ).to.equal( 'number' );
            } );

        } );

    } );

} );

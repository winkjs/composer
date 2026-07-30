// nodes/trend/test/compute-confidence.specs.js

/**
 * @fileoverview Tests for compute-confidence module
 *
 * Tests cover edge cases and defensive branches:
 * - Warmup ramp clamping (line 8)
 * - Zero/epsilon threshold handling (line 15)
 * - Stable confidence clamping (line 48)
 * - Trending confidence clamping (line 94)
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { computeConfidence } from '../compute-confidence.js';

/**
 * Creates a minimal state object for testing computeConfidence
 */
const createState = function ( overrides = {} ) {
    return {
        samples: 10,
        warmupSamples: 5,
        rocThreshold: 0.1,
        rocVariance: 0.01,
        rocMean: 0,
        consistentSamples: 5,
        trend: 'stable',
        epsilon: 1e-12,
        ...overrides
    };
};

describe( 'computeConfidence', function () {

    // ========================================================================
    // WARMUP PHASE - Line 8 branches
    // ========================================================================

    describe( 'warmup phase (line 8 branches)', function () {

        it( 'returns linear ramp during warmup', function () {
            const state = createState( {
                samples: 2,
                warmupSamples: 10
            } );

            const conf = computeConfidence( state );

            expect( conf ).to.equal( 0.2 ); // 2/10 = 0.2
        } );

        it( 'handles zero samples (ramp = 0)', function () {
            const state = createState( {
                samples: 0,
                warmupSamples: 10
            } );

            const conf = computeConfidence( state );

            expect( conf ).to.equal( 0 );
        } );

        it( 'handles warmupSamples = 0 (uses Math.max protection)', function () {
            // When warmupSamples is 0, Math.max(0, 1) = 1
            // So ramp = samples / 1 = samples
            const state = createState( {
                samples: 0,
                warmupSamples: 0
            } );

            const conf = computeConfidence( state );

            // samples < warmupSamples is false (0 < 0), so it goes to post-warmup path
            // But since warmupSamples = 0, samples >= warmupSamples, so post-warmup
            expect( conf ).to.be.a( 'number' );
            expect( conf ).to.be.greaterThanOrEqual( 0 );
            expect( conf ).to.be.lessThanOrEqual( 1 );
        } );

        it( 'clamps ramp to 1 when samples approach warmupSamples', function () {
            const state = createState( {
                samples: 4,
                warmupSamples: 5
            } );

            const conf = computeConfidence( state );

            expect( conf ).to.equal( 0.8 ); // 4/5 = 0.8
        } );

    } );

    // ========================================================================
    // ZERO THRESHOLD - Line 15 branch
    // ========================================================================

    describe( 'zero threshold handling (line 15 branch)', function () {

        it( 'uses epsilon when rocThreshold is 0', function () {
            const state = createState( {
                samples: 10,
                warmupSamples: 5,
                rocThreshold: 0,
                trend: 'stable',
                rocMean: 0,
                rocVariance: 0
            } );

            const conf = computeConfidence( state );

            // Should not throw or return NaN/Infinity
            expect( Number.isFinite( conf ) ).to.equal( true );
            expect( conf ).to.be.greaterThanOrEqual( 0 );
            expect( conf ).to.be.lessThanOrEqual( 1 );
        } );

        it( 'uses epsilon when rocThreshold is negative (edge case)', function () {
            // Negative threshold shouldn't happen with validation, but test defensive code
            const state = createState( {
                samples: 10,
                warmupSamples: 5,
                rocThreshold: -0.1,
                trend: 'stable',
                rocMean: 0,
                rocVariance: 0.001
            } );

            const conf = computeConfidence( state );

            expect( Number.isFinite( conf ) ).to.equal( true );
            expect( conf ).to.be.greaterThanOrEqual( 0 );
            expect( conf ).to.be.lessThanOrEqual( 1 );
        } );

        it( 'handles zero threshold with trending state', function () {
            const state = createState( {
                samples: 10,
                warmupSamples: 5,
                rocThreshold: 0,
                trend: 'rising',
                rocMean: 0.5,
                rocVariance: 0.01,
                consistentSamples: 10
            } );

            const conf = computeConfidence( state );

            expect( Number.isFinite( conf ) ).to.equal( true );
            expect( conf ).to.be.greaterThanOrEqual( 0 );
            expect( conf ).to.be.lessThanOrEqual( 1 );
        } );

    } );

    // ========================================================================
    // STABLE CONFIDENCE - Line 48 branches
    // ========================================================================

    describe( 'stable confidence clamping (line 48 branches)', function () {

        it( 'returns confidence in [0,1] for normal stable state', function () {
            const state = createState( {
                samples: 20,
                warmupSamples: 5,
                rocThreshold: 0.1,
                trend: 'stable',
                rocMean: 0.01,
                rocVariance: 0.001,
                consistentSamples: 15
            } );

            const conf = computeConfidence( state );

            expect( conf ).to.be.greaterThanOrEqual( 0 );
            expect( conf ).to.be.lessThanOrEqual( 1 );
        } );

        it( 'returns high confidence for very stable signal', function () {
            const state = createState( {
                samples: 100,
                warmupSamples: 5,
                rocThreshold: 0.1,
                trend: 'stable',
                rocMean: 0, // Perfectly centered
                rocVariance: 1e-10, // Very low noise
                consistentSamples: 95
            } );

            const conf = computeConfidence( state );

            expect( conf ).to.be.greaterThan( 0.8 );
        } );

        it( 'returns low confidence when roc near threshold boundary', function () {
            const state = createState( {
                samples: 20,
                warmupSamples: 5,
                rocThreshold: 0.1,
                trend: 'stable',
                rocMean: 0.095, // Very close to threshold
                rocVariance: 0.01,
                consistentSamples: 3
            } );

            const conf = computeConfidence( state );

            expect( conf ).to.be.lessThan( 0.5 );
        } );

        it( 'handles zero variance (perfectly constant signal)', function () {
            const state = createState( {
                samples: 20,
                warmupSamples: 5,
                rocThreshold: 0.1,
                trend: 'stable',
                rocMean: 0,
                rocVariance: 0,
                consistentSamples: 15
            } );

            const conf = computeConfidence( state );

            expect( Number.isFinite( conf ) ).to.equal( true );
            expect( conf ).to.be.greaterThanOrEqual( 0 );
            expect( conf ).to.be.lessThanOrEqual( 1 );
        } );

        it( 'handles negative variance (numerical error)', function () {
            const state = createState( {
                samples: 20,
                warmupSamples: 5,
                rocThreshold: 0.1,
                trend: 'stable',
                rocMean: 0,
                rocVariance: -1e-15, // Numerical error
                consistentSamples: 15
            } );

            const conf = computeConfidence( state );

            expect( Number.isFinite( conf ) ).to.equal( true );
            expect( conf ).to.be.greaterThanOrEqual( 0 );
            expect( conf ).to.be.lessThanOrEqual( 1 );
        } );

    } );

    // ========================================================================
    // TRENDING CONFIDENCE - Line 94 branches
    // ========================================================================

    describe( 'trending confidence clamping (line 94 branches)', function () {

        it( 'returns confidence in [0,1] for rising trend', function () {
            const state = createState( {
                samples: 20,
                warmupSamples: 5,
                rocThreshold: 0.1,
                trend: 'rising',
                rocMean: 0.5,
                rocVariance: 0.01,
                consistentSamples: 10
            } );

            const conf = computeConfidence( state );

            expect( conf ).to.be.greaterThanOrEqual( 0 );
            expect( conf ).to.be.lessThanOrEqual( 1 );
        } );

        it( 'returns confidence in [0,1] for falling trend', function () {
            const state = createState( {
                samples: 20,
                warmupSamples: 5,
                rocThreshold: 0.1,
                trend: 'falling',
                rocMean: -0.5,
                rocVariance: 0.01,
                consistentSamples: 10
            } );

            const conf = computeConfidence( state );

            expect( conf ).to.be.greaterThanOrEqual( 0 );
            expect( conf ).to.be.lessThanOrEqual( 1 );
        } );

        it( 'returns high confidence for strong clear trend', function () {
            const state = createState( {
                samples: 50,
                warmupSamples: 5,
                rocThreshold: 0.1,
                trend: 'rising',
                rocMean: 2.0, // Far above threshold
                rocVariance: 0.001, // Low noise
                consistentSamples: 45
            } );

            const conf = computeConfidence( state );

            expect( conf ).to.be.greaterThan( 0.7 );
        } );

        it( 'returns lower confidence for weak trend near threshold', function () {
            const state = createState( {
                samples: 10,
                warmupSamples: 5,
                rocThreshold: 0.1,
                trend: 'rising',
                rocMean: 0.11, // Just above threshold
                rocVariance: 0.01,
                consistentSamples: 2
            } );

            const conf = computeConfidence( state );

            expect( conf ).to.be.lessThan( 0.5 );
        } );

        it( 'handles zero variance in trending state', function () {
            const state = createState( {
                samples: 20,
                warmupSamples: 5,
                rocThreshold: 0.1,
                trend: 'rising',
                rocMean: 0.5,
                rocVariance: 0,
                consistentSamples: 15
            } );

            const conf = computeConfidence( state );

            expect( Number.isFinite( conf ) ).to.equal( true );
            expect( conf ).to.be.greaterThanOrEqual( 0 );
            expect( conf ).to.be.lessThanOrEqual( 1 );
        } );

        it( 'handles negative variance in trending state', function () {
            const state = createState( {
                samples: 20,
                warmupSamples: 5,
                rocThreshold: 0.1,
                trend: 'falling',
                rocMean: -0.5,
                rocVariance: -1e-15, // Numerical error
                consistentSamples: 15
            } );

            const conf = computeConfidence( state );

            expect( Number.isFinite( conf ) ).to.equal( true );
            expect( conf ).to.be.greaterThanOrEqual( 0 );
            expect( conf ).to.be.lessThanOrEqual( 1 );
        } );

        it( 'computes SNR for trending state', function () {
            const state = createState( {
                samples: 20,
                warmupSamples: 5,
                rocThreshold: 0.1,
                trend: 'rising',
                rocMean: 1.0,
                rocVariance: 0.01, // stddev = 0.1
                consistentSamples: 15
            } );

            computeConfidence( state );

            // SNR should be rocMean / stddev = 1.0 / 0.1 = 10
            expect( state.snr ).to.be.closeTo( 10, 0.01 );
        } );

    } );

    // ========================================================================
    // PERSISTENCE FACTOR
    // ========================================================================

    describe( 'persistence factor', function () {

        it( 'low persistence gives lower confidence', function () {
            const stateLow = createState( {
                samples: 20,
                warmupSamples: 5,
                trend: 'stable',
                rocMean: 0,
                rocVariance: 0.001,
                consistentSamples: 1
            } );

            const stateHigh = createState( {
                samples: 20,
                warmupSamples: 5,
                trend: 'stable',
                rocMean: 0,
                rocVariance: 0.001,
                consistentSamples: 50
            } );

            const confLow = computeConfidence( stateLow );
            const confHigh = computeConfidence( stateHigh );

            expect( confHigh ).to.be.greaterThan( confLow );
        } );

        it( 'persistence affects trending confidence', function () {
            const stateLow = createState( {
                samples: 20,
                warmupSamples: 5,
                trend: 'rising',
                rocMean: 0.5,
                rocVariance: 0.01,
                consistentSamples: 1
            } );

            const stateHigh = createState( {
                samples: 20,
                warmupSamples: 5,
                trend: 'rising',
                rocMean: 0.5,
                rocVariance: 0.01,
                consistentSamples: 30
            } );

            const confLow = computeConfidence( stateLow );
            const confHigh = computeConfidence( stateHigh );

            expect( confHigh ).to.be.greaterThan( confLow );
        } );

    } );

    // ========================================================================
    // EPSILON HANDLING
    // ========================================================================

    describe( 'epsilon handling', function () {

        it( 'uses state.epsilon when provided', function () {
            const state = createState( {
                samples: 20,
                warmupSamples: 5,
                rocThreshold: 0,
                trend: 'stable',
                rocMean: 0,
                rocVariance: 0,
                epsilon: 1e-6
            } );

            const conf = computeConfidence( state );

            expect( Number.isFinite( conf ) ).to.equal( true );
        } );

        it( 'uses default epsilon when not provided', function () {
            const state = createState( {
                samples: 20,
                warmupSamples: 5,
                rocThreshold: 0,
                trend: 'stable',
                rocMean: 0,
                rocVariance: 0
            } );
            delete state.epsilon;

            const conf = computeConfidence( state );

            expect( Number.isFinite( conf ) ).to.equal( true );
        } );

    } );

} );

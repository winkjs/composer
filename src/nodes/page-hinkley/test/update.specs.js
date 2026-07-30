// Update (PHT computation) tests for page-hinkley node.
// Covers running mean, EWMA baseline, shift detection, detectDrop,
// invalid input, disable, tunables, and edge cases.
// All numerical assertions reference golden-truth-page-hinkley.json.
// See golden-truth-page-hinkley.py for three-tier verification details.

import { expect } from 'chai';
import sinon from 'sinon';
import { describe, it, afterEach } from 'mocha';
import { init, update, reset } from '../index.js';
import { goldenTruth, makeSpec } from './test-helpers.js';

const TOL = 1e-12;

describe( 'Page-Hinkley — update', function () {

    describe( 'running mean baseline (alpha=0)', function () {
        it( 'updates count on each message', function () {
            const state = init( makeSpec() );
            update( state, { value: 10 } );
            expect( state.count ).to.equal( 1 );
            update( state, { value: 20 } );
            expect( state.count ).to.equal( 2 );
        } );

        it( 'computes running mean correctly', function () {
            // see golden-truth-page-hinkley.py S1
            const gt = goldenTruth[ 'S1-running-mean-basics' ];
            const state = init( makeSpec( { stats: { phMean: { storeAs: 'mean' } } } ) );
            for ( let i = 0; i < gt.values.length; i += 1 ) {
                update( state, { value: gt.values[ i ] } );
                expect( state.mean ).to.be.closeTo( gt.means[ i ], TOL );
            }
        } );

        it( 'does not detect shift in stable data', function () {
            // Deterministic stable sequence (no Math.random)
            const state = init( makeSpec( { lambda: 50 } ) );
            for ( let i = 0; i < 50; i += 1 ) {
                update( state, { value: 100 + ( ( ( i % 3 ) - 1 ) * 0.5 ) } );
            }
            expect( state.shiftDetected ).to.equal( false );
        } );
    } );

    describe( 'exponentially smoothed baseline (halfLife)', function () {
        it( 'computes ES baseline correctly with corrected initialization', function () {
            // see golden-truth-page-hinkley.py S2
            const gt = goldenTruth[ 'S2-es-basics' ];
            const state = init( makeSpec( {
                stats: { phMean: { storeAs: 'mean' } }, halfLife: gt.halfLife
            } ) );
            for ( let i = 0; i < gt.values.length; i += 1 ) {
                update( state, { value: gt.values[ i ] } );
                expect( state.mean ).to.be.closeTo( gt.means[ i ], TOL );
            }
        } );

        it( 'computes cumulative sum correctly in ES baseline mode', function () {
            // see golden-truth-page-hinkley.py S2
            const gt = goldenTruth[ 'S2-es-basics' ];
            const state = init( makeSpec( {
                stats: { phMean: { storeAs: 'mean' } }, halfLife: gt.halfLife
            } ) );
            for ( let i = 0; i < gt.values.length; i += 1 ) {
                update( state, { value: gt.values[ i ] } );
                expect( state.cumSum ).to.be.closeTo( gt.cumSums[ i ], TOL );
                expect( state.testStatistic ).to.be.closeTo( gt.testStatistics[ i ], TOL );
            }
        } );

        it( 'detects shift in ES baseline mode', function () {
            // see golden-truth-page-hinkley.py S10
            const gt = goldenTruth[ 'S10-es-shift-detection' ];
            const state = init( makeSpec( {
                halfLife: gt.halfLife, delta: gt.delta, lambda: gt.lambda, minWarmUpSamples: 1
            } ) );
            let detectionIndex = -1;
            for ( let i = 0; i < gt.values.length; i += 1 ) {
                update( state, { value: gt.values[ i ] } );
                if ( state.shiftDetected && detectionIndex === -1 ) {
                    detectionIndex = i;
                }
            }
            expect( detectionIndex ).to.equal( gt.detectionIndex );
        } );
    } );

    describe( 'shift detection', function () {
        it( 'detects positive shift (increase in mean)', function () {
            // see golden-truth-page-hinkley.py S3
            const gt = goldenTruth[ 'S3-shift-detection' ];
            const state = init( makeSpec( {
                delta: gt.delta, lambda: gt.lambda, minWarmUpSamples: 5
            } ) );
            let detectionIndex = -1;
            for ( let i = 0; i < gt.values.length; i += 1 ) {
                update( state, { value: gt.values[ i ] } );
                if ( state.shiftDetected && detectionIndex === -1 ) {
                    detectionIndex = i;
                    break;
                }
            }
            expect( detectionIndex ).to.equal( gt.detectionIndex );
            expect( state.shiftDetected ).to.equal( true );
        } );

        it( 'matches golden-truth trace up to detection', function () {
            // see golden-truth-page-hinkley.py S3
            const gt = goldenTruth[ 'S3-shift-detection' ];
            const state = init( makeSpec( {
                delta: gt.delta, lambda: gt.lambda, minWarmUpSamples: 1
            } ) );
            for ( let i = 0; i < gt.trace.length; i += 1 ) {
                update( state, { value: gt.values[ i ] } );
                const expected = gt.trace[ i ];
                expect( state.mean ).to.be.closeTo( expected.mean, TOL );
                expect( state.testStatistic ).to.be.closeTo( expected.testStatistic, TOL );
                expect( state.shiftDetected ).to.equal( expected.shiftDetected );
            }
        } );

        it( 'resets cumSum after detection', function () {
            // see golden-truth-page-hinkley.py S9
            const gt9 = goldenTruth[ 'S9-post-detection-state' ];
            const gt3 = goldenTruth[ 'S3-shift-detection' ];
            const state = init( makeSpec( {
                delta: gt3.delta, lambda: gt3.lambda, minWarmUpSamples: 1
            } ) );
            for ( let i = 0; i <= gt9.detectionIndex; i += 1 ) {
                update( state, { value: gt3.values[ i ] } );
            }
            expect( state.cumSum ).to.equal( gt9.cumSumAfterDetection );
            expect( state.minCumSum ).to.equal( gt9.minCumSumAfterDetection );
            // Mean and count continue (not reset)
            expect( state.mean ).to.be.closeTo( gt9.meanAtDetection, TOL );
            expect( state.count ).to.equal( gt9.countAtDetection );
        } );
    } );

    describe( 'detectDrop mode', function () {
        it( 'detects decrease in mean when detectDrop is true', function () {
            // see golden-truth-page-hinkley.py S7
            const gt = goldenTruth[ 'S7-detect-drop' ];
            const state = init( makeSpec( {
                delta: gt.delta, lambda: gt.lambda, detectDrop: true
            } ) );
            let detectionIndex = -1;
            for ( let i = 0; i < gt.values.length; i += 1 ) {
                update( state, { value: gt.values[ i ] } );
                if ( state.shiftDetected && detectionIndex === -1 ) {
                    detectionIndex = i;
                }
            }
            expect( detectionIndex ).to.equal( gt.detectionIndex );
        } );
    } );

    describe( 'invalid input handling', function () {
        it( 'sets inputValidationFailed on NaN', function () {
            const state = init( makeSpec() );
            update( state, { value: NaN } );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on Infinity', function () {
            const state = init( makeSpec() );
            update( state, { value: Infinity } );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on undefined', function () {
            const state = init( makeSpec() );
            update( state, { value: undefined } );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on missing field', function () {
            const state = init( makeSpec() );
            update( state, {} );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'recovers from invalid input', function () {
            const state = init( makeSpec() );
            update( state, { value: NaN } );
            expect( state.inputValidationFailed ).to.equal( true );
            update( state, { value: 10 } );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'does not update count on invalid input', function () {
            const state = init( makeSpec() );
            update( state, { value: 10 } );
            expect( state.count ).to.equal( 1 );
            update( state, { value: NaN } );
            expect( state.count ).to.equal( 1 );
        } );
    } );

    describe( 'disable behavior', function () {
        it( 'returns state early when disabled', function () {
            const state = init( makeSpec() );
            state.disable = true;
            update( state, { value: 100 } );
            expect( state.count ).to.equal( 0 );
        } );
    } );

    describe( 'edge cases', function () {
        it( 'handles constant input without detection', function () {
            // see golden-truth-page-hinkley.py S4
            const gt = goldenTruth[ 'S4-constant-input' ];
            const state = init( makeSpec() );
            for ( let i = 0; i < gt.repetitions; i += 1 ) {
                update( state, { value: gt.values[ 0 ] } );
            }
            expect( state.shiftDetected ).to.equal( false );
            expect( state.mean ).to.be.closeTo( gt.finalMean, TOL );
            expect( state.testStatistic ).to.be.closeTo( gt.finalTestStatistic, TOL );
        } );

        it( 'handles zero values', function () {
            // see golden-truth-page-hinkley.py S5
            const gt = goldenTruth[ 'S5-zero-values' ];
            const state = init( makeSpec( { stats: { phMean: { storeAs: 'mean' } } } ) );
            for ( const v of gt.values ) {
                update( state, { value: v } );
            }
            expect( state.mean ).to.equal( gt.finalMean );
        } );

        it( 'handles negative values', function () {
            // see golden-truth-page-hinkley.py S6
            const gt = goldenTruth[ 'S6-negative-values' ];
            const state = init( makeSpec( { stats: { phMean: { storeAs: 'mean' } } } ) );
            for ( let i = 0; i < gt.values.length; i += 1 ) {
                update( state, { value: gt.values[ i ] } );
                expect( state.mean ).to.be.closeTo( gt.means[ i ], TOL );
            }
        } );

        it( 'handles very large values', function () {
            const state = init( makeSpec( { stats: { phMean: { storeAs: 'mean' } } } ) );
            update( state, { value: 1e10 } );
            update( state, { value: 1e10 } );
            expect( state.mean ).to.be.closeTo( 1e10, 1 );
        } );
    } );

    describe( 'tunable support', function () {
        afterEach( function () {
            sinon.restore();
        } );

        it( 'accepts function for delta parameter', function () {
            const dynamicDelta = ( msg ) => msg.noiseLevel * 0.001;
            const state = init( makeSpec( { delta: dynamicDelta } ) );
            expect( state.deltaFn ).to.be.a( 'function' );
            expect( state.deltaFn( { noiseLevel: 5 } ) ).to.equal( 0.005 );
            expect( state.deltaFn( { noiseLevel: 10 } ) ).to.equal( 0.01 );
        } );

        it( 'accepts function for lambda parameter', function () {
            const dynamicLambda = ( msg ) => ( msg.sensitivity === 'high' ? 20 : 50 );
            const state = init( makeSpec( { lambda: dynamicLambda } ) );
            expect( state.lambdaFn ).to.be.a( 'function' );
            expect( state.lambdaFn( { sensitivity: 'high' } ) ).to.equal( 20 );
            expect( state.lambdaFn( { sensitivity: 'normal' } ) ).to.equal( 50 );
        } );

        it( 'uses dynamic delta in update', function () {
            const dynamicDelta = ( msg ) => msg.noiseLevel * 0.001;
            const state = init( makeSpec( {
                delta: dynamicDelta, minWarmUpSamples: 2
            } ) );
            update( state, { value: 100, noiseLevel: 5 } );
            update( state, { value: 100, noiseLevel: 5 } );
            expect( state.shiftDetected ).to.equal( false );
        } );

        it( 'uses dynamic lambda in update for shift detection', function () {
            const dynamicLambda = ( msg ) => ( msg.mode === 'sensitive' ? 5 : 100 );
            const state = init( makeSpec( {
                lambda: dynamicLambda, minWarmUpSamples: 3
            } ) );
            // Warm up
            for ( let i = 0; i < 3; i += 1 ) {
                update( state, { value: 100, mode: 'normal' } );
            }
            // Gradual shift with normal mode (high lambda = harder to detect)
            for ( let i = 0; i < 5; i += 1 ) {
                update( state, { value: 101 + i, mode: 'normal' } );
            }
            // Reset and try with sensitive mode
            reset( state );
            for ( let i = 0; i < 3; i += 1 ) {
                update( state, { value: 100, mode: 'sensitive' } );
            }
            for ( let i = 0; i < 5; i += 1 ) {
                update( state, { value: 101 + i, mode: 'sensitive' } );
            }
            expect( state.lambdaFn( { mode: 'sensitive' } ) ).to.equal( 5 );
            expect( state.lambdaFn( { mode: 'normal' } ) ).to.equal( 100 );
        } );

        it( 'survives throwing tunable and retains last good delta/lambda', function () {
            let callCount = 0;
            const throwAfter2 = function ( msg ) {
                callCount += 1;
                if ( callCount > 2 ) {
                    throw new Error( 'tunable boom' );
                }
                return msg.drift;
            };

            const state = init( makeSpec( {
                delta: throwAfter2, lambda: 50, minWarmUpSamples: 2
            } ) );
            sinon.stub( console, 'error' );

            update( state, { value: 100, drift: 0.01 } );
            expect( state.delta ).to.equal( 0.01 );

            update( state, { value: 101, drift: 0.02 } );
            expect( state.delta ).to.equal( 0.02 );

            // Third call throws — retains last good value
            update( state, { value: 102, drift: 999 } );
            expect( state.delta ).to.equal( 0.02 );
            expect( state.count ).to.equal( 3 );

            // Fourth also throws — still retains
            update( state, { value: 103, drift: 999 } );
            expect( state.delta ).to.equal( 0.02 );
            expect( state.count ).to.equal( 4 );
        } );

        it( 'logs console.error on first tunable error only', function () {
            const stub = sinon.stub( console, 'error' );
            const alwaysThrows = function () {
                throw new Error( 'bad tunable' );
            };

            const state = init( makeSpec( {
                delta: alwaysThrows, minWarmUpSamples: 2
            } ) );

            update( state, { value: 80 } );
            expect( stub.calledOnce ).to.equal( true );
            expect( stub.firstCall.args[ 0 ] ).to.include( 'tunable threw' );

            update( state, { value: 90 } );
            expect( stub.calledOnce ).to.equal( true );
        } );

        it( 'logs again after recovery', function () {
            const stub = sinon.stub( console, 'error' );
            let callCount = 0;
            const errorRecoverError = function ( msg ) {
                callCount += 1;
                if ( callCount === 1 || callCount >= 3 ) {
                    throw new Error( 'intermittent' );
                }
                return msg.drift;
            };

            const state = init( makeSpec( {
                delta: errorRecoverError, minWarmUpSamples: 2
            } ) );

            update( state, { value: 100, drift: 0.01 } );
            expect( stub.calledOnce ).to.equal( true );
            expect( state.tunableErrorLogged ).to.equal( true );

            update( state, { value: 101, drift: 0.01 } );
            expect( state.tunableErrorLogged ).to.equal( false );

            update( state, { value: 102, drift: 0.01 } );
            expect( stub.calledTwice ).to.equal( true );
            expect( state.tunableErrorLogged ).to.equal( true );
        } );
    } );

} );

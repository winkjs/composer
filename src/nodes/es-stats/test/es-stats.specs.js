// Behavioral tests for es-stats node: initialization, update, publish-to,
// error handling, signal quality, anomaly scores, introspection, integration,
// field-keying, and control signals.
//
// Golden-truth numerical accuracy -> golden-truth.specs.js
// Reset, recompute, stability       -> lifecycle.specs.js
import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    init,
    update,
    publishTo,
    disable,
    enable,
    pause,
    unpause,
    reset,
    getSupportedStats,
    getSupportedControlMethods,
    getNodeType,
    getDSLMetadata,
    getStatDescriptions,
    getCapabilities
} from '../index.js';

import { buildMsg, makeXorShift32 } from './test-helpers.js';

describe( 'ES Stats Node', function () {

    // ═══════════════════════════════════════════════════════════════
    // SECTION 1: INITIALIZATION & CONFIGURATION
    // ═══════════════════════════════════════════════════════════════

    describe( '1. Initialization & Configuration', function () {

        describe( '1.1 Basic Initialization', function () {

            it( 'should initialize with minimal configuration', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    stats: {
                        mean: { storeAs: 'avgValue' }
                    }
                };

                const state = init( spec );

                expect( state.x ).to.equal( 'value' );
                expect( state.halfLife ).to.equal( 10 );
                expect( state.biased ).to.equal( false );
                expect( state.disable ).to.equal( false );

                expect( state.needsWelford ).to.equal( true );
                expect( state.needsEnvelope ).to.equal( false );

                expect( state.mean ).to.equal( 0 );
                expect( state.variance ).to.equal( 0 );
                expect( state.sampleCount ).to.equal( 0 );
            } );

            it( 'should initialize with complete configuration', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'sensor' },
                    halfLife: 20,
                    biased: true,
                    stats: {
                        mean: { storeAs: 'mean' },
                        variance: { storeAs: 'var' },
                        stdev: { storeAs: 'std' },
                        floor: { storeAs: 'min' },
                        ceiling: { storeAs: 'max' },
                        envelope: { storeAs: 'env' },
                        mid: { storeAs: 'mid' },
                        snrDB: { storeAs: 'snr' },
                        cv: { storeAs: 'cv' },
                        zScore: { storeAs: 'z' },
                        envScore: { storeAs: 'es' }
                    }
                };

                const state = init( spec );

                expect( state.halfLife ).to.equal( 20 );
                expect( state.biased ).to.equal( true );
                expect( state.needsWelford ).to.equal( true );
                expect( state.needsEnvelope ).to.equal( true );

                // All 11 stats configured
                const statNames = Object.keys( state.stats );
                expect( statNames ).to.have.lengthOf( 11 );
                expect( statNames ).to.include.members( [
                    'mean', 'variance', 'stdev', 'floor', 'ceiling',
                    'envelope', 'mid', 'snrDB', 'cv', 'zScore', 'envScore'
                ] );
            } );

            it( 'should throw on invalid specifications', function () {
                // Missing required fields
                expect( () => init( {} ) ).to.throw();

                // Invalid nodeType
                expect( () => init( {
                    nodeType: 'Wrong',
                    name: 'test',
                    from: { x: 'value' },
                    stats: { mean: { storeAs: 'm' } }
                } ) ).to.throw();

                // Missing stats
                expect( () => init( {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' }
                } ) ).to.throw();

                // Invalid stat name
                expect( () => init( {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    stats: { invalid: { storeAs: 'x' } }
                } ) ).to.throw();
            } );
        } );

        describe( '1.2 Computation Path Detection', function () {

            it( 'should detect Welford path requirements', function () {
                const welfordStats = [ 'mean', 'variance', 'stdev', 'snrDB', 'cv', 'zScore' ];

                welfordStats.forEach( function ( stat ) {
                    const spec = {
                        nodeType: 'ES Stats',
                        name: 'test',
                        from: { x: 'value' },
                        stats: { [ stat ]: { storeAs: 'output' } }
                    };

                    const state = init( spec );
                    expect( state.needsWelford ).to.equal( true );
                } );
            } );

            it( 'should detect envelope path requirements', function () {
                const envelopeStats = [ 'floor', 'ceiling', 'envelope', 'mid', 'envScore' ];

                envelopeStats.forEach( function ( stat ) {
                    const spec = {
                        nodeType: 'ES Stats',
                        name: 'test',
                        from: { x: 'value' },
                        stats: { [ stat ]: { storeAs: 'output' } }
                    };

                    const state = init( spec );
                    expect( state.needsEnvelope ).to.equal( true );
                } );
            } );

            it( 'should detect both paths when needed', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    stats: {
                        mean: { storeAs: 'm' },
                        floor: { storeAs: 'f' }
                    }
                };

                const state = init( spec );
                expect( state.needsWelford ).to.equal( true );
                expect( state.needsEnvelope ).to.equal( true );
            } );
        } );
    } );

    // ═══════════════════════════════════════════════════════════════
    // SECTION 2: CORE STATISTICS (WELFORD'S ALGORITHM)
    // ═══════════════════════════════════════════════════════════════

    describe( '2. Core Statistics (Welford Algorithm)', function () {

        describe( '2.1 Mean Computation', function () {

            it( 'should handle first sample initialization', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    stats: { mean: { storeAs: 'm' } }
                };

                const state = init( spec );

                update( state, buildMsg( 'value', 42 ) );

                expect( state.mean ).to.equal( 42 );
                expect( state.m2 ).to.equal( 0 );
                expect( state.sampleCount ).to.equal( 1 );
            } );
        } );

        describe( '2.2 Variance & Standard Deviation', function () {

            it( 'should produce stdev equal to sqrt(variance)', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    halfLife: 10,
                    stats: {
                        variance: { storeAs: 'var' },
                        stdev: { storeAs: 'std' }
                    }
                };

                const state = init( spec );

                [ 10, 20, 10, 20, 10, 20 ].forEach( function ( v ) {
                    update( state, buildMsg( 'value', v ) );
                } );

                expect( state.stdev ).to.equal( Math.sqrt( state.variance ) );
            } );

            it( 'should clamp negative variance to zero', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    stats: { variance: { storeAs: 'v' } }
                };

                const state = init( spec );

                update( state, buildMsg( 'value', 100 ) );

                // Force negative m2 (simulating numerical error)
                state.m2 = -10;
                state.needsWelford = true;

                update( state, buildMsg( 'value', 100 ) );

                expect( state.variance ).to.equal( 0 );
                expect( state.stdev ).to.equal( 0 );
            } );
        } );

        describe( '2.3 Weight Sum Management', function () {

            it( 'should accumulate weights with monotonic increase up to 1', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    halfLife: 10,
                    stats: { mean: { storeAs: 'm' } }
                };

                const state = init( spec );

                for ( let i = 0; i < 5; i += 1 ) {
                    const prevWeight = state.weightSum;
                    update( state, buildMsg( 'value', 50 ) );
                    expect( state.weightSum ).to.be.above( prevWeight );
                    expect( state.weightSum ).to.be.at.most( 1 );
                }
            } );

            it( 'should clamp weightSum at 1 with fast halfLife', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    halfLife: 1,
                    stats: { mean: { storeAs: 'm' } }
                };

                const state = init( spec );

                for ( let i = 0; i < 100; i += 1 ) {
                    update( state, buildMsg( 'value', 50 ) );
                }

                expect( state.weightSum ).to.equal( 1 );
            } );
        } );
    } );

    // ═══════════════════════════════════════════════════════════════
    // SECTION 3: ENVELOPE STATISTICS
    // ═══════════════════════════════════════════════════════════════

    describe( '3. Envelope Statistics', function () {

        describe( '3.1 Floor & Ceiling Tracking', function () {

            it( 'should implement fast attack on new extremes', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    halfLife: 5,
                    stats: {
                        floor: { storeAs: 'min' },
                        ceiling: { storeAs: 'max' }
                    }
                };

                const state = init( spec );

                update( state, buildMsg( 'value', 50 ) );
                expect( state.floor ).to.equal( 50 );
                expect( state.ceiling ).to.equal( 50 );

                // New minimum — immediate update
                update( state, buildMsg( 'value', 20 ) );
                expect( state.floor ).to.equal( 20 );

                // New maximum — immediate update
                update( state, buildMsg( 'value', 100 ) );
                expect( state.ceiling ).to.equal( 100 );
            } );

            it( 'should implement slow release for non-extremes', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    halfLife: 3,
                    stats: {
                        floor: { storeAs: 'f' },
                        ceiling: { storeAs: 'c' }
                    }
                };

                const state = init( spec );

                update( state, buildMsg( 'value', 0 ) );
                update( state, buildMsg( 'value', 100 ) );

                const initialFloor = state.floor;
                const initialCeiling = state.ceiling;

                update( state, buildMsg( 'value', 50 ) );

                expect( state.floor ).to.be.above( initialFloor );
                expect( state.floor ).to.be.below( 50 );
                expect( state.ceiling ).to.be.below( initialCeiling );
                expect( state.ceiling ).to.be.above( 50 );
            } );
        } );

        describe( '3.2 Envelope Metrics', function () {

            it( 'should compute envelope width and midpoint', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    stats: {
                        envelope: { storeAs: 'env' },
                        mid: { storeAs: 'mid' }
                    }
                };

                const state = init( spec );

                update( state, buildMsg( 'value', 20 ) );
                update( state, buildMsg( 'value', 80 ) );

                expect( state.envelope ).to.equal( state.ceiling - state.floor );
                expect( state.mid ).to.equal( ( state.floor + state.ceiling ) * 0.5 );
            } );

            it( 'should compute envelope score correctly', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    halfLife: 5,
                    stats: { envScore: { storeAs: 'es' } }
                };

                const state = init( spec );

                [ 40, 60, 40, 60, 40, 60 ].forEach( function ( v ) {
                    update( state, buildMsg( 'value', v ) );
                } );

                // Test at midpoint
                update( state, buildMsg( 'value', state.mid ) );
                expect( Math.abs( state.envScore ) ).to.be.below( 0.1 );

                // Test at ceiling
                update( state, buildMsg( 'value', state.ceiling ) );
                expect( state.envScore ).to.be.above( 0.8 );

                // Test at floor
                update( state, buildMsg( 'value', state.floor ) );
                expect( state.envScore ).to.be.below( -0.8 );
            } );

            it( 'should handle zero-width envelope', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    stats: { envScore: { storeAs: 'es' } }
                };

                const state = init( spec );

                update( state, buildMsg( 'value', 100 ) );
                update( state, buildMsg( 'value', 100 ) );

                expect( state.envelope ).to.equal( 0 );
                expect( state.envScore ).to.equal( 0 );
            } );
        } );
    } );

    // ═══════════════════════════════════════════════════════════════
    // SECTION 4: SIGNAL QUALITY METRICS
    // ═══════════════════════════════════════════════════════════════

    describe( '4. Signal Quality Metrics', function () {

        describe( '4.1 Signal-to-Noise Ratio', function () {

            it( 'should compute SNR in dB for clean signals (deterministic)', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    halfLife: 10,
                    stats: { snrDB: { storeAs: 'snr' } }
                };

                const state = init( spec );
                const rng = makeXorShift32( 0xBEEF );

                // Strong signal with minimal noise
                for ( let i = 0; i < 20; i += 1 ) {
                    update( state, buildMsg( 'value', 100 + ( ( rng() * 2 ) - 1 ) ) );
                }

                expect( state.snrDB ).to.be.above( 30 );
            } );

            it( 'should compute SNR when both mean and stdev are well above EPS', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    halfLife: 10,
                    stats: {
                        mean: { storeAs: 'm' },
                        stdev: { storeAs: 's' },
                        snrDB: { storeAs: 'snr' }
                    }
                };
                const state = init( spec );

                // Alternating values create measurable stdev around a large mean
                [ 95, 105, 95, 105, 95, 105, 95, 105 ].forEach( function ( v ) {
                    update( state, buildMsg( 'value', v ) );
                } );

                const expectedSNR = 20 * Math.log10( Math.abs( state.mean ) / state.stdev );
                expect( state.snrDB ).to.be.closeTo( expectedSNR, 1e-10 );
            } );

            it( 'should return 0 dB when mean is near zero but stdev is large', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    stats: { snrDB: { storeAs: 'snr' } }
                };

                const state = init( spec );

                // First sample to get past sampleCount === 0
                update( state, buildMsg( 'value', 100 ) );

                // Force state: mean near zero but m2 large enough to produce
                // a meaningful stdev after the next Welford update.
                // After update(value=0): mean += alpha*(0 - 1e-13) ≈ 1e-13*(1-alpha) < EPS
                // m2 ≈ decay * 25 → stdev ≈ sqrt(decay*25/weightSum) >> EPS
                state.mean = 1e-13;
                state.m2 = 25;
                state.weightSum = 0.5;
                state.variance = 50;
                state.stdev = Math.sqrt( 50 );

                update( state, buildMsg( 'value', 0 ) );

                // stdev should remain well above EPS, mean should be below EPS
                expect( Math.abs( state.mean ) ).to.be.below( state.EPS );
                expect( state.stdev ).to.be.above( state.EPS );
                expect( state.snrDB ).to.equal( 0 );
            } );

            it( 'should cap SNR at 60 dB when stdev approaches zero', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    halfLife: 5,
                    stats: { snrDB: { storeAs: 'snr' } }
                };

                const state = init( spec );

                // Constant values drive stdev to effectively zero
                for ( let i = 0; i < 30; i += 1 ) {
                    update( state, buildMsg( 'value', 100 ) );
                }

                expect( state.snrDB ).to.equal( state.snrDbCap );
            } );
        } );

        describe( '4.2 Coefficient of Variation', function () {

            it( 'should compute CV for normal signals', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    halfLife: 5,
                    stats: { cv: { storeAs: 'cv' } }
                };

                const state = init( spec );

                [ 100, 101, 99, 100, 102 ].forEach( function ( v ) {
                    update( state, buildMsg( 'value', v ) );
                } );

                expect( state.cv ).to.be.below( 0.1 );
            } );

            it( 'should handle near-zero mean', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    stats: { cv: { storeAs: 'cv' } }
                };

                const state = init( spec );

                update( state, buildMsg( 'value', 0.1 ) );

                // Force near-zero mean
                state.mean = 1e-13;
                state.stdev = 1;
                state.needsWelford = true;

                update( state, buildMsg( 'value', 0 ) );

                expect( state.cv ).to.equal( state.cvLarge );
            } );
        } );
    } );

    // ═══════════════════════════════════════════════════════════════
    // SECTION 5: ANOMALY SCORES
    // ═══════════════════════════════════════════════════════════════

    describe( '5. Anomaly Scores', function () {

        describe( '5.1 Z-Score Computation', function () {

            it( 'should compute z-score before updating statistics', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    halfLife: 10,
                    stats: { zScore: { storeAs: 'z' } }
                };

                const state = init( spec );

                for ( let i = 0; i < 20; i += 1 ) {
                    update( state, buildMsg( 'value', 100 + ( ( i % 2 ) * 10 ) ) );
                }

                const meanBefore = state.mean;
                const stdevBefore = state.stdev;

                // Test anomaly
                const anomaly = meanBefore + ( 3 * stdevBefore );
                update( state, buildMsg( 'value', anomaly ) );

                // Z-score uses pre-update statistics
                const expectedZ = ( anomaly - meanBefore ) / stdevBefore;
                expect( state.zScore ).to.be.closeTo( expectedZ, 0.1 );
            } );

            it( 'should handle zero standard deviation', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    stats: { zScore: { storeAs: 'z' } }
                };

                const state = init( spec );

                update( state, buildMsg( 'value', 100 ) );

                // Force zero stdev
                state.mean = 100;
                state.stdev = 1e-13;
                state.needsWelford = true;

                update( state, buildMsg( 'value', 150 ) );

                expect( state.zScore ).to.equal( 0 );
            } );
        } );
    } );

    // ═══════════════════════════════════════════════════════════════
    // SECTION 6: ERROR HANDLING & EDGE CASES
    // ═══════════════════════════════════════════════════════════════

    describe( '6. Error Handling & Edge Cases', function () {

        describe( '6.1 Invalid Input Handling', function () {

            it( 'should handle NaN gracefully', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    stats: {
                        mean: { storeAs: 'mean' },
                        variance: { storeAs: 'var' }
                    }
                };

                const state = init( spec );
                const msg = Object.create( null );

                [ 50, 50, 50 ].forEach( function ( v ) {
                    update( state, buildMsg( 'value', v ) );
                } );
                const validMean = state.mean;

                // NaN should be rejected
                update( state, buildMsg( 'value', NaN ) );
                expect( state.inputValidationFailed ).to.equal( true );
                expect( state.mean ).to.equal( validMean );

                // Publishing should propagate NaN
                publishTo( state, msg );
                expect( Number.isNaN( msg.mean ) ).to.equal( true );
                expect( Number.isNaN( msg.var ) ).to.equal( true );

                // Recovery on valid input
                update( state, buildMsg( 'value', 60 ) );
                expect( state.inputValidationFailed ).to.equal( false );
            } );

            it( 'should handle Infinity as invalid', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    stats: { mean: { storeAs: 'm' } }
                };

                const state = init( spec );

                update( state, buildMsg( 'value', 50 ) );
                const validMean = state.mean;

                update( state, buildMsg( 'value', Infinity ) );
                expect( state.inputValidationFailed ).to.equal( true );
                expect( state.mean ).to.equal( validMean );

                update( state, buildMsg( 'value', -Infinity ) );
                expect( state.inputValidationFailed ).to.equal( true );
            } );
        } );

        describe( '6.2 Publishing Behavior', function () {

            it( 'should not publish before warmup period (3 samples)', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    stats: { mean: { storeAs: 'mean' } }
                };

                const state = init( spec );

                // First sample — no publish
                update( state, buildMsg( 'value', 10 ) );
                const msg1 = Object.create( null );
                publishTo( state, msg1 );
                expect( msg1.mean ).to.equal( undefined );

                // Second sample — no publish
                update( state, buildMsg( 'value', 20 ) );
                const msg2 = Object.create( null );
                publishTo( state, msg2 );
                expect( msg2.mean ).to.equal( undefined );

                // Third sample — starts publishing
                update( state, buildMsg( 'value', 30 ) );
                const msg3 = Object.create( null );
                publishTo( state, msg3 );
                expect( msg3.mean ).to.equal( state.mean );
            } );

            it( 'should only publish requested statistics', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    stats: {
                        mean: { storeAs: 'mean' }
                    }
                };

                const state = init( spec );

                [ 10, 20, 30, 40 ].forEach( function ( v ) {
                    update( state, buildMsg( 'value', v ) );
                } );

                const msg = Object.create( null );
                publishTo( state, msg );

                expect( msg.mean ).to.equal( state.mean );
                expect( msg.variance ).to.equal( undefined );
                expect( msg.floor ).to.equal( undefined );
            } );

            it( 'should not publish when disabled', function () {
                const spec = {
                    nodeType: 'ES Stats',
                    name: 'test',
                    from: { x: 'value' },
                    stats: { mean: { storeAs: 'mean' } }
                };

                const state = init( spec );

                [ 10, 20, 30 ].forEach( function ( v ) {
                    update( state, buildMsg( 'value', v ) );
                } );

                disable( state );
                const msg1 = Object.create( null );
                publishTo( state, msg1 );
                expect( msg1.mean ).to.equal( undefined );

                enable( state );
                const msg2 = Object.create( null );
                publishTo( state, msg2 );
                expect( msg2.mean ).to.equal( state.mean );
            } );
        } );
    } );

    // ═══════════════════════════════════════════════════════════════
    // SECTION 7: INTROSPECTION & METADATA
    // ═══════════════════════════════════════════════════════════════

    describe( '7. Introspection & Metadata', function () {

        it( 'should export all 11 supported statistics', function () {
            const stats = getSupportedStats();

            expect( stats ).to.be.an( 'array' );
            expect( stats ).to.have.lengthOf( 11 );
            expect( stats ).to.include.members( [
                'mean', 'variance', 'stdev',
                'floor', 'ceiling', 'envelope', 'mid',
                'snrDB', 'cv',
                'zScore', 'envScore'
            ] );
        } );

        it( 'should export stat descriptions for all stats', function () {
            const descriptions = getStatDescriptions();

            expect( descriptions ).to.be.an( 'object' );
            expect( descriptions.mean ).to.include( 'Exponentially smoothed mean' );
            expect( descriptions.variance ).to.include( 'Welford' );
            expect( descriptions.snrDB ).to.include( 'Signal-to-noise' );
        } );

        it( 'should export all 5 supported control methods', function () {
            const methods = getSupportedControlMethods();

            expect( methods ).to.be.an( 'object' );
            expect( Object.keys( methods ) ).to.have.lengthOf( 5 );
            expect( methods ).to.have.property( 'reset' ).that.is.a( 'string' );
            expect( methods ).to.have.property( 'enable' ).that.is.a( 'string' );
            expect( methods ).to.have.property( 'disable' ).that.is.a( 'string' );
            expect( methods ).to.have.property( 'pause' ).that.is.a( 'string' );
            expect( methods ).to.have.property( 'unpause' ).that.is.a( 'string' );
        } );

        it( 'should export node type', function () {
            expect( getNodeType() ).to.equal( 'ES Stats' );
        } );

        it( 'should export capabilities with description and features', function () {
            const capabilities = getCapabilities();

            expect( capabilities ).to.have.property( 'description' ).that.is.a( 'string' );
            expect( capabilities ).to.have.property( 'features' ).that.is.an( 'array' );
            expect( capabilities.features ).to.have.lengthOf( 6 );
        } );

        it( 'should export DSL metadata with specSchema and buildSpec', function () {
            const metadata = getDSLMetadata();

            expect( metadata ).to.have.property( 'specSchema' );
            expect( metadata ).to.have.property( 'buildSpec' );
        } );

        it( 'should build valid spec from DSL parameters', function () {
            const metadata = getDSLMetadata();
            const spec = metadata.buildSpec(
                'tempStats',
                'temperature',
                { mean: { storeAs: 'avgTemp' }, stdev: { storeAs: 'stdTemp' } },
                { halfLife: 15 }
            );

            expect( spec.nodeType ).to.equal( 'ES Stats' );
            expect( spec.name ).to.equal( 'tempStats' );
            expect( spec.from.x ).to.equal( 'temperature' );
            expect( spec.halfLife ).to.equal( 15 );
            expect( spec.stats ).to.have.property( 'mean' );
            expect( spec.stats ).to.have.property( 'stdev' );
        } );

        it( 'should include stats with storeAs in buildSpec output', function () {
            const metadata = getDSLMetadata();
            const spec = metadata.buildSpec(
                'sensor',
                'value',
                { mean: { storeAs: 'avg' } },
                {}
            );

            expect( spec.stats.mean.storeAs ).to.equal( 'avg' );
        } );
    } );

    // ═══════════════════════════════════════════════════════════════
    // SECTION 8: INTEGRATION TESTS
    // ═══════════════════════════════════════════════════════════════

    describe( '8. Integration Tests', function () {

        it( 'should handle realistic sensor data with drift and anomalies (deterministic)', function () {
            const spec = {
                nodeType: 'ES Stats',
                name: 'sensor',
                from: { x: 'temp' },
                halfLife: 20,
                biased: false,
                stats: {
                    mean: { storeAs: 'avgTemp' },
                    stdev: { storeAs: 'stdTemp' },
                    floor: { storeAs: 'minTemp' },
                    ceiling: { storeAs: 'maxTemp' },
                    zScore: { storeAs: 'anomaly' },
                    envScore: { storeAs: 'position' }
                }
            };

            const state = init( spec );
            const results = [];
            const rng = makeXorShift32( 0xCAFE );

            for ( let i = 0; i < 200; i += 1 ) {
                const baseTemp = 20 + ( i * 0.05 );
                const noise = ( rng() - 0.5 ) * 2;
                let temp = baseTemp + noise;

                // Inject anomalies
                if ( i === 50 ) temp = 35;
                if ( i === 150 ) temp = 10;

                const msg = Object.create( null );
                msg.temp = temp;
                update( state, msg );
                publishTo( state, msg );

                if ( i >= 2 ) {
                    results.push( {
                        i,
                        temp,
                        mean: msg.avgTemp,
                        zScore: msg.anomaly
                    } );
                }
            }

            // Verify drift tracking
            const lastResult = results[ results.length - 1 ];
            expect( lastResult.mean ).to.be.within( 25, 35 );

            // Verify anomaly detection worked
            const anomalies = results.filter( function ( r ) {
                return Math.abs( r.zScore || 0 ) > 2;
            } );
            expect( anomalies.length ).to.be.above( 0 );
        } );

        it( 'should compute all 11 stats with internal consistency', function () {
            const spec = {
                nodeType: 'ES Stats',
                name: 'complete',
                from: { x: 'value' },
                halfLife: 5,
                stats: {
                    mean: { storeAs: 'm' },
                    variance: { storeAs: 'v' },
                    stdev: { storeAs: 's' },
                    floor: { storeAs: 'f' },
                    ceiling: { storeAs: 'c' },
                    envelope: { storeAs: 'e' },
                    mid: { storeAs: 'mid' },
                    snrDB: { storeAs: 'snr' },
                    cv: { storeAs: 'cv' },
                    zScore: { storeAs: 'z' },
                    envScore: { storeAs: 'es' }
                }
            };

            const state = init( spec );
            const msg = Object.create( null );

            const data = [ 10, 50, 30, 70, 20, 60, 40, 80 ];
            data.forEach( function ( v ) {
                update( state, buildMsg( 'value', v ) );
            } );

            publishTo( state, msg );

            // All stats should be numbers
            [ 'm', 'v', 's', 'f', 'c', 'e', 'mid', 'snr', 'cv', 'z', 'es' ].forEach( function ( key ) {
                expect( typeof msg[ key ] ).to.equal( 'number' );
            } );

            // Verify consistency identities
            expect( msg.s ).to.equal( Math.sqrt( msg.v ) );
            expect( msg.e ).to.equal( msg.c - msg.f );
            expect( msg.mid ).to.equal( ( msg.f + msg.c ) * 0.5 );
        } );

        it( 'should handle enable/disable correctly for both update and publishTo', function () {
            const spec = {
                nodeType: 'ES Stats',
                name: 'test',
                from: { x: 'value' },
                stats: { mean: { storeAs: 'mean' } }
            };

            const state = init( spec );

            [ 10, 20, 30 ].forEach( function ( v ) {
                update( state, buildMsg( 'value', v ) );
            } );
            const meanBeforeDisable = state.mean;

            // Disable — update should be skipped
            disable( state );
            update( state, buildMsg( 'value', 100 ) );
            expect( state.mean ).to.equal( meanBeforeDisable );

            // Disable — publishTo should also be skipped
            const msg1 = Object.create( null );
            publishTo( state, msg1 );
            expect( msg1.mean ).to.equal( undefined );

            // Re-enable — update should resume
            enable( state );
            update( state, buildMsg( 'value', 100 ) );
            expect( state.mean ).to.not.equal( meanBeforeDisable );

            // Re-enable — publishTo should resume
            const msg2 = Object.create( null );
            publishTo( state, msg2 );
            expect( msg2.mean ).to.equal( state.mean );
        } );
    } );

    // ═══════════════════════════════════════════════════════════════
    // SECTION 9: FIELD-KEYING SUPPORT
    // ═══════════════════════════════════════════════════════════════

    describe( '9. Field-keying support', function () {

        it( 'should accept direct halfLife value', function () {
            const state = init( {
                nodeType: 'ES Stats',
                name: 'test',
                from: { x: 'temperature' },
                stats: { mean: { storeAs: 'avg' } },
                halfLife: 20
            } );

            expect( state.halfLife ).to.equal( 20 );
        } );

        it( 'should accept a field-keyed halfLife, resolving the node\'s field', function () {
            const state = init( {
                nodeType: 'ES Stats',
                name: 'test',
                from: { x: 'temperature' },
                stats: { mean: { storeAs: 'avg' } },
                halfLife: { temperature: 20, pressure: 5 }
            } );

            expect( state.halfLife ).to.equal( 20 );
        } );

        it( 'should reject a field-keyed halfLife whose entry is out of range', function () {
            expect( () => init( {
                nodeType: 'ES Stats',
                name: 'test',
                from: { x: 'temperature' },
                stats: { mean: { storeAs: 'avg' } },
                halfLife: { temperature: -5 }
            } ) ).to.throw( /halfLife/ );
        } );

        it( 'should use default halfLife when not specified', function () {
            const state = init( {
                nodeType: 'ES Stats',
                name: 'test',
                from: { x: 'temperature' },
                stats: { mean: { storeAs: 'avg' } }
            } );

            expect( state.halfLife ).to.equal( 10 );
        } );

        it( 'should accept direct biased value', function () {
            const state = init( {
                nodeType: 'ES Stats',
                name: 'test',
                from: { x: 'temperature' },
                stats: { variance: { storeAs: 'var' } },
                biased: true
            } );

            expect( state.biased ).to.equal( true );
        } );

        it( 'should use default biased when not specified', function () {
            const state = init( {
                nodeType: 'ES Stats',
                name: 'test',
                from: { x: 'temperature' },
                stats: { variance: { storeAs: 'var' } }
            } );

            expect( state.biased ).to.equal( false );
        } );
    } );

    // ═══════════════════════════════════════════════════════════════
    // SECTION 10: PAUSE / UNPAUSE CONTROL
    // ═══════════════════════════════════════════════════════════════

    describe( '10. Pause / Unpause control', function () {

        it( 'should skip update when paused', function () {
            const spec = {
                nodeType: 'ES Stats',
                name: 'pauseSkip',
                from: { x: 'temperature' },
                stats: { mean: { storeAs: 'avg' } }
            };
            const state = init( spec );

            update( state, buildMsg( 'temperature', 50.0 ) );
            const meanBefore = state.mean;

            pause( state );

            update( state, buildMsg( 'temperature', 100.0 ) );
            expect( state.mean ).to.equal( meanBefore );
        } );

        it( 'should still publish when paused', function () {
            const spec = {
                nodeType: 'ES Stats',
                name: 'pausePub',
                from: { x: 'temperature' },
                stats: { mean: { storeAs: 'avg' } }
            };
            const state = init( spec );

            update( state, buildMsg( 'temperature', 50.0 ) );
            update( state, buildMsg( 'temperature', 60.0 ) );
            update( state, buildMsg( 'temperature', 70.0 ) );

            pause( state );

            const out = Object.create( null );
            publishTo( state, out );
            expect( 'avg' in out ).to.equal( true );
            expect( out.avg ).to.equal( state.mean );
        } );

        it( 'should resume update after unpause', function () {
            const spec = {
                nodeType: 'ES Stats',
                name: 'unpauseResume',
                from: { x: 'temperature' },
                stats: { mean: { storeAs: 'avg' } }
            };
            const state = init( spec );

            update( state, buildMsg( 'temperature', 50.0 ) );
            const meanBeforePause = state.mean;

            // Pause — update skipped
            pause( state );
            update( state, buildMsg( 'temperature', 200.0 ) );
            expect( state.mean ).to.equal( meanBeforePause );

            // Unpause — update resumes
            unpause( state );
            update( state, buildMsg( 'temperature', 200.0 ) );
            expect( state.mean ).to.not.equal( meanBeforePause );
        } );

        it( 'pause/unpause control methods exist', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );

        it( 'complete lifecycle: warmup -> pause -> publishTo -> unpause -> reset -> re-seed', function () {
            const spec = {
                nodeType: 'ES Stats',
                name: 'lifecycle',
                from: { x: 'value' },
                stats: { mean: { storeAs: 'm' } }
            };
            const state = init( spec );

            // Warmup
            [ 10, 20, 30, 40, 50 ].forEach( function ( v ) {
                update( state, buildMsg( 'value', v ) );
            } );
            const meanAfterWarmup = state.mean;

            // Pause — publishTo still works
            pause( state );
            update( state, buildMsg( 'value', 999 ) );
            expect( state.mean ).to.equal( meanAfterWarmup );

            const msg1 = Object.create( null );
            publishTo( state, msg1 );
            expect( msg1.m ).to.equal( meanAfterWarmup );

            // Unpause — update resumes
            unpause( state );
            update( state, buildMsg( 'value', 999 ) );
            expect( state.mean ).to.not.equal( meanAfterWarmup );

            // Reset — clean slate
            reset( state );
            expect( state.sampleCount ).to.equal( 0 );

            const msg2 = Object.create( null );
            publishTo( state, msg2 );
            expect( msg2.m ).to.equal( undefined );

            // Re-seed
            update( state, buildMsg( 'value', 77 ) );
            expect( state.mean ).to.equal( 77 );
            expect( state.sampleCount ).to.equal( 1 );
        } );
    } );
} );

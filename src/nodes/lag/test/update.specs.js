/**
 * Tests for lag node update() — all six stat computations, absolute mode,
 * multiple stats, startup behavior, invalid input handling, edge cases,
 * and full cumDelta section.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import * as lag from '../index.js';
import {
    createMessage,
    goldenTruth,
    LOG_RETURN_10PCT,
    CUMDELTA_SPEC,
    DELTA_CUMDELTA_SPEC
} from './test-helpers.js';

// ── Test Suite ─────────────────────────────────────────────────────────────

describe( 'Lag Node — Update', function () {
    // ════════════════════════════════════════════════════════════════════════
    // Basic Delta Computation (lag=1)
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Basic delta computation (lag=1)', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Lag',
                name: 'change',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'diff' } }
            };
            state = lag.init( spec );
        } );

        it( 'outputs NaN until buffer fills', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            expect( Number.isNaN( state.delta ) ).to.equal( true );
        } );

        it( 'computes delta after buffer fills', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 15 } ) );
            expect( state.delta ).to.equal( goldenTruth[ 'S8-basic-pairs' ].delta_10_15 );
        } );

        it( 'computes negative delta correctly', function () {
            lag.update( state, createMessage( { value: 20 } ) );
            lag.update( state, createMessage( { value: 12 } ) );
            expect( state.delta ).to.equal( goldenTruth[ 'S6-absolute-mode' ].rawDelta );
        } );

        it( 'handles zero delta', function () {
            lag.update( state, createMessage( { value: 50 } ) );
            lag.update( state, createMessage( { value: 50 } ) );
            expect( state.delta ).to.equal( 0 );
        } );

        it( 'computes rolling deltas correctly', function () {
            const values = [ 10, 15, 12, 20, 18 ];
            const expected = [ NaN, 5, -3, 8, -2 ];

            values.forEach( ( v, i ) => {
                lag.update( state, createMessage( { value: v } ) );
                if ( Number.isNaN( expected[ i ] ) ) {
                    expect( Number.isNaN( state.delta ) ).to.equal( true );
                } else {
                    expect( state.delta ).to.equal( expected[ i ] );
                }
            } );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // xLag Computation — direct publication of the lagged input value
    // ════════════════════════════════════════════════════════════════════════

    describe( 'xLag computation', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Lag',
                name: 'xl',
                from: { x: 'value' },
                stats: { xLag: { storeAs: 'prevValue' } }
            };
            state = lag.init( spec );
        } );

        it( 'outputs NaN until buffer fills (lag=1)', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            expect( Number.isNaN( state.xLag ) ).to.equal( true );
        } );

        it( 'returns x_{k-1} after buffer fills (lag=1)', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 25 } ) );
            expect( state.xLag ).to.equal( 10 );
            lag.update( state, createMessage( { value: 33 } ) );
            expect( state.xLag ).to.equal( 25 );
            lag.update( state, createMessage( { value: 7 } ) );
            expect( state.xLag ).to.equal( 33 );
        } );

        it( 'returns x_{k-n} after buffer fills (lag=3)', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'xl3',
                from: { x: 'value' },
                lag: 3,
                stats: { xLag: { storeAs: 'prevValue' } }
            };
            const state3 = lag.init( spec );
            // Warmup: first 3 samples produce NaN
            lag.update( state3, createMessage( { value: 1 } ) );
            expect( Number.isNaN( state3.xLag ) ).to.equal( true );
            lag.update( state3, createMessage( { value: 2 } ) );
            expect( Number.isNaN( state3.xLag ) ).to.equal( true );
            lag.update( state3, createMessage( { value: 3 } ) );
            expect( Number.isNaN( state3.xLag ) ).to.equal( true );
            // Sample 4: xLag = sample 1
            lag.update( state3, createMessage( { value: 4 } ) );
            expect( state3.xLag ).to.equal( 1 );
            // Sample 5: xLag = sample 2
            lag.update( state3, createMessage( { value: 5 } ) );
            expect( state3.xLag ).to.equal( 2 );
            // Sample 6: xLag = sample 3
            lag.update( state3, createMessage( { value: 6 } ) );
            expect( state3.xLag ).to.equal( 3 );
        } );

        it( 'preserves x_{k-1} alongside delta when both are requested', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'xld',
                from: { x: 'value' },
                stats: {
                    xLag: { storeAs: 'prevValue' },
                    delta: { storeAs: 'd' }
                }
            };
            const stateBoth = lag.init( spec );
            lag.update( stateBoth, createMessage( { value: 10 } ) );
            lag.update( stateBoth, createMessage( { value: 25 } ) );
            // x_lag = 10, delta = 25 - 10 = 15
            expect( stateBoth.xLag ).to.equal( 10 );
            expect( stateBoth.delta ).to.equal( 15 );
            // x_lag + delta should equal current value (the math identity holds)
            expect( stateBoth.xLag + stateBoth.delta ).to.equal( 25 );
        } );

        it( 'handles negative and zero values correctly', function () {
            lag.update( state, createMessage( { value: -5 } ) );
            lag.update( state, createMessage( { value: 0 } ) );
            expect( state.xLag ).to.equal( -5 );
            lag.update( state, createMessage( { value: 7 } ) );
            expect( state.xLag ).to.equal( 0 );
        } );

        it( 'flags inputValidationFailed when input is invalid', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: NaN } ) );
            // Invalid input: state.xLag is not updated, inputValidationFailed is set
            expect( state.inputValidationFailed ).to.equal( true );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Ratio Computation
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Ratio computation', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Lag',
                name: 'ratioTest',
                from: { x: 'value' },
                stats: { ratio: { storeAs: 'rel' } }
            };
            state = lag.init( spec );
        } );

        it( 'outputs NaN until buffer fills', function () {
            lag.update( state, createMessage( { value: 100 } ) );
            expect( Number.isNaN( state.ratio ) ).to.equal( true );
        } );

        it( 'computes ratio correctly (x / x_lag)', function () {
            lag.update( state, createMessage( { value: 100 } ) );
            lag.update( state, createMessage( { value: 150 } ) );
            expect( state.ratio ).to.equal( goldenTruth[ 'S8-basic-pairs' ].ratio_100_150 );
        } );

        it( 'handles ratio less than 1', function () {
            lag.update( state, createMessage( { value: 100 } ) );
            lag.update( state, createMessage( { value: 80 } ) );
            expect( state.ratio ).to.equal( 0.8 );
        } );

        it( 'handles ratio equal to 1', function () {
            lag.update( state, createMessage( { value: 50 } ) );
            lag.update( state, createMessage( { value: 50 } ) );
            expect( state.ratio ).to.equal( 1 );
        } );

        it( 'returns NaN when x_lag is zero', function () {
            lag.update( state, createMessage( { value: 0 } ) );
            lag.update( state, createMessage( { value: 10 } ) );
            expect( Number.isNaN( state.ratio ) ).to.equal( true );
        } );

        it( 'handles negative values', function () {
            lag.update( state, createMessage( { value: -100 } ) );
            lag.update( state, createMessage( { value: -50 } ) );
            expect( state.ratio ).to.equal( 0.5 );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // ROC (Rate of Change) Computation
    // ════════════════════════════════════════════════════════════════════════

    describe( 'ROC computation', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Lag',
                name: 'rocTest',
                from: { x: 'value' },
                stats: { roc: { storeAs: 'pctChange' } }
            };
            state = lag.init( spec );
        } );

        it( 'outputs NaN until buffer fills', function () {
            lag.update( state, createMessage( { value: 100 } ) );
            expect( Number.isNaN( state.roc ) ).to.equal( true );
        } );

        it( 'computes ROC correctly (percentage increase)', function () {
            lag.update( state, createMessage( { value: 100 } ) );
            lag.update( state, createMessage( { value: 110 } ) );
            expect( state.roc ).to.be.closeTo( goldenTruth[ 'S8-basic-pairs' ].roc_100_110, 1e-10 );
        } );

        it( 'computes ROC correctly (percentage decrease)', function () {
            lag.update( state, createMessage( { value: 100 } ) );
            lag.update( state, createMessage( { value: 90 } ) );
            expect( state.roc ).to.be.closeTo( goldenTruth[ 'S2-linear-decrease' ].roc[ 1 ], 1e-10 );
        } );

        it( 'handles zero change', function () {
            lag.update( state, createMessage( { value: 100 } ) );
            lag.update( state, createMessage( { value: 100 } ) );
            expect( state.roc ).to.equal( 0 );
        } );

        it( 'returns NaN when x_lag is zero', function () {
            lag.update( state, createMessage( { value: 0 } ) );
            lag.update( state, createMessage( { value: 10 } ) );
            expect( Number.isNaN( state.roc ) ).to.equal( true );
        } );

        it( 'handles 10% exponential growth sequence', function () {
            const s1 = goldenTruth[ 'S1-exponential-growth' ];
            s1.values.forEach( ( v, i ) => {
                lag.update( state, createMessage( { value: v } ) );
                if ( s1.roc[ i ] === null ) {
                    expect( Number.isNaN( state.roc ) ).to.equal( true );
                } else {
                    expect( state.roc ).to.be.closeTo( s1.roc[ i ], 1e-10 );
                }
            } );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Slope Computation (Time-normalized)
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Slope computation', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Lag',
                name: 'slopeTest',
                from: { x: 'value' },
                timestamp: 'ts',
                stats: { slope: { storeAs: 'rate' } }
            };
            state = lag.init( spec );
        } );

        it( 'outputs NaN until buffer fills', function () {
            lag.update( state, createMessage( { value: 10, ts: 0 } ) );
            expect( Number.isNaN( state.slope ) ).to.equal( true );
        } );

        it( 'computes slope correctly ((x - x_lag) / (t - t_lag))', function () {
            lag.update( state, createMessage( { value: 10, ts: 0 } ) );
            lag.update( state, createMessage( { value: 30, ts: 2 } ) );
            expect( state.slope ).to.equal( goldenTruth[ 'S8-basic-pairs' ].slope_10_30_t0_t2 );
        } );

        it( 'handles negative slope', function () {
            lag.update( state, createMessage( { value: 50, ts: 0 } ) );
            lag.update( state, createMessage( { value: 30, ts: 4 } ) );
            expect( state.slope ).to.equal( -5 ); // (30-50)/(4-0) = -5
        } );

        it( 'returns NaN when time difference is zero', function () {
            lag.update( state, createMessage( { value: 10, ts: 5 } ) );
            lag.update( state, createMessage( { value: 20, ts: 5 } ) );
            expect( Number.isNaN( state.slope ) ).to.equal( true );
        } );

        it( 'handles unit time steps', function () {
            const s1 = goldenTruth[ 'S1-exponential-growth' ];

            s1.values.forEach( ( v, i ) => {
                lag.update( state, createMessage( { value: v, ts: s1.times[ i ] } ) );
                if ( s1.slope[ i ] === null ) {
                    expect( Number.isNaN( state.slope ) ).to.equal( true );
                } else {
                    expect( state.slope ).to.be.closeTo( s1.slope[ i ], 1e-9 );
                }
            } );
        } );

        it( 'handles non-unit time steps', function () {
            lag.update( state, createMessage( { value: 0, ts: 0 } ) );
            lag.update( state, createMessage( { value: 100, ts: 10 } ) );
            expect( state.slope ).to.equal( 10 ); // 100/10
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // LogReturn Computation
    // ════════════════════════════════════════════════════════════════════════

    describe( 'LogReturn computation', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Lag',
                name: 'logReturnTest',
                from: { x: 'value' },
                stats: { logReturn: { storeAs: 'lr' } }
            };
            state = lag.init( spec );
        } );

        it( 'outputs NaN until buffer fills', function () {
            lag.update( state, createMessage( { value: 100 } ) );
            expect( Number.isNaN( state.logReturn ) ).to.equal( true );
        } );

        it( 'computes logReturn correctly (ln(x / x_lag))', function () {
            lag.update( state, createMessage( { value: 100 } ) );
            lag.update( state, createMessage( { value: 110 } ) );
            expect( state.logReturn ).to.be.closeTo( LOG_RETURN_10PCT, 1e-10 );
        } );

        it( 'handles negative log return (value decrease)', function () {
            lag.update( state, createMessage( { value: 110 } ) );
            lag.update( state, createMessage( { value: 100 } ) );
            expect( state.logReturn ).to.be.closeTo( goldenTruth[ 'S8-basic-pairs' ].logReturn_110_100, 1e-10 );
        } );

        it( 'handles zero log return (no change)', function () {
            lag.update( state, createMessage( { value: 100 } ) );
            lag.update( state, createMessage( { value: 100 } ) );
            expect( state.logReturn ).to.equal( 0 );
        } );

        it( 'returns NaN when x is zero', function () {
            lag.update( state, createMessage( { value: 100 } ) );
            lag.update( state, createMessage( { value: 0 } ) );
            expect( Number.isNaN( state.logReturn ) ).to.equal( true );
        } );

        it( 'returns NaN when x_lag is zero', function () {
            lag.update( state, createMessage( { value: 0 } ) );
            lag.update( state, createMessage( { value: 100 } ) );
            expect( Number.isNaN( state.logReturn ) ).to.equal( true );
        } );

        it( 'returns NaN when x is negative', function () {
            lag.update( state, createMessage( { value: 100 } ) );
            lag.update( state, createMessage( { value: -50 } ) );
            expect( Number.isNaN( state.logReturn ) ).to.equal( true );
        } );

        it( 'returns NaN when x_lag is negative', function () {
            lag.update( state, createMessage( { value: -100 } ) );
            lag.update( state, createMessage( { value: 50 } ) );
            expect( Number.isNaN( state.logReturn ) ).to.equal( true );
        } );

        it( 'handles 10% exponential growth sequence', function () {
            const s1 = goldenTruth[ 'S1-exponential-growth' ];
            s1.values.forEach( ( v, i ) => {
                lag.update( state, createMessage( { value: v } ) );
                if ( s1.logReturn[ i ] === null ) {
                    expect( Number.isNaN( state.logReturn ) ).to.equal( true );
                } else {
                    expect( state.logReturn ).to.be.closeTo( s1.logReturn[ i ], 1e-10 );
                }
            } );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Absolute Mode
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Absolute mode', function () {
        it( 'applies absolute to delta (positive to positive)', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'absDelta',
                from: { x: 'value' },
                absolute: true,
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 15 } ) );
            expect( state.delta ).to.equal( goldenTruth[ 'S8-basic-pairs' ].delta_10_15 );
        } );

        it( 'applies absolute to delta (negative to positive)', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'absDelta',
                from: { x: 'value' },
                absolute: true,
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 20 } ) );
            lag.update( state, createMessage( { value: 12 } ) );
            expect( state.delta ).to.equal( goldenTruth[ 'S6-absolute-mode' ].absDelta );
        } );

        it( 'applies absolute to slope (positive to positive)', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'absSlope',
                from: { x: 'value' },
                timestamp: 'ts',
                absolute: true,
                stats: { slope: { storeAs: 'rate' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 10, ts: 0 } ) );
            lag.update( state, createMessage( { value: 30, ts: 2 } ) );
            expect( state.slope ).to.equal( goldenTruth[ 'S8-basic-pairs' ].slope_10_30_t0_t2 );
        } );

        it( 'applies absolute to slope (negative to positive)', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'absSlope',
                from: { x: 'value' },
                timestamp: 'ts',
                absolute: true,
                stats: { slope: { storeAs: 'rate' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 50, ts: 0 } ) );
            lag.update( state, createMessage( { value: 30, ts: 4 } ) );
            expect( state.slope ).to.equal( goldenTruth[ 'S6-absolute-mode' ].absSlope );
        } );

        it( 'does NOT apply absolute to ratio', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'absRatio',
                from: { x: 'value' },
                absolute: true,
                stats: { ratio: { storeAs: 'rel' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: -100 } ) );
            lag.update( state, createMessage( { value: 50 } ) );
            expect( state.ratio ).to.equal( -0.5 ); // ratio is NOT absolute
        } );

        it( 'does NOT apply absolute to roc', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'absRoc',
                from: { x: 'value' },
                absolute: true,
                stats: { roc: { storeAs: 'pct' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 100 } ) );
            lag.update( state, createMessage( { value: 90 } ) );
            expect( state.roc ).to.be.closeTo( goldenTruth[ 'S2-linear-decrease' ].roc[ 1 ], 1e-10 ); // roc is NOT absolute
        } );

        it( 'does NOT apply absolute to logReturn', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'absLogReturn',
                from: { x: 'value' },
                absolute: true,
                stats: { logReturn: { storeAs: 'lr' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 110 } ) );
            lag.update( state, createMessage( { value: 100 } ) );
            expect( state.logReturn ).to.be.closeTo( goldenTruth[ 'S8-basic-pairs' ].logReturn_110_100, 1e-10 ); // NOT absolute
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Multiple Stats
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Multiple stats computation', function () {
        it( 'computes all five stats simultaneously', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'allStats',
                from: { x: 'value' },
                timestamp: 'ts',
                stats: {
                    delta: { storeAs: 'myDelta' },
                    ratio: { storeAs: 'myRatio' },
                    roc: { storeAs: 'myRoc' },
                    slope: { storeAs: 'mySlope' },
                    logReturn: { storeAs: 'myLogReturn' }
                }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 100, ts: 0 } ) );
            lag.update( state, createMessage( { value: 110, ts: 1 } ) );

            // Values [100, 110] at [0, 1] = S1 index 1
            const s1 = goldenTruth[ 'S1-exponential-growth' ];
            expect( state.delta ).to.equal( s1.delta[ 1 ] );
            expect( state.ratio ).to.equal( s1.ratio[ 1 ] );
            expect( state.roc ).to.be.closeTo( s1.roc[ 1 ], 1e-10 );
            expect( state.slope ).to.equal( s1.slope[ 1 ] );
            expect( state.logReturn ).to.be.closeTo( s1.logReturn[ 1 ], 1e-10 );
        } );

        it( 'computes subset of stats correctly', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'twoStats',
                from: { x: 'value' },
                stats: {
                    delta: { storeAs: 'change' },
                    roc: { storeAs: 'pctChange' }
                }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 100 } ) );
            lag.update( state, createMessage( { value: 120 } ) );

            expect( state.delta ).to.equal( 20 );
            expect( state.roc ).to.be.closeTo( 0.2, 1e-10 );
            // Other stats should not be computed (remain NaN)
            expect( state.hasRatio ).to.equal( false );
            expect( state.hasSlope ).to.equal( false );
            expect( state.hasLogReturn ).to.equal( false );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Startup Behavior
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Startup behavior (buffer fill)', function () {
        it( 'all stats are NaN during startup with lag=3', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'startup',
                from: { x: 'value' },
                timestamp: 'ts',
                lag: 3,
                stats: {
                    delta: { storeAs: 'd' },
                    ratio: { storeAs: 'r' },
                    roc: { storeAs: 'c' },
                    slope: { storeAs: 's' },
                    logReturn: { storeAs: 'l' }
                }
            };
            const state = lag.init( spec );

            // First 3 updates should leave all stats as NaN
            for ( let i = 0; i < 3; i += 1 ) {
                lag.update( state, createMessage( { value: ( i + 1 ) * 10, ts: i } ) );
                expect( Number.isNaN( state.delta ) ).to.equal( true );
                expect( Number.isNaN( state.ratio ) ).to.equal( true );
                expect( Number.isNaN( state.roc ) ).to.equal( true );
                expect( Number.isNaN( state.slope ) ).to.equal( true );
                expect( Number.isNaN( state.logReturn ) ).to.equal( true );
            }

            // 4th update: buffer full, stats computed
            lag.update( state, createMessage( { value: 40, ts: 3 } ) );
            expect( Number.isNaN( state.delta ) ).to.equal( false );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Invalid Input Handling
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Invalid input handling', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Lag',
                name: 'validator',
                from: { x: 'value' },
                timestamp: 'ts',
                stats: {
                    delta: { storeAs: 'd' },
                    slope: { storeAs: 's' }
                }
            };
            state = lag.init( spec );
        } );

        it( 'sets inputValidationFailed on NaN x', function () {
            lag.update( state, createMessage( { value: 10, ts: 0 } ) );
            lag.update( state, createMessage( { value: NaN, ts: 1 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on Infinity x', function () {
            lag.update( state, createMessage( { value: 10, ts: 0 } ) );
            lag.update( state, createMessage( { value: Infinity, ts: 1 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on undefined x', function () {
            lag.update( state, createMessage( { value: 10, ts: 0 } ) );
            lag.update( state, createMessage( { value: undefined, ts: 1 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on NaN timestamp', function () {
            lag.update( state, createMessage( { value: 10, ts: 0 } ) );
            lag.update( state, createMessage( { value: 20, ts: NaN } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on undefined timestamp', function () {
            lag.update( state, createMessage( { value: 10, ts: 0 } ) );
            lag.update( state, createMessage( { value: 20, ts: undefined } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on missing x field', function () {
            lag.update( state, createMessage( { other: 10, ts: 0 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'recovers from invalid input on next valid value', function () {
            lag.update( state, createMessage( { value: 10, ts: 0 } ) );
            lag.update( state, createMessage( { value: NaN, ts: 1 } ) );
            expect( state.inputValidationFailed ).to.equal( true );

            lag.update( state, createMessage( { value: 20, ts: 2 } ) );
            expect( state.inputValidationFailed ).to.equal( false );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Edge Cases
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Edge cases', function () {
        it( 'handles very small differences', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'tiny',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 1.0000001 } ) );
            lag.update( state, createMessage( { value: 1.0000002 } ) );
            expect( state.delta ).to.be.closeTo( 1e-7, 1e-12 );
        } );

        it( 'handles very large values', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'large',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 1e15 } ) );
            lag.update( state, createMessage( { value: 2e15 } ) );
            expect( state.delta ).to.equal( 1e15 );
        } );

        it( 'handles negative values for delta', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'negative',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: -10 } ) );
            lag.update( state, createMessage( { value: -5 } ) );
            expect( state.delta ).to.equal( 5 ); // -5 - (-10) = 5
        } );

        it( 'handles zero crossing', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'crossing',
                from: { x: 'value' },
                stats: {
                    delta: { storeAs: 'd' },
                    roc: { storeAs: 'r' }
                }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: -5 } ) );
            lag.update( state, createMessage( { value: 5 } ) );
            expect( state.delta ).to.equal( 10 );
            expect( state.roc ).to.equal( goldenTruth[ 'S8-basic-pairs' ].roc_neg5_pos5 );
        } );

        it( 'handles constant stream', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'constant',
                from: { x: 'value' },
                stats: {
                    delta: { storeAs: 'd' },
                    ratio: { storeAs: 'r' },
                    roc: { storeAs: 'c' }
                }
            };
            const state = lag.init( spec );

            for ( let i = 0; i < 5; i += 1 ) {
                lag.update( state, createMessage( { value: 42 } ) );
                if ( i > 0 ) {
                    expect( state.delta ).to.equal( 0 );
                    expect( state.ratio ).to.equal( 1 );
                    expect( state.roc ).to.equal( 0 );
                }
            }
        } );

        it( 'handles alternating values', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'alternating',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );

            const values = [ 10, 20, 10, 20, 10 ];
            const expected = [ NaN, 10, -10, 10, -10 ];

            values.forEach( ( v, i ) => {
                lag.update( state, createMessage( { value: v } ) );
                if ( Number.isNaN( expected[ i ] ) ) {
                    expect( Number.isNaN( state.delta ) ).to.equal( true );
                } else {
                    expect( state.delta ).to.equal( expected[ i ] );
                }
            } );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // CumDelta Computation
    // ════════════════════════════════════════════════════════════════════════

    describe( 'CumDelta computation', function () {
        let state;

        beforeEach( function () {
            state = lag.init( { ...CUMDELTA_SPEC, name: 'cumDeltaTest' } );
        } );

        // ── Startup Behavior ────────────────────────────────────────────────

        it( 'initializes cumDelta to 0 (not NaN)', function () {
            expect( state.cumDelta ).to.equal( 0 );
        } );

        it( 'outputs 0 during startup before buffer fills', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            expect( state.cumDelta ).to.equal( 0 );

            const output = Object.create( null );
            lag.publishTo( state, output );
            expect( output.cumD ).to.equal( 0 );
        } );

        // ── Basic Accumulation ──────────────────────────────────────────────

        it( 'accumulates first delta after buffer fills', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 15 } ) );
            expect( state.cumDelta ).to.equal( 5 ); // 15 - 10
        } );

        it( 'accumulates sequential deltas correctly', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 15 } ) );  // cumDelta = 5
            lag.update( state, createMessage( { value: 12 } ) );  // cumDelta = 5 + (-3) = 2
            lag.update( state, createMessage( { value: 20 } ) );  // cumDelta = 2 + 8 = 10
            expect( state.cumDelta ).to.equal( 10 );
        } );

        it( 'equals x[now] - x[at_start] (telescoping sum property)', function () {
            const s4 = goldenTruth[ 'S4-cumDelta' ];
            s4.values.forEach( ( v ) => lag.update( state, createMessage( { value: v } ) ) );
            expect( state.cumDelta ).to.equal( s4.telescopingCheck );
        } );

        it( 'handles negative deltas correctly', function () {
            lag.update( state, createMessage( { value: 100 } ) );
            lag.update( state, createMessage( { value: 90 } ) );  // cumDelta = -10
            lag.update( state, createMessage( { value: 80 } ) );  // cumDelta = -20
            expect( state.cumDelta ).to.equal( -20 );
        } );

        it( 'returns to 0 on zero net change', function () {
            lag.update( state, createMessage( { value: 100 } ) );
            lag.update( state, createMessage( { value: 110 } ) );  // +10
            lag.update( state, createMessage( { value: 100 } ) );  // -10
            expect( state.cumDelta ).to.equal( 0 );
        } );

        // ── Reset Behavior ──────────────────────────────────────────────────

        it( 'resets cumDelta to 0 (not NaN)', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );
            expect( state.cumDelta ).to.equal( 10 );

            lag.reset( state );
            expect( state.cumDelta ).to.equal( 0 );
        } );

        it( 'accumulates immediately after reset (no lost sample)', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );
            lag.reset( state );

            // ADR-008: buffer preserved, first delta bridges boundary (100-20=80)
            lag.update( state, createMessage( { value: 100 } ) );
            expect( state.cumDelta ).to.equal( 80 );
        } );

        it( 'accumulates fresh after reset (new integration lower limit)', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );
            expect( state.cumDelta ).to.equal( 10 );

            lag.reset( state );

            // ADR-008: buffer preserved, bridges boundary gap-free
            lag.update( state, createMessage( { value: 100 } ) );  // cumDelta = 80 (100-20)
            lag.update( state, createMessage( { value: 150 } ) );  // cumDelta = 80+50 = 130
            expect( state.cumDelta ).to.equal( 130 );
        } );

        it( 'handles multiple resets correctly', function () {
            // First accumulation
            lag.update( state, createMessage( { value: 0 } ) );
            lag.update( state, createMessage( { value: 100 } ) );
            expect( state.cumDelta ).to.equal( 100 );

            // First reset: buffer preserved, first delta bridges boundary
            lag.reset( state );
            lag.update( state, createMessage( { value: 50 } ) );   // cumDelta = -50 (50-100)
            lag.update( state, createMessage( { value: 75 } ) );   // cumDelta = -50+25 = -25
            expect( state.cumDelta ).to.equal( -25 );

            // Second reset: buffer preserved again
            lag.reset( state );
            lag.update( state, createMessage( { value: 200 } ) );  // cumDelta = 125 (200-75)
            lag.update( state, createMessage( { value: 180 } ) );  // cumDelta = 125+(-20) = 105
            expect( state.cumDelta ).to.equal( 105 );
        } );

        it( 'publishes cumDelta immediately after reset (buffer preserved)', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );
            lag.reset( state );

            lag.update( state, createMessage( { value: 100 } ) );  // cumDelta = 80 (100-20)

            const output = Object.create( null );
            lag.publishTo( state, output );
            expect( output.cumD ).to.equal( 80 );
        } );

        // ── Invalid Input Handling ──────────────────────────────────────────

        it( 'preserves cumDelta on invalid input (skips accumulation)', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );
            expect( state.cumDelta ).to.equal( 10 );

            lag.update( state, createMessage( { value: NaN } ) );
            expect( state.cumDelta ).to.equal( 10 ); // Unchanged
        } );

        it( 'publishes current cumDelta on inputValidationFailed (not NaN)', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );
            lag.update( state, createMessage( { value: NaN } ) );

            const output = Object.create( null );
            lag.publishTo( state, output );
            expect( output.cumD ).to.equal( 10 ); // Preserved value, not NaN
        } );

        it( 'resumes accumulation after recovery from invalid input', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );  // cumDelta = 10
            lag.update( state, createMessage( { value: NaN } ) ); // skipped
            lag.update( state, createMessage( { value: 25 } ) );  // cumDelta = 10 + 5 = 15
            expect( state.cumDelta ).to.equal( 15 );
        } );

        it( 'handles multiple consecutive invalid inputs', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 30 } ) );  // cumDelta = 20
            lag.update( state, createMessage( { value: Infinity } ) );
            lag.update( state, createMessage( { value: undefined } ) );
            lag.update( state, createMessage( { value: NaN } ) );
            expect( state.cumDelta ).to.equal( 20 ); // Still 20

            lag.update( state, createMessage( { value: 40 } ) );  // cumDelta = 20 + 10 = 30
            expect( state.cumDelta ).to.equal( 30 );
        } );

        // ── Lag > 1 ─────────────────────────────────────────────────────────

        it( 'accumulates correctly with lag > 1', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'cumDeltaLag3',
                from: { x: 'value' },
                lag: 3,
                stats: { cumDelta: { storeAs: 'cumD' } }
            };
            const s = lag.init( spec );

            const s5 = goldenTruth[ 'S5-cumDelta-lag3' ];
            // values: [10, 20, 30, 40, 50, 60]
            // lag-3 pairs: (40,10), (50,20), (60,30)
            // deltas: 30, 30, 30
            // cumDelta: 30, 60, 90
            [ 10, 20, 30 ].forEach( ( v ) => lag.update( s, createMessage( { value: v } ) ) );
            expect( s.cumDelta ).to.equal( 0 ); // Still in startup

            lag.update( s, createMessage( { value: 40 } ) );
            expect( s.cumDelta ).to.equal( s5.cumDeltaAfterFill[ 0 ] );

            lag.update( s, createMessage( { value: 50 } ) );
            expect( s.cumDelta ).to.equal( s5.cumDeltaAfterFill[ 1 ] );

            lag.update( s, createMessage( { value: 60 } ) );
            expect( s.cumDelta ).to.equal( s5.cumDeltaAfterFill[ 2 ] );
        } );

        it( 'resets correctly with lag > 1', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'cumDeltaLag2Reset',
                from: { x: 'value' },
                lag: 2,
                stats: { cumDelta: { storeAs: 'cumD' } }
            };
            const s = lag.init( spec );

            lag.update( s, createMessage( { value: 10 } ) );
            lag.update( s, createMessage( { value: 20 } ) );
            lag.update( s, createMessage( { value: 35 } ) ); // cumDelta = 25 (35-10)
            expect( s.cumDelta ).to.equal( 25 );

            lag.reset( s );
            expect( s.cumDelta ).to.equal( 0 );

            // ADR-008: buffer preserved [10, 20, 35] head=0 -> [20, 35] effectively
            // After init: head=0, used=0, buffer=[0,0]
            // Push 10: buffer[0]=10, head=1, used=1 -> evicted=undefined
            // Push 20: buffer[1]=20, head=0(wrap), used=2 -> evicted=undefined
            // Push 35: buffer[0]=35, head=1, used=2 -> evicted=10 (the lag-2 value)
            // After reset: buffer=[35,20], head=1, used=2 (preserved)
            // Push 100: buffer[1]=100, head=0, used=2 -> evicted=20
            lag.update( s, createMessage( { value: 100 } ) ); // cumDelta = 80 (100-20)
            expect( s.cumDelta ).to.equal( 80 );

            // Push 200: buffer[0]=200, head=1, used=2 -> evicted=35
            lag.update( s, createMessage( { value: 200 } ) ); // cumDelta = 80 + (200-35) = 245
            expect( s.cumDelta ).to.equal( 245 );
        } );

        // ── Combined with Other Stats ───────────────────────────────────────

        it( 'computes both delta and cumDelta correctly', function () {
            const s = lag.init( { ...DELTA_CUMDELTA_SPEC, name: 'both' } );

            lag.update( s, createMessage( { value: 10 } ) );
            lag.update( s, createMessage( { value: 15 } ) );
            expect( s.delta ).to.equal( 5 );
            expect( s.cumDelta ).to.equal( 5 );

            lag.update( s, createMessage( { value: 12 } ) );
            expect( s.delta ).to.equal( -3 );
            expect( s.cumDelta ).to.equal( 2 );
        } );

        it( 'uses raw delta (not absolute) even when absolute mode enabled', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'absTest',
                from: { x: 'value' },
                absolute: true,
                stats: {
                    delta: { storeAs: 'd' },
                    cumDelta: { storeAs: 'cumD' }
                }
            };
            const s = lag.init( spec );

            lag.update( s, createMessage( { value: 100 } ) );
            lag.update( s, createMessage( { value: 90 } ) );
            expect( s.delta ).to.equal( 10 );     // |90 - 100| = 10 (absolute)
            expect( s.cumDelta ).to.equal( -10 ); // 90 - 100 = -10 (raw)
        } );

        it( 'publishes cumDelta while delta publishes NaN on invalid input', function () {
            const s = lag.init( { ...DELTA_CUMDELTA_SPEC, name: 'mixedInvalid' } );

            lag.update( s, createMessage( { value: 10 } ) );
            lag.update( s, createMessage( { value: 20 } ) );
            lag.update( s, createMessage( { value: NaN } ) );

            const output = Object.create( null );
            lag.publishTo( s, output );
            expect( Number.isNaN( output.d ) ).to.equal( true );  // delta = NaN
            expect( output.cumD ).to.equal( 10 );                  // cumDelta preserved
        } );

        // ── Buffer Preservation (ADR-008) ────────────────────────────────────

        it( 'clears ring buffer on reset when cumDelta is not configured', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'deltaOnly',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'd' } }
            };
            const s = lag.init( spec );

            lag.update( s, createMessage( { value: 10 } ) );
            lag.update( s, createMessage( { value: 20 } ) );
            expect( s.delta ).to.equal( 10 );

            lag.reset( s );

            // Buffer cleared: first message is startup, delta = NaN
            lag.update( s, createMessage( { value: 100 } ) );
            expect( Number.isNaN( s.delta ) ).to.equal( true );

            lag.update( s, createMessage( { value: 120 } ) );
            expect( s.delta ).to.equal( 20 );
        } );

        it( 'computes both delta and cumDelta correctly after reset', function () {
            const s = lag.init( { ...DELTA_CUMDELTA_SPEC, name: 'combo' } );

            lag.update( s, createMessage( { value: 10 } ) );
            lag.update( s, createMessage( { value: 20 } ) );
            expect( s.delta ).to.equal( 10 );
            expect( s.cumDelta ).to.equal( 10 );

            lag.reset( s );

            // Buffer preserved (hasCumDelta=true): first delta bridges boundary
            lag.update( s, createMessage( { value: 25 } ) );
            expect( s.delta ).to.equal( 5 );      // 25 - 20 (pre-reset value)
            expect( s.cumDelta ).to.equal( 5 );    // 0 + 5

            lag.update( s, createMessage( { value: 30 } ) );
            expect( s.delta ).to.equal( 5 );       // 30 - 25
            expect( s.cumDelta ).to.equal( 10 );    // 5 + 5
        } );

        // ── Disable/Enable ──────────────────────────────────────────────────

        it( 'skips update when disabled', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );
            expect( state.cumDelta ).to.equal( 10 );

            state.disable = true;
            lag.update( state, createMessage( { value: 100 } ) );
            expect( state.cumDelta ).to.equal( 10 ); // Unchanged
        } );

        it( 'skips publish when disabled', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );

            state.disable = true;

            const output = Object.create( null );
            lag.publishTo( state, output );
            expect( output.cumD ).to.equal( undefined );
        } );

        it( 'resumes after re-enable', function () {
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );

            state.disable = true;
            lag.update( state, createMessage( { value: 100 } ) ); // Ignored

            state.disable = false;
            lag.update( state, createMessage( { value: 30 } ) );
            // Buffer still has 20 from before disable, so delta = 30-20 = 10
            expect( state.cumDelta ).to.equal( 20 ); // 10 + 10
        } );
    } );
} );

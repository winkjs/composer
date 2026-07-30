/**
 * Tests for lag node publishTo() — normal publishing, NaN propagation,
 * cumDelta preservation, and interleaving tolerance.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as lag from '../index.js';
import { createMessage, goldenTruth } from './test-helpers.js';

// ── Test Suite ─────────────────────────────────────────────────────────────

describe( 'Lag Node — PublishTo', function () {
    // ════════════════════════════════════════════════════════════════════════
    // Normal Publishing
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Normal publishing', function () {
        it( 'publishes only requested stats', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'partialPublish',
                from: { x: 'value' },
                stats: {
                    delta: { storeAs: 'myDelta' },
                    ratio: { storeAs: 'myRatio' }
                }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 100 } ) );
            lag.update( state, createMessage( { value: 150 } ) );

            const output = Object.create( null );
            lag.publishTo( state, output );

            expect( output.myDelta ).to.equal( goldenTruth[ 'S8-basic-pairs' ].delta_100_150 );
            expect( output.myRatio ).to.equal( goldenTruth[ 'S8-basic-pairs' ].ratio_100_150 );
            expect( output.myRoc ).to.equal( undefined );
            expect( output.mySlope ).to.equal( undefined );
            expect( output.myLogReturn ).to.equal( undefined );
        } );

        it( 'publishes all five stats when requested', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'allStatsPublish',
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

            const output = Object.create( null );
            lag.publishTo( state, output );

            // Values [100, 110] at [0, 1] = S1 index 1
            const s1 = goldenTruth[ 'S1-exponential-growth' ];
            expect( output.myDelta ).to.equal( s1.delta[ 1 ] );
            expect( output.myRatio ).to.equal( s1.ratio[ 1 ] );
            expect( output.myRoc ).to.be.closeTo( s1.roc[ 1 ], 1e-10 );
            expect( output.mySlope ).to.equal( s1.slope[ 1 ] );
            expect( output.myLogReturn ).to.be.closeTo( s1.logReturn[ 1 ], 1e-10 );
        } );

        it( 'publishes xLag with the correct field name and value', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'xlagPublish',
                from: { x: 'value' },
                stats: {
                    xLag: { storeAs: 'previousValue' }
                }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 42 } ) );
            const out0 = Object.create( null );
            lag.publishTo( state, out0 );
            // First sample is during warmup; xLag is NaN
            expect( Number.isNaN( out0.previousValue ) ).to.equal( true );

            lag.update( state, createMessage( { value: 99 } ) );
            const out1 = Object.create( null );
            lag.publishTo( state, out1 );
            // Second sample: xLag is the first value (42)
            expect( out1.previousValue ).to.equal( 42 );

            lag.update( state, createMessage( { value: -7 } ) );
            const out2 = Object.create( null );
            lag.publishTo( state, out2 );
            // Third sample: xLag is the second value (99)
            expect( out2.previousValue ).to.equal( 99 );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Startup / NaN Propagation
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Startup and NaN propagation', function () {
        it( 'publishes NaN during startup (buffer not full)', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'startupPub',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 100 } ) );

            const output = Object.create( null );
            lag.publishTo( state, output );
            expect( Number.isNaN( output.diff ) ).to.equal( true );
        } );

        it( 'publishes NaN when inputValidationFailed', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'nanPub',
                from: { x: 'value' },
                timestamp: 'ts',
                stats: {
                    delta: { storeAs: 'd' },
                    slope: { storeAs: 's' }
                }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: NaN, ts: 0 } ) );

            const output = Object.create( null );
            lag.publishTo( state, output );
            expect( Number.isNaN( output.d ) ).to.equal( true );
            expect( Number.isNaN( output.s ) ).to.equal( true );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // PublishTo Before Update (Rec 6 — interleaving tolerance)
    // ════════════════════════════════════════════════════════════════════════

    describe( 'PublishTo before update (interleaving tolerance)', function () {
        it( 'publishes init values when called before any update', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'noUpdate',
                from: { x: 'value' },
                stats: {
                    delta: { storeAs: 'd' },
                    cumDelta: { storeAs: 'cumD' }
                }
            };
            const state = lag.init( spec );

            const output = Object.create( null );
            lag.publishTo( state, output );

            // Instantaneous stats publish NaN (init state)
            expect( Number.isNaN( output.d ) ).to.equal( true );
            // cumDelta publishes 0 (init state)
            expect( output.cumD ).to.equal( 0 );
        } );

        it( 'publishes reset values when called after reset without update', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'resetNoUpdate',
                from: { x: 'value' },
                stats: {
                    delta: { storeAs: 'd' },
                    cumDelta: { storeAs: 'cumD' }
                }
            };
            const state = lag.init( spec );

            // Build some state then reset
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );
            lag.reset( state );

            const output = Object.create( null );
            lag.publishTo( state, output );

            // After reset: instantaneous stats are NaN, cumDelta is 0
            expect( Number.isNaN( output.d ) ).to.equal( true );
            expect( output.cumD ).to.equal( 0 );
        } );
    } );
} );

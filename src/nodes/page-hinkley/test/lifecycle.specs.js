// Lifecycle tests for page-hinkley node.
// Covers reset, enable/disable, pause/unpause, recompute, and control signal
// idempotency. Reset assertions reference golden-truth-page-hinkley.json S8.

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { init, update, publishTo, reset, recompute, enable, disable, pause, unpause, getSupportedControlMethods } from '../index.js';
import { goldenTruth, makeSpec, createMessage } from './test-helpers.js';

const TOL = 1e-12;

describe( 'Page-Hinkley — lifecycle', function () {

    describe( 'reset', function () {
        it( 'resets cumulative sum', function () {
            const state = init( makeSpec() );
            update( state, { value: 100 } );
            update( state, { value: 200 } );
            reset( state );
            expect( state.cumSum ).to.equal( 0 );
            expect( state.minCumSum ).to.equal( 0 );
        } );

        it( 'resets mean and count', function () {
            const state = init( makeSpec() );
            update( state, { value: 100 } );
            update( state, { value: 200 } );
            reset( state );
            expect( state.mean ).to.equal( 0 );
            expect( state.count ).to.equal( 0 );
        } );

        it( 'resets shiftDetected and testStatistic', function () {
            const state = init( makeSpec( {
                delta: 0.01, lambda: 5, minWarmUpSamples: 1
            } ) );
            // Force a detection
            for ( let i = 0; i < 5; i += 1 ) {
                update( state, { value: 10 } );
            }
            for ( let i = 0; i < 20; i += 1 ) {
                update( state, { value: 50 } );
                if ( state.shiftDetected ) break;
            }
            // Detection happened — now reset
            reset( state );
            expect( state.shiftDetected ).to.equal( false );
            expect( state.testStatistic ).to.equal( 0 );
        } );

        it( 'returns true', function () {
            const state = init( makeSpec() );
            expect( reset( state ) ).to.equal( true );
        } );

        it( 'clears error suppression flag', function () {
            const state = init( makeSpec() );
            state.tunableErrorLogged = true;
            reset( state );
            expect( state.tunableErrorLogged ).to.equal( false );
        } );

        it( 'allows clean warm-again cycle after reset', function () {
            // see golden-truth-page-hinkley.py S8
            const gt = goldenTruth[ 'S8-reset-warm-again' ];
            const state = init( makeSpec( { minWarmUpSamples: 2 } ) );

            // Pre-reset: feed values at 100
            for ( const v of gt.preValues ) {
                update( state, { value: v } );
            }
            expect( state.mean ).to.be.closeTo( gt.preResetFinalMean, TOL );

            // Reset
            reset( state );

            // Post-reset: feed values at 200 — state matches fresh init
            for ( let i = 0; i < gt.postValues.length; i += 1 ) {
                update( state, { value: gt.postValues[ i ] } );
                expect( state.mean ).to.be.closeTo( gt.postResetMeans[ i ], TOL );
                expect( state.testStatistic ).to.be.closeTo( gt.postResetTestStatistics[ i ], TOL );
            }

            // Publishing works after reset + warmup
            const msg = createMessage();
            publishTo( state, msg );
            expect( msg.shifted ).to.equal( false );
        } );

        it( 'is idempotent (double reset)', function () {
            const state = init( makeSpec() );
            update( state, { value: 100 } );
            update( state, { value: 200 } );
            reset( state );
            reset( state );
            expect( state.cumSum ).to.equal( 0 );
            expect( state.mean ).to.equal( 0 );
            expect( state.count ).to.equal( 0 );
            expect( state.shiftDetected ).to.equal( false );
            expect( state.testStatistic ).to.equal( 0 );
        } );
    } );

    describe( 'recompute', function () {
        it( 'returns true (no-op justified)', function () {
            expect( recompute() ).to.equal( true );
        } );
    } );

    describe( 'enable / disable', function () {
        it( 'disable stops update processing', function () {
            const state = init( makeSpec() );
            disable( state );
            expect( state.disable ).to.equal( true );
            update( state, { value: 100 } );
            expect( state.count ).to.equal( 0 );
        } );

        it( 'disable stops publishTo', function () {
            const state = init( makeSpec( { minWarmUpSamples: 1 } ) );
            update( state, { value: 10 } );
            disable( state );
            const msg = createMessage();
            publishTo( state, msg );
            expect( msg.shifted ).to.equal( undefined );
        } );

        it( 'enable resumes processing', function () {
            const state = init( makeSpec() );
            disable( state );
            update( state, { value: 100 } );
            expect( state.count ).to.equal( 0 );
            enable( state );
            expect( state.disable ).to.equal( false );
            update( state, { value: 100 } );
            expect( state.count ).to.equal( 1 );
        } );

        it( 'enable is idempotent', function () {
            const state = init( makeSpec() );
            enable( state );
            enable( state );
            expect( state.disable ).to.equal( false );
        } );

        it( 'disable is idempotent', function () {
            const state = init( makeSpec() );
            disable( state );
            disable( state );
            expect( state.disable ).to.equal( true );
        } );
    } );

    describe( 'pause / unpause', function () {
        it( 'pause skips update but publishTo still works', function () {
            const state = init( makeSpec( { minWarmUpSamples: 2 } ) );
            update( state, { value: 10 } );
            update( state, { value: 10 } );
            const countBefore = state.count;

            pause( state );
            expect( state.pause ).to.equal( true );
            update( state, { value: 100 } );
            expect( state.count ).to.equal( countBefore );

            const msg = createMessage();
            publishTo( state, msg );
            expect( msg.shifted ).to.equal( false );
        } );

        it( 'unpause resumes update', function () {
            const state = init( makeSpec() );
            pause( state );
            update( state, { value: 100 } );
            expect( state.count ).to.equal( 0 );
            unpause( state );
            expect( state.pause ).to.equal( false );
            update( state, { value: 100 } );
            expect( state.count ).to.equal( 1 );
        } );

        it( 'unpause is idempotent', function () {
            const state = init( makeSpec() );
            unpause( state );
            unpause( state );
            expect( state.pause ).to.equal( false );
        } );

        it( 'pause is idempotent', function () {
            const state = init( makeSpec() );
            pause( state );
            pause( state );
            expect( state.pause ).to.equal( true );
        } );

        it( 'pause/unpause control methods declared', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );
    } );

} );

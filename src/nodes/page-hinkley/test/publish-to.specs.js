// PublishTo tests for page-hinkley node.
// Covers stat publishing, warmup gating, NaN propagation, disable, and pause.
// All numerical assertions reference golden-truth-page-hinkley.json.

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { init, update, publishTo } from '../index.js';
import { goldenTruth, makeSpec, createMessage } from './test-helpers.js';

const TOL = 1e-12;

describe( 'Page-Hinkley — publishTo', function () {

    describe( 'stat publishing', function () {
        it( 'publishes phShift to message', function () {
            const state = init( makeSpec( { minWarmUpSamples: 2 } ) );
            update( state, { value: 10 } );
            update( state, { value: 10 } );
            const msg = createMessage();
            publishTo( state, msg );
            expect( msg.shifted ).to.equal( false );
        } );

        it( 'publishes phTestStatistic with golden-truth value', function () {
            // see golden-truth-page-hinkley.py S1
            const gt = goldenTruth[ 'S1-running-mean-basics' ];
            const state = init( makeSpec( {
                stats: { phTestStatistic: { storeAs: 'stat' } },
                minWarmUpSamples: 1
            } ) );
            update( state, { value: gt.values[ 0 ] } );
            const msg = createMessage();
            publishTo( state, msg );
            expect( msg.stat ).to.be.closeTo( gt.testStatistics[ 0 ], TOL );
        } );

        it( 'publishes phMean to message', function () {
            const state = init( makeSpec( {
                stats: { phMean: { storeAs: 'avg' } },
                minWarmUpSamples: 2
            } ) );
            update( state, { value: 10 } );
            update( state, { value: 20 } );
            const msg = createMessage();
            publishTo( state, msg );
            expect( msg.avg ).to.equal( 15 );
        } );

        it( 'publishes all three stats simultaneously', function () {
            // see golden-truth-page-hinkley.py S1
            const gt = goldenTruth[ 'S1-running-mean-basics' ];
            const state = init( makeSpec( {
                stats: {
                    phShift: { storeAs: 'shifted' },
                    phTestStatistic: { storeAs: 'stat' },
                    phMean: { storeAs: 'avg' }
                },
                minWarmUpSamples: 1
            } ) );
            for ( const v of gt.values ) {
                update( state, { value: v } );
            }
            const msg = createMessage();
            publishTo( state, msg );
            expect( msg.shifted ).to.equal( false );
            expect( msg.stat ).to.be.closeTo( gt.testStatistics[ 2 ], TOL );
            expect( msg.avg ).to.be.closeTo( gt.means[ 2 ], TOL );
        } );
    } );

    describe( 'warmup gating', function () {
        it( 'does not publish during warmup', function () {
            const state = init( makeSpec( { minWarmUpSamples: 10 } ) );
            update( state, { value: 10 } );
            update( state, { value: 10 } );
            const msg = createMessage();
            publishTo( state, msg );
            expect( msg.shifted ).to.equal( undefined );
        } );

        it( 'publishes once warmup is satisfied', function () {
            const state = init( makeSpec( { minWarmUpSamples: 2 } ) );
            update( state, { value: 10 } );
            const msg1 = createMessage();
            publishTo( state, msg1 );
            expect( msg1.shifted ).to.equal( undefined );

            update( state, { value: 10 } );
            const msg2 = createMessage();
            publishTo( state, msg2 );
            expect( msg2.shifted ).to.equal( false );
        } );
    } );

    describe( 'NaN propagation', function () {
        it( 'publishes NaN when inputValidationFailed', function () {
            const state = init( makeSpec() );
            update( state, { value: NaN } );
            const msg = createMessage();
            publishTo( state, msg );
            // NaN !== NaN — standard NaN check
            expect( msg.shifted ).to.not.equal( msg.shifted );
        } );
    } );

    describe( 'disable behavior', function () {
        it( 'skips publishing when disabled', function () {
            const state = init( makeSpec() );
            state.disable = true;
            const msg = createMessage();
            publishTo( state, msg );
            expect( msg.shifted ).to.equal( undefined );
        } );
    } );

    describe( 'pause behavior', function () {
        it( 'publishes when paused (last-known values visible)', function () {
            const state = init( makeSpec( { minWarmUpSamples: 2 } ) );
            update( state, { value: 10 } );
            update( state, { value: 10 } );
            state.pause = true;
            const msg = createMessage();
            publishTo( state, msg );
            expect( msg.shifted ).to.equal( false );
        } );
    } );

    describe( 'cold publishTo (no prior update)', function () {
        it( 'does not publish when count is below minWarmUpSamples', function () {
            const state = init( makeSpec( { minWarmUpSamples: 10 } ) );
            const msg = createMessage();
            publishTo( state, msg );
            expect( msg.shifted ).to.equal( undefined );
        } );
    } );

} );

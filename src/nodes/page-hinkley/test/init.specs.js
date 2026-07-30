// Initialization and spec validation tests for page-hinkley node.
// Covers defaults, custom options, validation errors, and state shape.

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { init, DEFAULT_OPTIONS } from '../index.js';
import { BASE_SPEC, makeSpec } from './test-helpers.js';

describe( 'Page-Hinkley — init', function () {

    describe( 'defaults', function () {
        it( 'initializes with valid spec', function () {
            const state = init( { ...BASE_SPEC } );
            expect( state.nodeType ).to.equal( 'Page Hinkley' );
            expect( state.x ).to.equal( 'value' );
        } );

        it( 'applies default delta', function () {
            const state = init( { ...BASE_SPEC } );
            expect( state.deltaFn() ).to.equal( 0.005 );
            expect( state.deltaFn() ).to.equal( DEFAULT_OPTIONS.delta );
        } );

        it( 'applies default lambda', function () {
            const state = init( { ...BASE_SPEC } );
            expect( state.lambdaFn() ).to.equal( 45 );
            expect( state.lambdaFn() ).to.equal( DEFAULT_OPTIONS.lambda );
        } );

        it( 'uses running mean (alpha=0) when no halfLife specified', function () {
            const state = init( { ...BASE_SPEC } );
            expect( state.alpha ).to.equal( 0 );
        } );

        it( 'applies default detectDrop (false)', function () {
            const state = init( { ...BASE_SPEC } );
            expect( state.detectDrop ).to.equal( false );
            expect( state.detectDrop ).to.equal( DEFAULT_OPTIONS.detectDrop );
        } );

        it( 'applies default minWarmUpSamples', function () {
            const state = init( { ...BASE_SPEC } );
            expect( state.minWarmUpSamples ).to.equal( 10 );
            expect( state.minWarmUpSamples ).to.equal( DEFAULT_OPTIONS.minWarmUpSamples );
        } );

        it( 'initializes state variables to zero/false', function () {
            const state = init( { ...BASE_SPEC } );
            expect( state.cumSum ).to.equal( 0 );
            expect( state.minCumSum ).to.equal( 0 );
            expect( state.mean ).to.equal( 0 );
            expect( state.count ).to.equal( 0 );
            expect( state.shiftDetected ).to.equal( false );
            expect( state.testStatistic ).to.equal( 0 );
        } );

        it( 'initializes disable to false', function () {
            const state = init( { ...BASE_SPEC } );
            expect( state.disable ).to.equal( false );
        } );

        it( 'seeds state.delta and state.lambda from DEFAULT_OPTIONS', function () {
            const state = init( { ...BASE_SPEC } );
            expect( state.delta ).to.equal( DEFAULT_OPTIONS.delta );
            expect( state.lambda ).to.equal( DEFAULT_OPTIONS.lambda );
            expect( state.tunableErrorLogged ).to.equal( false );
        } );
    } );

    describe( 'custom options', function () {
        it( 'accepts custom delta', function () {
            const state = init( makeSpec( { delta: 0.01 } ) );
            expect( state.deltaFn() ).to.equal( 0.01 );
        } );

        it( 'accepts custom lambda', function () {
            const state = init( makeSpec( { lambda: 100 } ) );
            expect( state.lambdaFn() ).to.equal( 100 );
        } );

        it( 'accepts custom halfLife for exponentially smoothed baseline', function () {
            const state = init( makeSpec( { halfLife: 5 } ) );
            expect( state.alpha ).to.be.greaterThan( 0 );
            expect( state.alpha ).to.be.lessThan( 1 );
        } );

        it( 'accepts valid spec with all options', function () {
            const state = init( makeSpec( {
                delta: 0.01,
                lambda: 50,
                halfLife: 3.1,
                detectDrop: true,
                minWarmUpSamples: 20
            } ) );
            expect( state.nodeType ).to.equal( 'Page Hinkley' );
        } );
    } );

    describe( 'field-keying support', function () {
        it( 'accepts direct delta value', function () {
            const state = init( makeSpec( { from: { x: 'temp' }, delta: 0.02 } ) );
            expect( state.deltaFn() ).to.equal( 0.02 );
        } );

        it( 'accepts direct lambda value', function () {
            const state = init( makeSpec( { from: { x: 'temp' }, lambda: 100 } ) );
            expect( state.lambdaFn() ).to.equal( 100 );
        } );

        it( 'accepts direct halfLife value', function () {
            const state = init( makeSpec( { from: { x: 'temp' }, halfLife: 5 } ) );
            expect( state.alpha ).to.be.greaterThan( 0 );
        } );

        it( 'uses default delta when not specified', function () {
            const state = init( makeSpec( { from: { x: 'temp' } } ) );
            expect( state.deltaFn() ).to.equal( DEFAULT_OPTIONS.delta );
        } );

        it( 'uses default lambda when not specified', function () {
            const state = init( makeSpec( { from: { x: 'temp' } } ) );
            expect( state.lambdaFn() ).to.equal( DEFAULT_OPTIONS.lambda );
        } );

        it( 'uses running mean (alpha=0) when halfLife not specified', function () {
            const state = init( makeSpec( { from: { x: 'temp' } } ) );
            expect( state.alpha ).to.equal( 0 );
        } );
    } );

    describe( 'spec validation', function () {
        it( 'throws on missing nodeType', function () {
            expect( () => init( {
                name: 'test',
                from: { x: 'value' },
                stats: { phShift: { storeAs: 'shifted' } }
            } ) ).to.throw();
        } );

        it( 'throws on wrong nodeType', function () {
            expect( () => init( makeSpec( { nodeType: 'WrongType' } ) ) ).to.throw();
        } );

        it( 'throws on missing name', function () {
            expect( () => init( {
                nodeType: 'Page Hinkley',
                from: { x: 'value' },
                stats: { phShift: { storeAs: 'shifted' } }
            } ) ).to.throw();
        } );

        it( 'throws on invalid name', function () {
            expect( () => init( makeSpec( { name: '123-invalid' } ) ) ).to.throw();
        } );

        it( 'throws on missing from.x', function () {
            expect( () => init( makeSpec( { from: {} } ) ) ).to.throw();
        } );

        it( 'throws on from.x with spaces', function () {
            expect( () => init( makeSpec( { from: { x: 'bad field' } } ) ) ).to.throw();
        } );

        it( 'throws on missing stats', function () {
            expect( () => init( {
                nodeType: 'Page Hinkley', name: 'test', from: { x: 'value' }
            } ) ).to.throw();
        } );

        it( 'throws on invalid stat name', function () {
            expect( () => init( makeSpec( {
                stats: { invalidStat: { storeAs: 'result' } }
            } ) ) ).to.throw();
        } );

        it( 'throws on halfLife <= 0', function () {
            expect( () => init( makeSpec( { halfLife: 0 } ) ) ).to.throw();
            expect( () => init( makeSpec( { halfLife: -1 } ) ) ).to.throw();
        } );

        it( 'throws on halfLife >= 999999', function () {
            expect( () => init( makeSpec( { halfLife: 999999 } ) ) ).to.throw();
        } );
    } );

} );

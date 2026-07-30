// Initialization and spec validation tests for kalman1d node.
// Covers defaults, custom options, validation errors, and state shape.

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { init } from '../index.js';
import { makeSpec } from './test-helpers.js';

describe( 'Kalman 1d — init', function () {

    it( 'creates valid state with defaults', function () {
        const state = init( makeSpec() );
        expect( state.x ).to.equal( 'temperature' );
        expect( state.R ).to.equal( 1 );
        expect( state.Q ).to.equal( 0.01 );
        expect( state.F ).to.equal( 1 );
        expect( state.G ).to.equal( 0 );
        expect( state.H ).to.equal( 1 );
        expect( state.chi2Threshold ).to.equal( 6.63 );
        expect( state.followMode ).to.equal( false );
        expect( state.Pmax ).to.equal( 100 );
        expect( state.Pmin ).to.equal( 1e-10 );
        expect( state.isInitialized ).to.equal( false );
        expect( state.inputValidationFailed ).to.equal( false );
        expect( state.disable ).to.equal( false );
        expect( state.pause ).to.equal( false );
        expect( state.nodeType ).to.equal( 'Kalman 1d' );
    } );

    it( 'applies custom options', function () {
        const state = init( makeSpec( {
            sensorVariance: 4,
            processVariance: 0.1,
            chi2Threshold: 10.84,
            followMode: true,
            stateTransition: 0.99,
            measurement: 2,
            controlModel: 0.5,
            varianceLimit: 50,
            control: 'heaterPower'
        } ) );
        expect( state.R ).to.equal( 4 );
        // Q is the absolute process noise variance, used directly.
        // Independent of R — no hidden scaling.
        expect( state.Q ).to.equal( 0.1 );
        expect( state.F ).to.equal( 0.99 );
        expect( state.G ).to.equal( 0.5 );
        expect( state.H ).to.equal( 2 );
        expect( state.chi2Threshold ).to.equal( 10.84 );
        expect( state.followMode ).to.equal( true );
        expect( state.Pmax ).to.equal( 200 );
        expect( state.Pmin ).to.equal( 4e-10 );
        expect( state.controlField ).to.equal( 'heaterPower' );
    } );

    it( 'accepts field-keyed variances, resolving the node\'s field', function () {
        const state = init( makeSpec( {
            sensorVariance: { temperature: 4, pressure: 9 },
            processVariance: { temperature: 0.1, pressure: 0.5 }
        } ) );
        expect( state.R ).to.equal( 4 );
        expect( state.Q ).to.equal( 0.1 );
    } );

    it( 'throws on a field-keyed sensorVariance whose entry is not positive', function () {
        expect( () => init( makeSpec( {
            sensorVariance: { temperature: -1 }
        } ) ) ).to.throw();
    } );

    it( 'sets controlField to null when not specified', function () {
        const state = init( makeSpec() );
        expect( state.controlField ).to.equal( null );
    } );

    it( 'uses Object.create(null) for state', function () {
        const state = init( makeSpec() );
        expect( Object.getPrototypeOf( state ) ).to.equal( null );
    } );

    it( 'throws on missing required fields', function () {
        expect( () => init( { nodeType: 'Kalman 1d', name: 'kf' } ) ).to.throw();
        expect( () => init( { nodeType: 'Kalman 1d', from: { x: 't' }, stats: { filtered: { storeAs: 'f' } } } ) ).to.throw();
    } );

    it( 'throws on invalid stat names', function () {
        expect( () => init( makeSpec( {
            stats: { bogus: { storeAs: 'x' } }
        } ) ) ).to.throw();
    } );

    it( 'throws when measurement (H) is zero', function () {
        expect( () => init( makeSpec( {
            measurement: 0
        } ) ) ).to.throw();
    } );
} );

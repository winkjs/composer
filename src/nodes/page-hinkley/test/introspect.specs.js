// Introspect metadata tests for page-hinkley node.
// Covers getters, DSL metadata, buildSpec, cross-field validators,
// default options, and defensive copies.

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    init,
    getNodeType,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getCapabilities,
    getDSLMetadata,
    DEFAULT_OPTIONS
} from '../index.js';

describe( 'Page-Hinkley — introspect', function () {

    describe( 'accessors', function () {
        it( 'getNodeType() returns "Page Hinkley"', function () {
            expect( getNodeType() ).to.equal( 'Page Hinkley' );
        } );

        it( 'getSupportedStats() returns all three stats', function () {
            const stats = getSupportedStats();
            expect( stats ).to.include( 'phShift' );
            expect( stats ).to.include( 'phTestStatistic' );
            expect( stats ).to.include( 'phMean' );
            expect( stats ).to.have.lengthOf( 3 );
        } );

        it( 'getStatDescriptions() describes all stats with non-empty strings', function () {
            const descriptions = getStatDescriptions();
            expect( descriptions ).to.have.property( 'phShift' );
            expect( descriptions ).to.have.property( 'phTestStatistic' );
            expect( descriptions ).to.have.property( 'phMean' );
            expect( descriptions.phShift ).to.be.a( 'string' ).with.length.greaterThan( 0 );
            expect( descriptions.phTestStatistic ).to.be.a( 'string' ).with.length.greaterThan( 0 );
            expect( descriptions.phMean ).to.be.a( 'string' ).with.length.greaterThan( 0 );
        } );

        it( 'getSupportedControlMethods() returns all five methods', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'reset' );
            expect( methods ).to.have.property( 'enable' );
            expect( methods ).to.have.property( 'disable' );
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );

        it( 'getCapabilities() returns description and features array', function () {
            const caps = getCapabilities();
            expect( caps ).to.have.property( 'description' );
            expect( caps.description ).to.be.a( 'string' ).with.length.greaterThan( 0 );
            expect( caps ).to.have.property( 'features' );
            expect( caps.features ).to.be.an( 'array' );
            expect( caps.features ).to.have.lengthOf( 4 );
        } );

        it( 'DEFAULT_OPTIONS has correct values', function () {
            expect( DEFAULT_OPTIONS.delta ).to.equal( 0.005 );
            expect( DEFAULT_OPTIONS.lambda ).to.equal( 45 );
            expect( DEFAULT_OPTIONS ).to.not.have.property( 'alpha' );
            expect( DEFAULT_OPTIONS ).to.not.have.property( 'halfLife' );
            expect( DEFAULT_OPTIONS.detectDrop ).to.equal( false );
            expect( DEFAULT_OPTIONS.minWarmUpSamples ).to.equal( 10 );
        } );

        it( 'getSupportedStats() returns defensive copy', function () {
            const stats1 = getSupportedStats();
            const stats2 = getSupportedStats();
            expect( stats1 ).to.not.equal( stats2 );
        } );
    } );

    describe( 'getDSLMetadata and buildSpec', function () {
        it( 'returns DSL metadata with required properties', function () {
            const meta = getDSLMetadata();
            expect( meta ).to.have.property( 'specSchema' );
            expect( meta ).to.have.property( 'buildSpec' );
            expect( meta ).to.have.property( 'crossFieldValidators' );
        } );

        it( 'specSchema includes all fields', function () {
            const { specSchema } = getDSLMetadata();
            expect( specSchema ).to.have.property( 'nodeType' );
            expect( specSchema ).to.have.property( 'name' );
            expect( specSchema ).to.have.property( 'from' );
            expect( specSchema ).to.have.property( 'delta' );
            expect( specSchema ).to.have.property( 'lambda' );
            expect( specSchema ).to.have.property( 'halfLife' );
            expect( specSchema ).to.have.property( 'stats' );
        } );

        it( 'buildSpec creates valid spec', function () {
            const { buildSpec } = getDSLMetadata();
            const stats = { phShift: { storeAs: 'shifted' } };
            const spec = buildSpec( 'myDetector', 'value', stats, { lambda: 100 } );
            expect( spec.nodeType ).to.equal( 'Page Hinkley' );
            expect( spec.name ).to.equal( 'myDetector' );
            expect( spec.from ).to.deep.equal( { x: 'value' } );
            expect( spec.lambda ).to.equal( 100 );
        } );

        it( 'built spec initializes successfully', function () {
            const { buildSpec } = getDSLMetadata();
            const spec = buildSpec(
                'valid', 'value',
                { phShift: { storeAs: 'shifted' } },
                {}
            );
            const state = init( spec );
            expect( state.nodeType ).to.equal( 'Page Hinkley' );
        } );

        it( 'cross-field validator enforces delta/lambda ratio', function () {
            const { crossFieldValidators } = getDSLMetadata();
            const ratioValidator = crossFieldValidators[ 0 ];

            // delta < 10% of lambda → valid
            expect( ratioValidator.validator( { delta: 0.5, lambda: 10 } ) ).to.equal( true );
            // delta > 10% of lambda → invalid
            expect( ratioValidator.validator( { delta: 5, lambda: 10 } ) ).to.equal( false );
            // Functions defer to runtime
            expect( ratioValidator.validator( { delta: () => 1, lambda: 10 } ) ).to.equal( true );
        } );

        it( 'cross-field validator resolves field-keyed delta/lambda for the node\'s field', function () {
            const { crossFieldValidators } = getDSLMetadata();
            const ratioValidator = crossFieldValidators[ 0 ];

            // field-keyed, delta < 10% of lambda → valid
            expect( ratioValidator.validator( {
                from: { x: 'v' }, delta: { v: 0.5 }, lambda: { v: 10 }
            } ) ).to.equal( true );
            // field-keyed, delta > 10% of lambda → invalid
            expect( ratioValidator.validator( {
                from: { x: 'v' }, delta: { v: 5 }, lambda: { v: 10 }
            } ) ).to.equal( false );
            // field-keyed with a function entry defers to runtime
            expect( ratioValidator.validator( {
                from: { x: 'v' }, delta: { v: () => 1 }, lambda: { v: 10 }
            } ) ).to.equal( true );
        } );
    } );

} );

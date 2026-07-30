/**
 * @fileoverview Introspection tests for the unbalance node — verifies the
 * declared contract (supported stats, descriptions, control methods, node type,
 * capabilities), that every getter returns a defensive copy, and that the DSL
 * metadata (buildSpec shape and the uniqueness cross-field validator) is correct.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import * as ub from '../index.js';

const EXPECTED_STATS = [
    'mean', 'min', 'max', 'range', 'maxDev', 'unbalance', 'worstIndex', 'worstDev',
    'presentCount'
];

describe( 'unbalance — introspect', function () {

    it( 'declares the supported stats', function () {
        expect( ub.getSupportedStats() ).to.deep.equal( EXPECTED_STATS );
    } );

    it( 'returns a defensive copy of the supported stats', function () {
        const first = ub.getSupportedStats();
        first.push( 'tampered' );
        expect( ub.getSupportedStats() ).to.deep.equal( EXPECTED_STATS );
    } );

    it( 'describes every supported stat', function () {
        const descriptions = ub.getStatDescriptions();
        for ( let i = 0; i < EXPECTED_STATS.length; i += 1 ) {
            expect( descriptions[ EXPECTED_STATS[ i ] ] ).to.be.a( 'string' );
        }
    } );

    it( 'declares the shared control methods', function () {
        const methods = ub.getSupportedControlMethods();
        expect( methods.reset ).to.be.a( 'string' );
        expect( methods.enable ).to.be.a( 'string' );
        expect( methods.disable ).to.be.a( 'string' );
        expect( methods.pause ).to.be.a( 'string' );
        expect( methods.unpause ).to.be.a( 'string' );
    } );

    it( 'reports its node type', function () {
        expect( ub.getNodeType() ).to.equal( 'Unbalance' );
    } );

    it( 'reports capabilities as a copy with a non-empty feature list', function () {
        const caps = ub.getCapabilities();
        expect( caps.description ).to.be.a( 'string' );
        expect( caps.features.length ).to.be.greaterThan( 0 );
        caps.features.push( 'tampered' );
        expect( ub.getCapabilities().features ).to.not.include( 'tampered' );
    } );

    it( 'buildSpec assembles the nameXOutputsOptions shape', function () {
        const meta = ub.getDSLMetadata();
        const spec = meta.buildSpec( 'phaseBalance', [ 'p1', 'p2', 'p3' ], { unbalance: { storeAs: 'u' } }, {} );
        expect( spec.nodeType ).to.equal( 'Unbalance' );
        expect( spec.name ).to.equal( 'phaseBalance' );
        expect( spec.from.x ).to.deep.equal( [ 'p1', 'p2', 'p3' ] );
        expect( spec.stats ).to.deep.equal( { unbalance: { storeAs: 'u' } } );
    } );

    it( 'the uniqueness cross-field validator accepts unique and rejects duplicate fields', function () {
        const meta = ub.getDSLMetadata();
        const uniqueness = meta.crossFieldValidators[ 0 ];
        expect( uniqueness.validator( { from: { x: [ 'a', 'b', 'c' ] } } ) ).to.equal( true );
        expect( uniqueness.validator( { from: { x: [ 'a', 'b', 'a' ] } } ) ).to.equal( false );
    } );

    it( 'exposes DEFAULT_OPTIONS with skipOnNaN off and a minPresent floor of two', function () {
        expect( ub.DEFAULT_OPTIONS.skipOnNaN ).to.equal( false );
        expect( ub.DEFAULT_OPTIONS.minPresent ).to.equal( 2 );
    } );

    it( 'declares the skipOnNaN and minPresent options in the spec schema', function () {
        const schema = ub.getDSLMetadata().specSchema;
        expect( schema.skipOnNaN.type ).to.equal( 'boolean' );
        expect( schema.minPresent.type ).to.equal( 'number' );
        expect( schema.minPresent.integer ).to.equal( true );
        expect( schema.minPresent.min ).to.equal( 2 );
    } );

    it( 'the minPresent-requires-skipOnNaN cross-field validator accepts and rejects correctly', function () {
        const rule = ub.getDSLMetadata().crossFieldValidators[ 1 ];
        expect( rule.validator( { skipOnNaN: true, minPresent: 3 } ) ).to.equal( true );
        expect( rule.validator( {} ) ).to.equal( true );                  // neither set
        expect( rule.validator( { minPresent: 3 } ) ).to.equal( false );  // floor without skip
    } );

    it( 'the minPresent-within-width cross-field validator accepts and rejects correctly', function () {
        const rule = ub.getDSLMetadata().crossFieldValidators[ 2 ];
        expect( rule.validator( { from: { x: [ 'a', 'b', 'c' ] }, minPresent: 3 } ) ).to.equal( true );
        expect( rule.validator( { from: { x: [ 'a', 'b', 'c' ] } } ) ).to.equal( true );          // unset
        expect( rule.validator( { from: { x: [ 'a', 'b', 'c' ] }, minPresent: 4 } ) ).to.equal( false );
    } );
} );

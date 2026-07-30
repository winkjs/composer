/**
 * @fileoverview Introspection tests for the tally node — verifies the declared
 * contract (supported stats, descriptions, control methods, node type,
 * capabilities), that every getter returns a defensive copy, and that the DSL
 * metadata (buildSpec shape and the uniqueness cross-field validator) is correct.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import * as tally from '../index.js';

const EXPECTED_STATS = [ 'any', 'all', 'count' ];

describe( 'tally — introspect', function () {

    it( 'declares the three supported stats', function () {
        expect( tally.getSupportedStats() ).to.deep.equal( EXPECTED_STATS );
    } );

    it( 'returns a defensive copy of the supported stats', function () {
        const first = tally.getSupportedStats();
        first.push( 'tampered' );
        expect( tally.getSupportedStats() ).to.deep.equal( EXPECTED_STATS );
    } );

    it( 'describes every supported stat', function () {
        const descriptions = tally.getStatDescriptions();
        for ( let i = 0; i < EXPECTED_STATS.length; i += 1 ) {
            expect( descriptions[ EXPECTED_STATS[ i ] ] ).to.be.a( 'string' );
        }
    } );

    it( 'declares the shared control methods', function () {
        const methods = tally.getSupportedControlMethods();
        expect( methods.reset ).to.be.a( 'string' );
        expect( methods.enable ).to.be.a( 'string' );
        expect( methods.disable ).to.be.a( 'string' );
        expect( methods.pause ).to.be.a( 'string' );
        expect( methods.unpause ).to.be.a( 'string' );
    } );

    it( 'reports its node type', function () {
        expect( tally.getNodeType() ).to.equal( 'Tally' );
    } );

    it( 'reports capabilities as a copy with a non-empty feature list', function () {
        const caps = tally.getCapabilities();
        expect( caps.description ).to.be.a( 'string' );
        expect( caps.features.length ).to.be.greaterThan( 0 );
        caps.features.push( 'tampered' );
        expect( tally.getCapabilities().features ).to.not.include( 'tampered' );
    } );

    it( 'buildSpec assembles the nameXOutputsOptions shape', function () {
        const meta = tally.getDSLMetadata();
        const spec = meta.buildSpec( 'frozenStrings', [ 'scb1_stuck', 'scb2_stuck' ], { any: { storeAs: 'frozen' } }, {} );
        expect( spec.nodeType ).to.equal( 'Tally' );
        expect( spec.name ).to.equal( 'frozenStrings' );
        expect( spec.from.x ).to.deep.equal( [ 'scb1_stuck', 'scb2_stuck' ] );
        expect( spec.stats ).to.deep.equal( { any: { storeAs: 'frozen' } } );
    } );

    it( 'the uniqueness cross-field validator accepts unique and rejects duplicate fields', function () {
        const meta = tally.getDSLMetadata();
        const uniqueness = meta.crossFieldValidators[ 0 ];
        expect( uniqueness.validator( { from: { x: [ 'a', 'b', 'c' ] } } ) ).to.equal( true );
        expect( uniqueness.validator( { from: { x: [ 'a', 'b', 'a' ] } } ) ).to.equal( false );
    } );
} );

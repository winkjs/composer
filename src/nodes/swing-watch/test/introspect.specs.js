import { describe, it } from 'mocha';
// @fileoverview
// introspect.js tests — getter contracts, defensive copies, DSL metadata.

import { expect } from 'chai';
import * as introspect from '../introspect.js';

describe( 'swingWatch introspect', function () {
    // ── Getters ──────────────────────────────────────────────

    it( 'getSupportedStats returns the 10 supported stat names', function () {
        const stats = introspect.getSupportedStats();
        expect( stats.length ).to.equal( 10 );
        expect( stats ).to.include( 'dipCompleted' );
        expect( stats ).to.include( 'peakCompleted' );
        expect( stats ).to.include( 'swingsThisTick' );
        expect( stats ).to.include( 'swingRate' );
    } );

    it( 'getSupportedStats returns a defensive copy', function () {
        const first  = introspect.getSupportedStats();
        first.push( 'rogue' );
        const second = introspect.getSupportedStats();
        expect( second.length ).to.equal( 10 );
        expect( second ).to.not.include( 'rogue' );
    } );

    it( 'getStatDescriptions provides a description for every supported stat', function () {
        const descriptions = introspect.getStatDescriptions();
        const stats = introspect.getSupportedStats();
        for ( const stat of stats ) {
            expect( descriptions[ stat ] ).to.be.a( 'string' );
            expect( descriptions[ stat ].length ).to.be.greaterThan( 0 );
        }
    } );

    it( 'getStatDescriptions returns a defensive copy', function () {
        const first = introspect.getStatDescriptions();
        first.dipCompleted = 'mutated';
        const second = introspect.getStatDescriptions();
        expect( second.dipCompleted ).to.not.equal( 'mutated' );
    } );

    it( 'getSupportedControlMethods returns all ADR-004 lifecycle methods', function () {
        const methods = introspect.getSupportedControlMethods();
        expect( methods.reset ).to.be.a( 'string' );
        expect( methods.enable ).to.be.a( 'string' );
        expect( methods.disable ).to.be.a( 'string' );
        expect( methods.pause ).to.be.a( 'string' );
        expect( methods.unpause ).to.be.a( 'string' );
    } );

    it( 'getNodeType returns the canonical title-case name', function () {
        expect( introspect.getNodeType() ).to.equal( 'Swing Watch' );
    } );

    it( 'getCapabilities returns description plus a non-empty features array', function () {
        const cap = introspect.getCapabilities();
        expect( cap.description ).to.be.a( 'string' );
        expect( cap.description.length ).to.be.greaterThan( 0 );
        expect( Array.isArray( cap.features ) ).to.equal( true );
        expect( cap.features.length ).to.equal( 8 );
    } );

    it( 'getCapabilities returns a defensive copy of features', function () {
        const first = introspect.getCapabilities();
        first.features.push( 'rogue' );
        const second = introspect.getCapabilities();
        expect( second.features.length ).to.equal( 8 );
        expect( second.features ).to.not.include( 'rogue' );
    } );

    // ── DSL Metadata ─────────────────────────────────────────

    it( 'getDSLMetadata exposes specSchema, crossFieldValidators, and buildSpec', function () {
        const meta = introspect.getDSLMetadata();
        expect( typeof meta.specSchema ).to.equal( 'object' );
        expect( Array.isArray( meta.crossFieldValidators ) ).to.equal( true );
        expect( typeof meta.buildSpec ).to.equal( 'function' );
    } );

    it( 'specSchema caps windowSize at 256 (Phase 3 contract)', function () {
        const meta = introspect.getDSLMetadata();
        expect( meta.specSchema.windowSize.max ).to.equal( 256 );
        expect( meta.specSchema.windowSize.min ).to.equal( 4 );
    } );

    // ── buildSpec ────────────────────────────────────────────

    it( 'buildSpec assembles a valid spec when options are omitted', function () {
        const meta  = introspect.getDSLMetadata();
        const stats = { dipCompleted: { storeAs: 'me' } };
        const spec  = meta.buildSpec( 'myNode', 'temp', stats );
        expect( spec.nodeType ).to.equal( 'Swing Watch' );
        expect( spec.name ).to.equal( 'myNode' );
        expect( spec.from.x ).to.equal( 'temp' );
        expect( spec.stats ).to.equal( stats );
        expect( spec.windowSize ).to.equal( undefined );
        expect( spec.threshold ).to.equal( undefined );
        expect( spec.direction ).to.equal( undefined );
    } );

    it( 'buildSpec merges options into the top-level spec', function () {
        const meta  = introspect.getDSLMetadata();
        const stats = { dipCompleted: { storeAs: 'me' } };
        const spec  = meta.buildSpec( 'myNode', 'temp', stats,
            { threshold: 0.5, windowSize: 10, direction: 'dips' } );
        expect( spec.threshold ).to.equal( 0.5 );
        expect( spec.windowSize ).to.equal( 10 );
        expect( spec.direction ).to.equal( 'dips' );
    } );
} );

// nodes/winnow/test/introspect.specs.js

/**
 * @fileoverview Tests for winnow introspection metadata.
 *
 * Validates getter defensive copies, stat descriptions, control method
 * descriptions, capabilities content, DSL metadata/buildSpec, and
 * cross-field validators.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';

import * as winnow from '../index.js';
import { baseSpec } from './test-helpers.js';

describe( 'winnow — introspect', function () {

    it( 'getSupportedStats returns defensive copy', function () {
        const a = winnow.getSupportedStats();
        const b = winnow.getSupportedStats();
        expect( a ).to.deep.equal( [ 'deviation', 'predicted', 'significant', 'xPrev', 'tPrev' ] );
        expect( a ).to.not.equal( b );
    } );

    it( 'getStatDescriptions returns all descriptions with correct values', function () {
        const d = winnow.getStatDescriptions();
        expect( d.deviation ).to.equal( 'Distance from projected trajectory (always published)' );
        expect( d.predicted ).to.equal( 'Where the trajectory says the signal should be' );
        expect( d.significant ).to.equal(
            'Boolean: did the signal stray beyond the adaptive threshold?'
        );
        expect( d.xPrev ).to.include( 'Previous tick input value' );
        expect( d.tPrev ).to.include( 'Previous tick timestamp' );
    } );

    it( 'getSupportedControlMethods returns all methods with descriptions', function () {
        const m = winnow.getSupportedControlMethods();
        expect( m.reset ).to.equal( 'Clears anchor, counter, and accumulated state' );
        expect( m.enable ).to.equal( 'Enables node processing' );
        expect( m.disable ).to.equal( 'Disables node processing' );
        expect( m.pause ).to.equal( 'Pauses node processing while keeping state visible' );
        expect( m.unpause ).to.equal( 'Resumes node processing after pause' );
    } );

    it( 'getNodeType returns Winnow', function () {
        expect( winnow.getNodeType() ).to.equal( 'Winnow' );
    } );

    it( 'getCapabilities returns defensive copy with correct content', function () {
        const c = winnow.getCapabilities();
        expect( c.description ).to.equal(
            'Trajectory-aware significance detector — separates the grain from the chaff'
        );
        expect( c.features.length ).to.equal( 9 );
        expect( c.features[ 0 ] ).to.include( 'Slope-aware deadband' );
    } );

    it( 'getDSLMetadata contains buildSpec that builds valid specs', function () {
        const meta = winnow.getDSLMetadata();
        expect( meta.buildSpec ).to.be.a( 'function' );
        const spec = meta.buildSpec( 'w', 'temp', { significant: { storeAs: 's' } }, { K: 3 } );
        expect( spec.nodeType ).to.equal( 'Winnow' );
        expect( spec.name ).to.equal( 'w' );
        expect( spec.from.x ).to.equal( 'temp' );
        expect( spec.K ).to.equal( 3 );
    } );

    // ── Cross-field validators ─────────────────────────────────────────

    it( 'rejects xPrev stat without bufferPrev: true', function () {
        expect( function () {
            winnow.init( baseSpec( {
                stats: {
                    significant: { storeAs: 'sig' },
                    xPrev: { storeAs: 'xp' }
                }
                // bufferPrev defaults to false
            } ) );
        } ).to.throw( /bufferPrev/ );
    } );

    it( 'rejects tPrev stat without bufferPrev: true', function () {
        expect( function () {
            winnow.init( baseSpec( {
                stats: {
                    significant: { storeAs: 'sig' },
                    tPrev: { storeAs: 'tp' }
                }
            } ) );
        } ).to.throw( /bufferPrev/ );
    } );

    it( 'rejects tPrev stat without timestampField', function () {
        expect( function () {
            winnow.init( baseSpec( {
                bufferPrev: true,
                stats: {
                    significant: { storeAs: 'sig' },
                    tPrev: { storeAs: 'tp' }
                }
                // timestampField not set
            } ) );
        } ).to.throw( /timestampField/ );
    } );

    it( 'accepts xPrev with bufferPrev: true (no timestampField needed)', function () {
        const state = winnow.init( baseSpec( {
            bufferPrev: true,
            stats: {
                significant: { storeAs: 'sig' },
                xPrev: { storeAs: 'xp' }
            }
        } ) );
        expect( state.hasXPrev ).to.equal( true );
        expect( state.hasTPrev ).to.equal( false );
    } );

} );

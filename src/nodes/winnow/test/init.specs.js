// nodes/winnow/test/init.specs.js

/**
 * @fileoverview Tests for winnow node initialisation.
 *
 * Validates default options, custom overrides, tunable K, spec
 * validation errors, partial stats, and bufferPrev configuration.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';

import * as winnow from '../index.js';
import { baseSpec, bufferSpec } from './test-helpers.js';

describe( 'winnow — init', function () {

    it( 'creates valid state with defaults', function () {
        const state = winnow.init( baseSpec() );
        expect( state.K ).to.equal( 2 );
        expect( state.tightenBase ).to.equal( 100 );
        expect( state.maxGap ).to.equal( 500 );
        expect( state.slopeField ).to.equal( 'roc' );
        expect( state.noiseField ).to.equal( 'stdev' );
        expect( state.dirField ).to.equal( 'trendDir' );
        expect( state.gateField ).to.equal( 'gate' );
        expect( state.chi2Threshold ).to.equal( 6.63 );
        expect( state.anchor ).to.equal( null );
        expect( state.counter ).to.equal( 0 );
        expect( state.significant ).to.equal( false );
    } );

    it( 'accepts custom options', function () {
        const state = winnow.init( baseSpec( {
            K: 3,
            tightenBase: 50,
            maxGap: 200,
            slopeField: 'myRoc',
            noiseField: 'myStd',
            dirField: 'myDir',
            gateField: 'myGate',
            chi2Threshold: 3.84
        } ) );
        expect( state.K ).to.equal( 3 );
        expect( state.tightenBase ).to.equal( 50 );
        expect( state.maxGap ).to.equal( 200 );
        expect( state.slopeField ).to.equal( 'myRoc' );
        expect( state.noiseField ).to.equal( 'myStd' );
        expect( state.chi2Threshold ).to.equal( 3.84 );
    } );

    it( 'accepts tunable K (function)', function () {
        const state = winnow.init( baseSpec( {
            K: ( msg ) => msg.customK || 2
        } ) );
        expect( typeof state.KFn ).to.equal( 'function' );
    } );

    it( 'accepts a field-keyed chi2Threshold, resolving the node\'s field', function () {
        const state = winnow.init( baseSpec( {
            chi2Threshold: { value: 3.84, other: 10 }
        } ) );
        expect( state.chi2Threshold ).to.equal( 3.84 );
    } );

    it( 'rejects a field-keyed chi2Threshold whose entry is not positive', function () {
        expect( function () {
            winnow.init( baseSpec( { chi2Threshold: { value: -1 } } ) );
        } ).to.throw( /chi2Threshold must be positive/ );
    } );

    it( 'rejects missing from.x', function () {
        expect( function () {
            winnow.init( { nodeType: 'Winnow', name: 'w', from: {}, stats: { significant: { storeAs: 's' } } } );
        } ).to.throw();
    } );

    it( 'rejects missing stats', function () {
        expect( function () {
            winnow.init( { nodeType: 'Winnow', name: 'w', from: { x: 'v' } } );
        } ).to.throw();
    } );

    it( 'accepts partial stats (only significant)', function () {
        const state = winnow.init( baseSpec( {
            stats: { significant: { storeAs: 'sig' } }
        } ) );
        expect( state.stats.significant.storeAs ).to.equal( 'sig' );
        expect( state.stats.deviation ).to.equal( undefined );
    } );

    // ── bufferPrev configuration ───────────────────────────────────────

    it( 'initialises buffer state when bufferPrev is true', function () {
        const state = winnow.init( bufferSpec() );
        expect( state.bufferPrev ).to.equal( true );
        expect( state.timestampField ).to.equal( 'ts' );
        expect( Number.isNaN( state.bufferedX ) ).to.equal( true );
        expect( Number.isNaN( state.bufferedT ) ).to.equal( true );
        expect( state.keptByGate ).to.equal( false );
        expect( Number.isNaN( state.xPrev ) ).to.equal( true );
        expect( Number.isNaN( state.tPrev ) ).to.equal( true );
        expect( state.hasXPrev ).to.equal( true );
        expect( state.hasTPrev ).to.equal( true );
    } );

    it( 'defaults bufferPrev to false', function () {
        const state = winnow.init( baseSpec() );
        expect( state.bufferPrev ).to.equal( false );
        expect( state.hasXPrev ).to.equal( false );
        expect( state.hasTPrev ).to.equal( false );
    } );

} );

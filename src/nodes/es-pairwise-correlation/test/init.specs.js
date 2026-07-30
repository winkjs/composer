// Initialization tests for es-pairwise-correlation node.
// Covers halfLife→alpha derivation, default option fallbacks,
// fisherZ toggle, and pairNames precomputation.
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as ecv from '../index.js';
import { DEFAULT_OPTIONS } from '../introspect.js';
import { isClose, alphaFromHL } from './test-helpers.js';

describe( 'init: halfLife → alpha and ~85% warm-up defaults', function () {
    it( 'derives alpha from halfLife and honors fisherZ toggle', function () {
        const fields = [ 'a', 'b', 'c' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'initBasic',
            from: { x: fields },
            halfLife: 5,
            minVariance: 1e-10,
            minSamples: 4,
            fisherZT: true,
            stats: { correlations: { storeAs: 'corr' } }
        };

        const s = ecv.init( spec );
        expect( isClose( s.alpha, alphaFromHL( 5 ) ) ).to.equal( true );
        expect( s.minVariance ).to.equal( 1e-10 );
        expect( s.minSamples ).to.equal( 4 );
        expect( s.fisherZCap ).to.be.lessThan( 1 ); // fisherZ on → 0.9999
        expect( s.sampleCount ).to.equal( 0 );
        expect( s.n ).to.equal( fields.length );
        expect( s.pairCount ).to.equal( ( fields.length * ( fields.length - 1 ) ) / 2 );
    } );

    it( 'uses DEFAULT_OPTIONS.halfLife when halfLife is omitted', function () {
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'initDefaults',
            from: { x: [ 't', 'p' ] },
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );
        expect( isClose( s.alpha, alphaFromHL( DEFAULT_OPTIONS.halfLife ) ) ).to.equal( true );
    } );

    it( 'uses DEFAULT_OPTIONS.minVariance when minVariance is omitted', function () {
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'initMinVar',
            from: { x: [ 'a', 'b' ] },
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );
        expect( s.minVariance ).to.equal( DEFAULT_OPTIONS.minVariance );
    } );

    it( 'precomputes pairNames only when requested', function () {
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'pairNamesPrecompute',
            from: { x: [ 'x', 'y', 'z' ] },
            halfLife: 4,
            minSamples: 3,
            stats: {
                correlations: { storeAs: 'corr' },
                pairNames: { storeAs: 'pairs' }
            }
        };
        const s = ecv.init( spec );
        expect( Array.isArray( s.pairNames ) ).to.equal( true );
        expect( s.pairNames.length ).to.equal( 3 ); // xy, xz, yz
        expect( s.pairNames[ 0 ] ).to.equal( 'x-y' );
        expect( s.pairNames[ 1 ] ).to.equal( 'x-z' );
        expect( s.pairNames[ 2 ] ).to.equal( 'y-z' );
    } );

    it( 'does not create pairNames when not requested in stats', function () {
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'noPairNames',
            from: { x: [ 'a', 'b' ] },
            halfLife: 4,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );
        expect( s.pairNames ).to.equal( undefined );
    } );

    it( 'sets fisherZCap to 1 when fisherZT is not enabled', function () {
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'noFisherZ',
            from: { x: [ 'a', 'b' ] },
            halfLife: 5,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );
        expect( s.fisherZCap ).to.equal( 1 );
        expect( s.fisherZT ).to.equal( undefined );
    } );
} );

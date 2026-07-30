// Introspection and DSL metadata tests for es-pairwise-correlation node.
// Covers node type, metadata safety (defensive copies), control methods (all 5),
// DSL buildSpec, and cross-field validators (duplicates, fisherZT dependency).
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as ecv from '../index.js';
import {
    getDSLMetadata,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities,
    DEFAULT_OPTIONS
} from '../introspect.js';

describe( 'Introspection & DSL', function () {
    it( 'returns expected node type', function () {
        expect( getNodeType() ).to.equal( 'ES Pairwise Correlation' );
    } );

    it( 'returns safe copies of metadata (mutation does not leak)', function () {
        const stats1 = getSupportedStats();
        stats1.push( '__mut__' );
        const stats2 = getSupportedStats();
        expect( stats2 ).to.not.include( '__mut__' );

        const desc1 = getStatDescriptions();
        desc1.vector = '__mut__';
        const desc2 = getStatDescriptions();
        expect( desc2.vector ).to.not.equal( '__mut__' );

        const cap1 = getCapabilities();
        expect( cap1 ).to.have.property( 'description' ).that.is.a( 'string' );
        expect( cap1 ).to.have.property( 'features' ).that.is.an( 'array' ).with.length.greaterThan( 0 );

        cap1.features.push( '___mutation___' );
        const cap2 = getCapabilities();
        expect( cap2.features ).to.not.include( '___mutation___' );
    } );

    it( 'getSupportedControlMethods returns all 5 methods', function () {
        const methods = getSupportedControlMethods();
        expect( methods ).to.have.property( 'reset' );
        expect( methods ).to.have.property( 'enable' );
        expect( methods ).to.have.property( 'disable' );
        expect( methods ).to.have.property( 'pause' );
        expect( methods ).to.have.property( 'unpause' );
        expect( Object.keys( methods ).length ).to.equal( 5 );
    } );

    it( 'DEFAULT_OPTIONS includes halfLife and minVariance', function () {
        expect( DEFAULT_OPTIONS ).to.have.property( 'halfLife' );
        expect( DEFAULT_OPTIONS.halfLife ).to.be.a( 'number' );
        expect( DEFAULT_OPTIONS ).to.have.property( 'minVariance' );
        expect( DEFAULT_OPTIONS.minVariance ).to.equal( 1e-12 );
    } );

    it( 'DSL buildSpec emits correct spec with halfLife option', function () {
        const dsl = getDSLMetadata();
        const spec = dsl.buildSpec(
            'espc',
            [ 't', 'p', 'f' ],
            { correlations: { storeAs: 'myVec' } },
            { halfLife: 7.5 }
        );
        expect( spec.nodeType ).to.equal( 'ES Pairwise Correlation' );
        expect( spec.name ).to.equal( 'espc' );
        expect( spec.halfLife ).to.equal( 7.5 );
        expect( spec.from.x ).to.deep.equal( [ 't', 'p', 'f' ] );
        expect( spec.stats.correlations.storeAs ).to.equal( 'myVec' );
    } );
} );

describe( 'Validation: spec constraints', function () {
    it( 'rejects more than 12 variables', function () {
        const tooMany = Array.from( { length: 13 }, ( _, i ) => `v${i}` );
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'tooMany',
            from: { x: tooMany },
            halfLife: 5,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const initFn = function () {
            ecv.init( spec );
        };
        expect( initFn ).to.throw();
    } );

    it( 'rejects duplicate variable names', function () {
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'dupes',
            from: { x: [ 'a', 'b', 'a' ] },
            halfLife: 5,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const initFn = function () {
            ecv.init( spec );
        };
        expect( initFn ).to.throw();
    } );

    it( 'rejects invalid halfLife (non-positive)', function () {
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'badHL',
            from: { x: [ 'a', 'b' ] },
            halfLife: 0,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const initFn = function () {
            ecv.init( spec );
        };
        expect( initFn ).to.throw();
    } );

    it( 'rejects stats.fisherZT without fisherZT enabled', function () {
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'noFisherZ',
            from: { x: [ 'a', 'b' ] },
            halfLife: 5,
            fisherZT: false,
            stats: {
                correlations: { storeAs: 'corr' },
                fisherZT: { storeAs: 'z' }
            }
        };
        const initFn = function () {
            ecv.init( spec );
        };
        expect( initFn ).to.throw();
    } );

    it( 'allows stats.fisherZT when fisherZT is enabled', function () {
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'yesFisherZ',
            from: { x: [ 'a', 'b' ] },
            halfLife: 5,
            fisherZT: true,
            stats: {
                correlations: { storeAs: 'corr' },
                fisherZT: { storeAs: 'z' }
            }
        };
        const initFn = function () {
            ecv.init( spec );
        };
        expect( initFn ).to.not.throw();
    } );
} );

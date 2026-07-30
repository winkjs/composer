// PublishTo tests for es-pairwise-correlation node.
// Covers warm-up gating, selective output, NaN propagation (NaN, undefined,
// Infinity), and disabled-state behaviour.
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as ecv from '../index.js';
import { msgFrom } from './test-helpers.js';

describe( 'publishTo: warm-up gate and selective outputs', function () {
    it( 'publishes nothing before warm-up, then all requested stats after', function () {
        const fields = [ 'a', 'b', 'c' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'publishGate',
            from: { x: fields },
            halfLife: 3,
            minSamples: 3,
            fisherZT: true,
            stats: {
                correlations: { storeAs: 'vec' },
                fisherZT: { storeAs: 'z' },
                pairNames: { storeAs: 'pairs' },
                covariances: { storeAs: 'cov' },
                varNames: { storeAs: 'vars' }
            }
        };
        const s = ecv.init( spec );

        // 1st → init (no publish)
        let out = Object.create( null );
        ecv.update( s, msgFrom( fields, [ 1, 2, 3 ] ) );
        ecv.publishTo( s, out );
        expect( Object.keys( out ).length ).to.equal( 0 );

        // 2nd → still < min
        out = Object.create( null );
        ecv.update( s, msgFrom( fields, [ 2, 4, 6 ] ) );
        ecv.publishTo( s, out );
        expect( Object.keys( out ).length ).to.equal( 0 );

        // 3rd → == minSamples → should publish everything requested
        out = Object.create( null );
        ecv.update( s, msgFrom( fields, [ 3, 6, 9 ] ) );
        ecv.publishTo( s, out );

        expect( out.vec ).to.be.instanceOf( Float64Array );
        expect( out.z ).to.be.instanceOf( Float64Array );
        expect( Array.isArray( out.pairs ) ).to.equal( true );
        expect( out.cov ).to.be.instanceOf( Float64Array );
        expect( Array.isArray( out.vars ) ).to.equal( true );

        // Numeric sanity
        for ( let i = 0; i < out.vec.length; i += 1 ) {
            expect( out.vec[ i ] ).to.be.within( -1, 1 );
            expect( Number.isFinite( out.z[ i ] ) ).to.equal( true );
        }
    } );

    it( 'publishes only requested stats (no fisherZ when not requested)', function () {
        const fields = [ 'x', 'y', 'z' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'publishSelective',
            from: { x: fields },
            halfLife: 5,
            minSamples: 2,
            fisherZT: false,
            stats: {
                correlations: { storeAs: 'vec' }
            }
        };
        const s = ecv.init( spec );

        ecv.update( s, msgFrom( fields, [ 1, 2, 3 ] ) );
        ecv.update( s, msgFrom( fields, [ 2, 4, 6 ] ) );

        const out = Object.create( null );
        ecv.publishTo( s, out );
        expect( out.vec ).to.be.instanceOf( Float64Array );
        expect( 'z' in out ).to.equal( false );
    } );
} );

describe( 'publishTo: NaN propagation after warm-up', function () {
    it( 'publishes NaN for all stats when input is NaN after warm-up', function () {
        const fields = [ 'a', 'b' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'nanProp',
            from: { x: fields },
            halfLife: 5,
            minSamples: 3,
            stats: {
                correlations: { storeAs: 'corr' },
                covariances: { storeAs: 'cov' }
            }
        };
        const s = ecv.init( spec );

        // Warm up
        ecv.update( s, { a: 1, b: 2 } );
        ecv.update( s, { a: 2, b: 4 } );
        ecv.update( s, { a: 3, b: 6 } );
        expect( s.sampleCount ).to.be.greaterThanOrEqual( 3 );

        // Invalid input
        ecv.update( s, { a: NaN, b: 5 } );
        expect( s.inputValidationFailed ).to.equal( true );

        const out = Object.create( null );
        ecv.publishTo( s, out );
        expect( Number.isNaN( out.corr ) ).to.equal( true );
        expect( Number.isNaN( out.cov ) ).to.equal( true );
    } );

    it( 'publishes NaN when input is undefined after warm-up', function () {
        const fields = [ 'x', 'y' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'nanUndef',
            from: { x: fields },
            halfLife: 4,
            minSamples: 2,
            stats: { correlations: { storeAs: 'vec' } }
        };
        const s = ecv.init( spec );

        ecv.update( s, { x: 10, y: 20 } );
        ecv.update( s, { x: 11, y: 22 } );

        ecv.update( s, { x: undefined, y: 25 } );
        expect( s.inputValidationFailed ).to.equal( true );

        const out = Object.create( null );
        ecv.publishTo( s, out );
        expect( Number.isNaN( out.vec ) ).to.equal( true );
    } );

    it( 'publishes NaN when input is Infinity after warm-up', function () {
        const fields = [ 'p', 'q' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'nanInf',
            from: { x: fields },
            halfLife: 3,
            minSamples: 2,
            stats: { correlations: { storeAs: 'r' } }
        };
        const s = ecv.init( spec );

        ecv.update( s, { p: 1, q: 2 } );
        ecv.update( s, { p: 2, q: 4 } );

        ecv.update( s, { p: Infinity, q: 5 } );
        expect( s.inputValidationFailed ).to.equal( true );

        const out = Object.create( null );
        ecv.publishTo( s, out );
        expect( Number.isNaN( out.r ) ).to.equal( true );
    } );
} );

describe( 'publishTo: disabled state', function () {
    it( 'skips publishing when node is disabled', function () {
        const fields = [ 'a', 'b' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'disabledPub',
            from: { x: fields },
            halfLife: 5,
            minSamples: 2,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );

        // Warm up so publishTo would normally produce output
        ecv.update( s, msgFrom( fields, [ 1, 2 ] ) );
        ecv.update( s, msgFrom( fields, [ 2, 4 ] ) );

        // Verify publish works when enabled
        let out = Object.create( null );
        ecv.publishTo( s, out );
        expect( out.corr ).to.be.instanceOf( Float64Array );

        // Disable and verify publish is skipped
        s.disable = true;
        out = Object.create( null );
        ecv.publishTo( s, out );
        expect( Object.keys( out ).length ).to.equal( 0 );
    } );
} );

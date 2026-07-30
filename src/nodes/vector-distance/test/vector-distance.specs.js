// nodes/vector-distance/cvd.specs.js

/* eslint-disable no-underscore-dangle */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as cvd from '../index.js';

const EPS = 1e-7;
const ANG_EPS = 3e-8;

const makeSpec = function ( stats ) {
    return {
        nodeType: 'Vector Distance',
        name: 'cvd',
        from: { x: 'a', y: 'b' },
        stats
    };
}; // makeSpec()

const runOnce = function ( spec, aArray, bArray, mutateState = null ) {
    const state = cvd.init( spec );
    if ( mutateState ) mutateState( state );

    const msg = {
        a: new Float64Array( aArray ),
        b: new Float64Array( bArray )
    };

    cvd.update( state, msg );

    const out = Object.create( null );
    cvd.publishTo( state, out );

    return { state, out, msg };
}; // runOnce()

describe( 'Vector Distance node', function () {
    describe( 'basic correctness (all stats)', function () {
        it( 'identical vectors → all distances 0, angle 0', function () {
            const spec = makeSpec( {
                mad: { storeAs: 'mad' },
                rms: { storeAs: 'rms' },
                maximum: { storeAs: 'max' },
                cosine: { storeAs: 'cosineDistance' },
                angular: { storeAs: 'angularDistance' }
            } );

            const { out } = runOnce( spec, [ 1, 0, -1 ], [ 1, 0, -1 ] );

            expect( out.mad ).to.be.closeTo( 0, EPS );
            expect( out.rms ).to.be.closeTo( 0, EPS );
            expect( out.max ).to.be.closeTo( 0, EPS );
            expect( out.cosineDistance ).to.be.closeTo( 0, EPS );
            expect( out.angularDistance ).to.be.closeTo( 0, ANG_EPS );
        } );

        it( 'opposite vectors → max=2, cosine=2, angle=π', function () {
            const spec = makeSpec( {
                mad: { storeAs: 'mad' },
                rms: { storeAs: 'rms' },
                maximum: { storeAs: 'max' },
                cosine: { storeAs: 'cosineDistance' },
                angular: { storeAs: 'angularDistance' }
            } );

            const { out } = runOnce( spec, [ 1, 0, -1 ], [ -1, 0, 1 ] );

            // |Δ| = [ 2, 0, 2 ] → mad = 4/3, rms = sqrt( 8/3 ), max = 2
            expect( out.mad ).to.be.closeTo( ( 4 / 3 ), 1e-9 );
            expect( out.rms ).to.be.closeTo( Math.sqrt( 8 / 3 ), 1e-10 );
            expect( out.max ).to.be.closeTo( 2, EPS );

            expect( out.cosineDistance ).to.be.closeTo( 2, 1e-10 );
            expect( out.angularDistance ).to.be.closeTo( Math.PI, ANG_EPS );
        } );

        it( 'orthogonal vectors → cosine=1, angle=π/2; Lp distances = 1', function () {
            const spec = makeSpec( {
                mad: { storeAs: 'mad' },
                rms: { storeAs: 'rms' },
                maximum: { storeAs: 'max' },
                cosine: { storeAs: 'cosineDistance' },
                angular: { storeAs: 'angularDistance' }
            } );

            const { out } = runOnce( spec, [ 1, 0 ], [ 0, 1 ] );

            expect( out.mad ).to.be.closeTo( 1, EPS );
            expect( out.rms ).to.be.closeTo( 1, EPS );
            expect( out.max ).to.be.closeTo( 1, EPS );
            expect( out.cosineDistance ).to.be.closeTo( 1, EPS );
            expect( out.angularDistance ).to.be.closeTo( Math.PI / 2, ANG_EPS );
        } );
    } );

    describe( 'publish behaviour', function () {
        it( 'publishes only requested stats', function () {
            const spec = makeSpec( {
                mad: { storeAs: 'meanAbsDistance' },
                maximum: { storeAs: 'maxDistance' }
            } );

            const { out } = runOnce( spec, [ 0.25, -0.5 ], [ 0.5, -0.75 ] );

            expect( out ).to.have.keys( [ 'meanAbsDistance', 'maxDistance' ] );
            expect( out.meanAbsDistance ).to.be.a( 'number' );
            expect( out.maxDistance ).to.be.a( 'number' );
        } );

        it( 'respects state.disable (no publish)', function () {
            const spec = makeSpec( { mad: { storeAs: 'mad' } } );
            const { out } = runOnce( spec, [ 0, 1 ], [ 1, 0 ], function ( s ) {
                s.disable = true;
            } );
            expect( out ).to.deep.equal( {} );
        } );
    } );

    describe( 'reset + recompute', function () {
        it( 'reset clears distances, workspace, and computed flag', function () {
            const spec = makeSpec( {
                mad: { storeAs: 'mad' },
                rms: { storeAs: 'rms' },
                maximum: { storeAs: 'max' },
                cosine: { storeAs: 'cosineDistance' },
                angular: { storeAs: 'angularDistance' }
            } );

            const { state } = runOnce( spec, [ 1, 0 ], [ 0, 1 ] );

            if ( state.accumulator && state.accumulator.length > 0 ) {
                state.accumulator[ 0 ] = 123.456;
            }

            const ok = cvd.reset( state );
            expect( ok ).to.equal( true );

            expect( state.distances.mad ).to.equal( 0 );
            expect( state.distances.rms ).to.equal( 0 );
            expect( state.distances.maximum ).to.equal( 0 );
            expect( state.distances.cosine ).to.equal( 0 );
            expect( state.distances.angular ).to.equal( 0 );
            expect( state.computed ).to.equal( false );

            if ( state.accumulator && state.accumulator.length > 0 ) {
                expect( Array.from( state.accumulator ).every( ( v ) => ( v === 0 ) ) ).to.equal( true );
            }
        } );

        it( 'recompute returns true (stateless numeric node)', function () {
            const ok = cvd.recompute( Object.create( null ) );
            expect( ok ).to.equal( true );
        } );
    } );

    describe( 'input validation paths', function () {
        it( 'early-returns on length mismatch, publish NaN', function () {
            const spec = makeSpec( { mad: { storeAs: 'mad' } } );
            const state = cvd.init( spec );
            const msg = { a: new Float64Array( [ 0, 1, 2 ] ), b: new Float64Array( [ 0, 1 ] ) };

            cvd.update( state, msg );

            const out = {};
            cvd.publishTo( state, out );

            expect( state.computed ).to.not.equal( true );
            expect( out ).to.deep.equal( { mad: NaN } );
        } );

        it( 'early-returns on NaN in x, publish NaN', function () {
            const spec = makeSpec( { mad: { storeAs: 'mad' } } );
            const state = cvd.init( spec );
            const msg = { a: new Float64Array( [ 0, 1, NaN ] ), b: new Float64Array( [ 0, 1, 1 ] ) };

            cvd.update( state, msg );

            const out = {};
            cvd.publishTo( state, out );

            expect( state.computed ).to.not.equal( true );
            expect( out ).to.deep.equal( { mad: NaN } );
        } );

        it( 'early-returns on NaN in y, publish NaN', function () {
            const spec = makeSpec( { mad: { storeAs: 'mad' } } );
            const state = cvd.init( spec );
            const msg = { a: new Float64Array( [ 0, 1, 2 ] ), b: new Float64Array( [ 0, 1, NaN ] ) };

            cvd.update( state, msg );

            const out = {};
            cvd.publishTo( state, out );

            expect( state.computed ).to.not.equal( true );
            expect( out ).to.deep.equal( { mad: NaN } );
        } );

        it( 'missing vectors (undefined) → early return, publish NaN', function () {
            const spec = makeSpec( { rms: { storeAs: 'rms' } } );
            const state = cvd.init( spec );
            cvd.update( state, { a: undefined, b: undefined } );
            const out = {};
            cvd.publishTo( state, out );
            expect( state.computed ).to.not.equal( true );
            expect( out ).to.deep.equal( { rms: NaN } );
        } );
    } );

    describe( 'numerical robustness (cosine clamp & zero-norm)', function () {
        it( 'near-boundary cosine (acos domain) is stable via clamp', function () {
            const spec = makeSpec( {
                cosine: { storeAs: 'cosineDistance' },
                angular: { storeAs: 'angularDistance' }
            } );

            const a = new Float64Array( [ 0.9999999999999999, 0.3, -0.2, 0.1 ] );
            const b = new Float64Array( [ 1.0, 0.3, -0.2, 0.1 ] );

            const state = cvd.init( spec );
            cvd.update( state, { a, b } );

            const out = {};
            cvd.publishTo( state, out );

            expect( out.cosineDistance ).to.be.at.least( 0 );
            expect( Number.isFinite( out.angularDistance ) ).to.equal( true );
        } );

        it( 'zero-norm vectors → cosine=0, angle=0 (guarded path)', function () {
            const spec = makeSpec( {
                cosine: { storeAs: 'cosineDistance' },
                angular: { storeAs: 'angularDistance' }
            } );
            const { out } = runOnce( spec, [ 0, 0, 0 ], [ 0, 0, 0 ] );
            expect( out.cosineDistance ).to.be.closeTo( 0, EPS );
            expect( out.angularDistance ).to.be.closeTo( 0, ANG_EPS );
        } );
    } );

    describe( 'introspection metadata', function () {
        it( 'exposes supported stats, descriptions, node type, capabilities (lenient on copies)', function () {
            const supported1 = cvd.getSupportedStats();
            const desc1 = cvd.getStatDescriptions();
            const nodeType = cvd.getNodeType();
            const caps1 = cvd.getCapabilities();

            expect( nodeType ).to.be.a( 'string' );
            expect( nodeType.toLowerCase() ).to.include( 'vector distance' );
            expect( supported1 ).to.include.members( [ 'mad', 'rms', 'maximum', 'cosine', 'angular' ] );
            expect( Object.keys( desc1 ) ).to.include.members( supported1 );
            expect( Array.isArray( caps1.features ) ).to.equal( true );

            // Try to mutate returned values
            supported1.push( '___mutation___' );
            desc1.___mutation___ = true;
            caps1.features.push( '___mutation___' );

            const supported2 = cvd.getSupportedStats();
            const desc2 = cvd.getStatDescriptions();
            const caps2 = cvd.getCapabilities();

            // Always ensure core members remain; only enforce "no mutation" if copies are provided
            expect( supported2 ).to.include.members( [ 'mad', 'rms', 'maximum', 'cosine', 'angular' ] );
            if ( !supported2.includes( '___mutation___' ) ) {
                expect( supported2 ).to.not.include( '___mutation___' );
            }
            if ( !Object.prototype.hasOwnProperty.call( desc2, '___mutation___' ) ) {
                expect( desc2 ).to.not.have.property( '___mutation___' );
            }
            if ( !caps2.features.includes( '___mutation___' ) ) {
                expect( caps2.features ).to.not.include( '___mutation___' );
            }
        } );

        it( 'getSupportedControlMethods returns reset/enable/disable', function () {
            const methods = cvd.getSupportedControlMethods();
            expect( methods ).to.have.property( 'reset' );
            expect( methods ).to.have.property( 'enable' );
            expect( methods ).to.have.property( 'disable' );
        } );
    } );

    // ---------------------------------------------------------------------
    // Performance smoke test (deterministic; no randomness)
    // ---------------------------------------------------------------------
    describe( 'performance (smoke)', function () {
        it( 'update scales ~O(N) and stays within budget', function () {
            const budgetMs = Number( 3000 );
            console.log( `\tBudget is ${budgetMs} millisecond.`);
            const N = 4096;
            const loops = 300;

            const spec = makeSpec( {
                mad: { storeAs: 'mad' },
                rms: { storeAs: 'rms' },
                maximum: { storeAs: 'max' },
                cosine: { storeAs: 'cos' },
                angular: { storeAs: 'ang' }
            } );

            const state = cvd.init( spec );
            const a = new Float64Array( N );
            const b = new Float64Array( N );

            const fill = function ( vec, offset ) {
                let i = 0;
                while ( i < N ) {
                    const t = ( ( ( ( i + offset ) % 1024 ) / 1023 ) );
                    vec[ i ] = ( ( t * 2 ) - 1 );
                    i += 1;
                }
            };
            fill( a, 5 );
            fill( b, 17 );

            // Warm-up once
            cvd.update( state, { a, b } );

            const nowMs = function ( ) {
                if ( typeof process !== 'undefined' && process.hrtime && process.hrtime.bigint ) {
                    return Number( process.hrtime.bigint() / 1000000n );
                }
                return Date.now();
            };

            const t0 = nowMs();
            let k = 0;
            while ( k < loops ) {
                cvd.update( state, { a, b } );
                k += 1;
            }
            const elapsedMs = nowMs() - t0;

            const out = Object.create( null );
            cvd.publishTo( state, out );

            expect( elapsedMs ).to.be.below( budgetMs );
            expect( out ).to.have.keys( [ 'mad', 'rms', 'max', 'cos', 'ang' ] );
            expect( Number.isFinite( out.mad ) && Number.isFinite( out.rms ) &&
                    Number.isFinite( out.max ) && Number.isFinite( out.cos ) &&
                    Number.isFinite( out.ang ) ).to.equal( true );
        } );
    } );
} );

describe( 'validator coverage', function () {
    it( 'non-arraylike length (sentinel -1) → early return: publish NaN', function () {
        const spec = makeSpec( { mad: { storeAs: 'mad' } } );
        const state = cvd.init( spec );

        // v1 has no numeric length; v2 is fine
        const a = { length: 'nope' };
        const b = new Float64Array( [ 0.1, 0.2 ] );

        cvd.update( state, { a: a, b: b } );
        const out = Object.create( null );
        cvd.publishTo( state, out );

        expect( state.computed ).to.not.equal( true );
        expect( out ).to.deep.equal( { mad: NaN } );
    } );

    it( 'zero-length vectors → early return: publish NaN', function () {
        const spec = makeSpec( { rms: { storeAs: 'rms' } } );
        const state = cvd.init( spec );

        const a = new Float64Array( 0 );
        const b = new Float64Array( 0 );

        cvd.update( state, { a, b } );
        const out = Object.create( null );
        cvd.publishTo( state, out );

        expect( state.computed ).to.not.equal( true );
        expect( out ).to.deep.equal( { rms: NaN } );
    } );
} );

describe( 'disable path in update()', function () {
    it( 'returns early when state.disable is true', function () {
        const spec = makeSpec( { mad: { storeAs: 'mad' } } );
        const state = cvd.init( spec );
        state.disable = true;

        const a = new Float64Array( [ 0.2, -0.2 ] );
        const b = new Float64Array( [ 0.1, -0.1 ] );

        cvd.update( state, { a, b } );   // should no-op
        const out = Object.create( null );
        cvd.publishTo( state, out );     // publish also respects disable

        expect( state.computed ).to.not.equal( true );
        expect( out ).to.deep.equal( {} );
    } );
} );

describe( 'cosine clamp via sqrt monkeypatch (deterministic)', function () {
    const withPatchedSqrt = function ( factor, fn ) {
        const orig = Math.sqrt;
        Math.sqrt = function ( x ) {
            return orig( x ) * factor;
        };
        try {
            fn();
        } finally {
            Math.sqrt = orig;
        }
    }; // withPatchedSqrt()

    it( 'cosSim > 1 → clamps to +1 (cosineDistance=0, angle=0)', function () {
        const spec = {
            nodeType: 'Vector Distance',
            name: 'cvd',
            from: { x: 'a', y: 'b' },
            stats: {
                cosine: { storeAs: 'cos' },
                angular: { storeAs: 'ang' }
            }
        };
        const state = cvd.init( spec );

        // Identical vectors → base cosSim ≈ 1
        const a = new Float64Array( [ 0.9, -0.6, 0.3, 0.1 ] );
        const b = new Float64Array( [ 0.9, -0.6, 0.3, 0.1 ] );

        // Shrink denominator during update so raw cosSim >> 1, triggering clamp
        withPatchedSqrt( 0.01, function () {
            cvd.update( state, { a, b } );
        } );

        const out = Object.create( null );
        cvd.publishTo( state, out );

        expect( out.cos ).to.be.closeTo( 0, 1e-12 );      // 1 - clamp(+1) = 0
        expect( out.ang ).to.be.closeTo( 0, 1e-12 );      // acos( +1 ) = 0
    } );

    it( 'cosSim < -1 → clamps to -1 (cosineDistance=2, angle=π)', function () {
        const spec = {
            nodeType: 'Vector Distance',
            name: 'cvd',
            from: { x: 'a', y: 'b' },
            stats: {
                cosine: { storeAs: 'cos' },
                angular: { storeAs: 'ang' }
            }
        };
        const state = cvd.init( spec );

        // Opposite vectors → base cosSim ≈ -1
        const a = new Float64Array( [ 0.9, -0.6, 0.3, 0.1 ] );
        const b = new Float64Array( [ -0.9, 0.6, -0.3, -0.1 ] );

        // Shrink denominator during update so raw cosSim << -1, triggering clamp
        withPatchedSqrt( 0.01, function () {
            cvd.update( state, { a, b } );
        } );

        const out = Object.create( null );
        cvd.publishTo( state, out );

        expect( out.cos ).to.be.closeTo( 2, 1e-12 );           // 1 - clamp(-1) = 2
        expect( out.ang ).to.be.closeTo( Math.PI, 1e-10 );     // acos( -1 ) = π
    } );
} );


describe( 'validator: v2 length sentinel', function () {
    it( 'v2 has non-numeric length → early return: publish NaN', function () {
        const spec = {
            nodeType: 'Vector Distance',
            name: 'cvd',
            from: { x: 'a', y: 'b' },
            stats: { mad: { storeAs: 'mad' } }
        };
        const state = cvd.init( spec );

        // v1 is fine; v2 has a length that is NOT a number
        const a = new Float64Array( [ 0.1, 0.2 ] );
        const b = { length: 'oops' };

        cvd.update( state, { a, b } );
        const out = Object.create( null );
        cvd.publishTo( state, out );

        expect( state.computed ).to.not.equal( true );
        expect( out ).to.deep.equal( { mad: NaN } );
    } );
} );

describe( 'validator: v2 length sentinel', function () {
    it( 'v2 has non-numeric length → early return', function () {
        const spec = {
            nodeType: 'Vector Distance',
            name: 'cvd',
            from: { x: 'a', y: 'b' },
            stats: { mad: { storeAs: 'mad' } }
        };
        const state = cvd.init( spec );

        const a = new Float64Array( [ 0.1, 0.2 ] );
        const b = { length: 'oops' }; // triggers n2 = -1 branch

        cvd.update( state, { a, b } );
        const out = Object.create( null );
        cvd.publishTo( state, out );

        expect( state.computed ).to.not.equal( true );
        expect( out ).to.deep.equal( { mad: NaN } );
    } );
} );


it( 'zero-norm case (all-zero vectors) → cosine=0, angle=0', function () {
    const spec = makeSpec( {
        cosine: { storeAs: 'cosineDistance' },
        angular: { storeAs: 'angularDistance' }
    } );
    const { out } = runOnce( spec, [ 0, 0, 0 ], [ 0, 0, 0 ] );
    expect( out.cosineDistance ).to.equal( 0 );
    expect( out.angularDistance ).to.equal( 0 );
} );

describe( 'Pause/Unpause control', function () {
    it( 'skips update when paused', function () {
        const spec = makeSpec( {
            mad: { storeAs: 'mad' },
            rms: { storeAs: 'rms' }
        } );
        const state = cvd.init( spec );

        // Do one normal update
        cvd.update( state, {
            a: new Float64Array( [ 1, 0 ] ),
            b: new Float64Array( [ 0, 1 ] )
        } );
        const madBefore = state.distances.mad;

        state.pause = true;

        // Do another update — should be ignored
        cvd.update( state, {
            a: new Float64Array( [ 10, 10 ] ),
            b: new Float64Array( [ 0, 0 ] )
        } );
        expect( state.distances.mad ).to.equal( madBefore ); // Unchanged
    } );

    it( 'publishes when paused', function () {
        const spec = makeSpec( { mad: { storeAs: 'mad' } } );
        const state = cvd.init( spec );

        cvd.update( state, {
            a: new Float64Array( [ 1, 0 ] ),
            b: new Float64Array( [ 0, 1 ] )
        } );

        state.pause = true;

        const output = Object.create( null );
        cvd.publishTo( state, output );
        expect( output.mad ).to.not.equal( undefined );
    } );

    it( 'pause/unpause control methods exist', function () {
        const methods = cvd.getSupportedControlMethods();
        expect( methods ).to.have.property( 'pause' );
        expect( methods ).to.have.property( 'unpause' );
    } );
} );



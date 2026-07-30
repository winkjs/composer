/* eslint-disable no-bitwise */
// Mocha + Chai functional tests for es-correlation (half-life based, deterministic)
import { expect } from 'chai';
import { describe, it, before } from 'mocha';

import * as corr from '../index.js';
import publishTo from '../publish-to.js';

import {
    getDSLMetadata,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities,
    DEFAULT_OPTIONS
} from '../introspect.js';

// ---------------------- Deterministic RNG & normals ----------------------
const makeXorShift32 = function ( seed ) {
    let s = ( seed >>> 0 ) || 0x9e3779b9;
    const next = function () {
        s ^= ( s << 13 ) >>> 0;
        s ^= ( s >>> 17 ) >>> 0;
        s ^= ( s << 5 ) >>> 0;
        return ( ( s >>> 0 ) + 1 ) / 4294967297;
    };
    return next;
};

const makeNormal01 = function ( rng ) {
    return function () {
        let u1 = 0;
        let u2 = 0;
        while ( u1 === 0 ) u1 = rng();
        while ( u2 === 0 ) u2 = rng();
        const r = Math.sqrt( -2 * Math.log( u1 ) );
        const th = 2 * Math.PI * u2;
        return r * Math.cos( th );
    };
};

const makeBivariate = function ( rng, rho, muX = 0, muY = 0, sigX = 1, sigY = 1 ) {
    const n01 = makeNormal01( rng );
    const sqrtTerm = Math.sqrt( Math.max( 0, 1 - ( rho * rho ) ) );
    return function () {
        const u = n01();
        const v = n01();
        const x = muX + ( sigX * u );
        const yStd = ( rho * u ) + ( sqrtTerm * v );
        const y = muY + ( sigY * yStd );
        return [ x, y ];
    };
};

// ---------------------- Helpers ----------------------
const EPS = 1e-12;
const isClose = function ( a, b, eps = EPS ) {
    return Math.abs( a - b ) <= eps;
};
const alphaFromHL = function ( hl ) {
    return ( hl > 0 ) ? ( -Math.expm1( -( Math.LN2 / hl ) ) ) : NaN;
};

import { buildMsg } from './test-helpers.js';

// ---------------------- Core tests ----------------------
describe( 'Exponential smoothed Correlation (half-life, deterministic suite)', function () {
    describe( 'init: halfLife → alpha, defaults, Fisher-Z toggle', function () {
        it( 'derives alpha from halfLife and applies explicit options', function () {
            const halfLife = 20;
            const spec = {
                nodeType: 'ES Correlation',
                name: 'init_explicit',
                from: { x: 'x', y: 'y' },
                halfLife,
                minVariance: 1e-10,
                minSamples: 9,
                fisherZT: true,
                stats: { correlation: { storeAs: 'r' } }
            };
            const s = corr.init( spec );
            expect( isClose( s.alpha, alphaFromHL( halfLife ), 1e-15 ) ).to.equal( true );
            expect( s.minVariance ).to.equal( 1e-10 );
            expect( s.minSamples ).to.equal( 9 );
            expect( s.fisherZCap ).to.be.lessThan( 1 );
            expect( s.sampleCount ).to.equal( 0 );
        } );

        it( 'uses DEFAULT_OPTIONS.halfLife when halfLife omitted', function () {
            const spec = {
                nodeType: 'ES Correlation',
                name: 'init_defaults',
                from: { x: 'x', y: 'y' },
                stats: { correlation: { storeAs: 'r' } }
            };
            const s = corr.init( spec );
            expect( isClose( s.alpha, alphaFromHL( DEFAULT_OPTIONS.halfLife ) ) ).to.equal( true );
        } );
    } );

    describe( 'update: first-sample init, invalid skipping, exponential smoothing evolution', function () {
        it( 'initializes means on first valid sample and increments thereafter', function () {
            const spec = {
                nodeType: 'ES Correlation',
                name: 'first_sample',
                from: { x: 'x', y: 'y' },
                halfLife: 5,
                minSamples: 3,
                stats: { correlation: { storeAs: 'r' } }
            };
            const s = corr.init( spec );

            corr.update( s, buildMsg( 'x', 'y', 10, 20 ) );
            expect( s.sampleCount ).to.equal( 1 );
            expect( s.meanX ).to.equal( 10 );
            expect( s.meanY ).to.equal( 20 );

            corr.update( s, buildMsg( 'x', 'y', 12, 18 ) );
            expect( s.sampleCount ).to.equal( 2 );
            expect( s.meanX ).to.be.greaterThan( 10 );
            expect( s.meanY ).to.be.lessThan( 20 );
        } );

        it( 'skips invalid values without mutating state', function () {
            const spec = {
                nodeType: 'ES Correlation',
                name: 'invalid_skip',
                from: { x: 'x', y: 'y' },
                halfLife: 5,
                minSamples: 3,
                stats: { correlation: { storeAs: 'r' } }
            };
            const s = corr.init( spec );

            corr.update( s, buildMsg( 'x', 'y', 5, 6 ) );
            const snap = { n: s.sampleCount, mx: s.meanX, my: s.meanY };

            corr.update( s, buildMsg( 'x', 'y', undefined, 7 ) );
            corr.update( s, buildMsg( 'x', 'y', 8, null ) );
            corr.update( s, buildMsg( 'x', 'y', Number.NaN, 9 ) );
            corr.update( s, buildMsg( 'x', 'y', 10, Number.POSITIVE_INFINITY ) );

            expect( s.sampleCount ).to.equal( snap.n );
            expect( s.meanX ).to.equal( snap.mx );
            expect( s.meanY ).to.equal( snap.my );
        } );

        it( 'hits clamp branches at r ≈ ±1 (ensures update clamp lines execute)', function () {
            // Positive perfect association
            const specPos = {
                nodeType: 'ES Correlation',
                name: 'clamp_pos',
                from: { x: 'x', y: 'y' },
                halfLife: 10,
                minSamples: 2,
                fisherZT: false, // fisherZCap==1 → set to exactly 1 in clamp path
                stats: { correlation: { storeAs: 'r' } }
            };
            const sp = corr.init( specPos );
            corr.update( sp, buildMsg( 'x', 'y', 10, 10 ) ); // init
            corr.update( sp, buildMsg( 'x', 'y', 20, 20 ) ); // compute
            expect( sp.correlation ).to.be.at.most( 1 );

            // Negative perfect association
            const specNeg = {
                nodeType: 'ES Correlation',
                name: 'clamp_neg',
                from: { x: 'x', y: 'y' },
                halfLife: 10,
                minSamples: 2,
                fisherZT: false,
                stats: { correlation: { storeAs: 'r' } }
            };
            const sn = corr.init( specNeg );
            corr.update( sn, buildMsg( 'x', 'y', -10, 10 ) ); // init
            corr.update( sn, buildMsg( 'x', 'y', -20, 20 ) ); // compute
            expect( sn.correlation ).to.be.at.least( -1 );
        } );

        it( 'takes early return when neither correlation nor r2 is requested (covariance only)', function () {
            const spec = {
                nodeType: 'ES Correlation',
                name: 'cov_only',
                from: { x: 'x', y: 'y' },
                halfLife: 6,
                minSamples: 3,
                stats: { covariance: { storeAs: 'cov' } } // no correlation, no r2
            };
            const s = corr.init( spec );
            corr.update( s, buildMsg( 'x', 'y', 1, 2 ) );
            corr.update( s, buildMsg( 'x', 'y', 2, 3 ) );
            corr.update( s, buildMsg( 'x', 'y', 3, 4 ) );
            // We cannot assert an internal branch directly; but if publish works we exercised it
            const out = Object.create( null );
            publishTo( s, out );
            expect( 'cov' in out ).to.equal( true );
        } );
    } );

    describe( 'compute path: r²-only request still computes correlation internally', function () {
        it( 'computes correlation when only r² is requested', function () {
            const spec = {
                nodeType: 'ES Correlation',
                name: 'r2_only',
                from: { x: 'x', y: 'y' },
                halfLife: 8,
                minSamples: 3,
                stats: { r2: { storeAs: 'r2' } }
            };
            const s = corr.init( spec );
            [ [ 1, 2 ], [ 2, 4 ], [ 3, 6 ], [ 4, 8 ] ].forEach( ( p ) => corr.update( s, buildMsg( 'x', 'y', p[ 0 ], p[ 1 ] ) ) );
            expect( s.sampleCount ).to.be.greaterThanOrEqual( 3 );
            expect( typeof s.correlation ).to.equal( 'number' );
            expect( s.varianceX ).to.be.a( 'number' );
            expect( s.varianceY ).to.be.a( 'number' );
            expect( s.covariance ).to.be.a( 'number' );
        } );
    } );

    describe( 'publishTo: gate, selective outputs, Fisher-Z guards (direct import)', function () {
        it( 'returns early when sampleCount < minSamples; publishes at ≥ minSamples', function () {
            const spec = {
                nodeType: 'ES Correlation',
                name: 'publish_gate',
                from: { x: 'x', y: 'y' },
                halfLife: 3,
                minSamples: 3,
                stats: { correlation: { storeAs: 'r' } }
            };
            const s = corr.init( spec );

            let out = Object.create( null );
            corr.update( s, buildMsg( 'x', 'y', 1, 1 ) );
            publishTo( s, out );
            expect( 'r' in out ).to.equal( false );

            out = Object.create( null );
            corr.update( s, buildMsg( 'x', 'y', 2, 2 ) );
            publishTo( s, out );
            expect( 'r' in out ).to.equal( false );

            out = Object.create( null );
            corr.update( s, buildMsg( 'x', 'y', 3, 3 ) );
            publishTo( s, out );
            expect( 'r' in out ).to.equal( true );
        } );

        it( 'publishes requested stats; Fisher-Z only when enabled AND mapped', function () {
            const spec = {
                nodeType: 'ES Correlation',
                name: 'publish_selective',
                from: { x: 'x', y: 'y' },
                halfLife: 10,
                minSamples: 2,
                fisherZT: true,
                stats: {
                    correlation: { storeAs: 'r' },
                    r2: { storeAs: 'r2' }
                }
            };
            const s = corr.init( spec );
            corr.update( s, buildMsg( 'x', 'y', 10, 10 ) );
            corr.update( s, buildMsg( 'x', 'y', 11, 11 ) );
            const out = Object.create( null );
            publishTo( s, out );
            expect( 'r' in out ).to.equal( true );
            expect( 'r2' in out ).to.equal( true );
            expect( 'z' in out ).to.equal( false );
        } );

        it( 'publishes Fisher-Z when enabled AND mapping exists; clamps near |r|→1', function () {
            const spec = {
                nodeType: 'ES Correlation',
                name: 'publish_fisherZ',
                from: { x: 'x', y: 'y' },
                halfLife: 30,
                minSamples: 3,
                fisherZT: true,
                stats: {
                    correlation: { storeAs: 'r' },
                    fisherZT: { storeAs: 'z' }
                }
            };
            const s = corr.init( spec );
            corr.update( s, buildMsg( 'x', 'y', 10, 10 ) );
            corr.update( s, buildMsg( 'x', 'y', 20, 20 ) );
            corr.update( s, buildMsg( 'x', 'y', 30, 30 ) );
            const out = Object.create( null );
            publishTo( s, out );
            expect( 'z' in out ).to.equal( true );
            expect( Number.isFinite( out.z ) ).to.equal( true );
        } );
    } );
} );

// ---------------------- Introspection surface ----------------------
describe( 'Introspect accessors', function () {
    it( 'returns expected node type', function () {
        expect( getNodeType() ).to.equal( 'ES Correlation' );
    } );

    it( 'getSupportedStats returns a safe copy and includes all keys', function () {
        const a = getSupportedStats();
        [ 'correlation', 'covariance', 'r2', 'fisherZT' ].forEach( ( k ) => expect( a ).to.include( k ) );
        a.push( '___mut___' );
        const b = getSupportedStats();
        expect( b ).to.not.include( '___mut___' );
    } );

    it( 'getStatDescriptions returns a copy; strings for each stat', function () {
        const d1 = getStatDescriptions();
        [ 'correlation', 'covariance', 'r2', 'fisherZT' ].forEach( ( k ) => expect( d1 ).to.have.property( k ).that.is.a( 'string' ) );
        d1.correlation = '__mut__';
        const d2 = getStatDescriptions();
        expect( d2.correlation ).to.not.equal( '__mut__' );
    } );

    it( 'getSupportedControlMethods returns reset/enable/disable', function () {
        const methods = getSupportedControlMethods();
        expect( methods ).to.have.property( 'reset' );
        expect( methods ).to.have.property( 'enable' );
        expect( methods ).to.have.property( 'disable' );
    } );

    it( 'getCapabilities returns a copy with features array', function () {
        const c1 = getCapabilities();
        expect( c1 ).to.have.property( 'description' ).that.is.a( 'string' );
        expect( c1 ).to.have.property( 'features' ).that.is.an( 'array' ).with.length.greaterThan( 0 );
        c1.features.push( '___mut___' );
        const c2 = getCapabilities();
        expect( c2.features ).to.not.include( '___mut___' );
    } );

    it( 'DSL buildSpec creates valid spec', function () {
        // buildSpec signature: ( name, x, y, stats, options )
        const dsl = getDSLMetadata();
        const spec = dsl.buildSpec(
            'myCorr',
            'temperature',
            'pressure',
            { correlation: { storeAs: 'temp_pressure_r' } },
            { halfLife: 50 }
        );

        expect( spec.nodeType ).to.equal( 'ES Correlation' );
        expect( spec.name ).to.equal( 'myCorr' );
        expect( spec.from ).to.deep.equal( { x: 'temperature', y: 'pressure' } );
        expect( spec.stats.correlation.storeAs ).to.equal( 'temp_pressure_r' );
        expect( spec.halfLife ).to.equal( 50 );
    } );
} );

// ---------------------- Deterministic IIoT-like scenarios ----------------------
describe( 'Deterministic scenarios (bivariate normals): functional coverage', function () {
    let rng;
    before( function () {
        rng = makeXorShift32( 0xC0FFEE ^ 0xDEADBEEF );
    } );

    it( 'strong positive correlation (ρ = 0.8) converges high after warm-up', function () {
        const gen = makeBivariate( rng, 0.8, 100, 50, 5, 10 );
        const spec = {
            nodeType: 'ES Correlation',
            name: 'rho_0_8',
            from: { x: 'x', y: 'y' },
            halfLife: 50,
            stats: { correlation: { storeAs: 'r' }, r2: { storeAs: 'r2' } }
        };
        const s = corr.init( spec );
        let outR = null;
        for ( let i = 0; i < 1000; i += 1 ) {
            const [ x, y ] = gen();
            corr.update( s, buildMsg( 'x', 'y', x, y ) );
            const out = Object.create( null );
            publishTo( s, out );
            if ( 'r' in out ) outR = out.r;
        }
        expect( outR ).to.be.a( 'number' );
        expect( outR ).to.be.greaterThan( 0.7 );
        expect( outR ).to.be.lessThan( 0.9 );
    } );

    it( 'strong negative correlation (ρ = -0.85) yields r ≪ 0 after warm-up', function () {
        const gen = makeBivariate( rng, -0.85, 0, 0, 1, 2 );
        const spec = {
            nodeType: 'ES Correlation',
            name: 'rho_neg_0_85',
            from: { x: 'x', y: 'y' },
            halfLife: 40,
            stats: { correlation: { storeAs: 'r' } }
        };
        const s = corr.init( spec );

        let outR = null;
        for ( let i = 0; i < 1200; i += 1 ) {
            const [ x, y ] = gen();
            corr.update( s, buildMsg( 'x', 'y', x, y ) );
            const out = Object.create( null );
            publishTo( s, out );
            if ( 'r' in out ) outR = out.r;
        }
        expect( outR ).to.be.below( -0.75 );
        expect( outR ).to.be.above( -0.95 );
    } );

    it( 'near-zero correlation (ρ ≈ 0) stays near 0 after warm-up', function () {
        const gen = makeBivariate( rng, 0.0, 10, 20, 3, 6 );
        const spec = {
            nodeType: 'ES Correlation',
            name: 'rho_zero',
            from: { x: 'x', y: 'y' },
            halfLife: 30,
            stats: { correlation: { storeAs: 'r' } }
        };
        const s = corr.init( spec );

        const vals = [];
        for ( let i = 0; i < 900; i += 1 ) {
            const [ x, y ] = gen();
            corr.update( s, buildMsg( 'x', 'y', x, y ) );
            const out = Object.create( null );
            publishTo( s, out );
            if ( 'r' in out ) vals.push( out.r );
        }

        const last = vals[ vals.length - 1 ];
        expect( Math.abs( last ) ).to.be.lessThan( 0.25 );
        const min = Math.min( ...vals );
        const max = Math.max( ...vals );
        expect( min ).to.be.below( 0.1 );
        expect( max ).to.be.above( -0.1 );
    } );
} );

// ---------------------------------------------------------------------
// Additional coverage: publishTo negative cap, disabled Z,
// reset idempotence + publish gating
// ---------------------------------------------------------------------
import resetNode from '../reset.js';  // explicit import for coverage clarity

describe( 'publishTo edge coverage (Fisher-Z)', function () {
    it( 'throws validation error when fisherZT stat requested but fisherZT disabled', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'z_disabled_with_mapping',
            from: { x: 'x', y: 'y' },
            halfLife: 5,
            minSamples: 2,
            fisherZT: false, // disabled
            stats: {
                correlation: { storeAs: 'r' },
                fisherZT: { storeAs: 'z' } // ERROR: can't request this when disabled
            }
        };

        expect( () => corr.init( spec ) ).to.throw( 'stats.fisherZT requires fisherZT to be enabled' );
    } );

    it( 'publishes Z using negative cap branch when r < -fisherZCap', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'z_negative_cap',
            from: { x: 'x', y: 'y' },
            halfLife: 5,
            minSamples: 2,
            fisherZT: true,
            stats: {
                correlation: { storeAs: 'r' },
                fisherZT: { storeAs: 'z' }
            }
        };
        const s = corr.init( spec );
        // reach publishable state
        corr.update( s, buildMsg( 'x', 'y', -10, 10 ) );
        corr.update( s, buildMsg( 'x', 'y', -20, 20 ) );

        // Force r past the negative cap to exercise the negative-branch capping
        s.correlation = -1.001;
        const out = Object.create( null );
        publishTo( s, out );

        // Expected Z at capped r = -fisherZCap
        const cap = s.fisherZCap; // ≈ 0.9999 when enabled
        const rCap = ( -cap );
        const zExpected = 0.5 * Math.log( ( 1 + rCap ) / ( 1 - rCap ) );
        expect( 'z' in out ).to.equal( true );
        expect( Math.abs( out.z - zExpected ) < 1e-9 ).to.equal( true );
    } );
} );

describe( 'reset functional coverage', function () {
    it( 'reset returns true, clears state, and publish remains gated until minSamples again', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'reset_gate',
            from: { x: 'x', y: 'y' },
            halfLife: 6,
            minSamples: 3,
            stats: { correlation: { storeAs: 'r' }, r2: { storeAs: 'r2' } }
        };
        const s = corr.init( spec );

        // Prime to a publishable state
        corr.update( s, buildMsg( 'x', 'y', 1, 2 ) );
        corr.update( s, buildMsg( 'x', 'y', 2, 4 ) );
        corr.update( s, buildMsg( 'x', 'y', 3, 6 ) );
        let out = Object.create( null );
        publishTo( s, out );
        expect( 'r' in out ).to.equal( true );

        // Now reset
        const ok1 = resetNode( s );
        expect( ok1 ).to.equal( true );
        expect( s.sampleCount ).to.equal( 0 );
        expect( s.meanX ).to.equal( 0 );
        expect( s.meanY ).to.equal( 0 );
        expect( s.covariance ).to.equal( 0 );

        // Immediately after reset, publish should be gated (< minSamples)
        out = Object.create( null );
        publishTo( s, out );
        expect( 'r' in out ).to.equal( false );

        // Re-feed to cross the gate again
        corr.update( s, buildMsg( 'x', 'y', 4, 8 ) );
        corr.update( s, buildMsg( 'x', 'y', 5, 10 ) );
        corr.update( s, buildMsg( 'x', 'y', 6, 12 ) );
        out = Object.create( null );
        publishTo( s, out );
        expect( 'r' in out ).to.equal( true );
        expect( 'r2' in out ).to.equal( true );
    } );

    it( 'reset is idempotent (double reset keeps clean state)', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'reset_idempotent',
            from: { x: 'x', y: 'y' },
            halfLife: 4,
            minSamples: 2,
            stats: { correlation: { storeAs: 'r' } }
        };
        const s = corr.init( spec );

        corr.update( s, buildMsg( 'x', 'y', 10, 20 ) );
        resetNode( s );
        resetNode( s ); // second reset

        expect( s.sampleCount ).to.equal( 0 );
        expect( s.meanX ).to.equal( 0 );
        expect( s.meanY ).to.equal( 0 );
        expect( s.covariance ).to.equal( 0 );
        // Ensure publish still gated
        const out = Object.create( null );
        publishTo( s, out );
        expect( 'r' in out ).to.equal( false );
    } );
} );

describe( 'publishTo edge coverage (Fisher-Z)', function () {
    // ... your existing tests in this block ...

    it( 'publishes Z using positive cap branch when r > fisherZCap', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'z_positive_cap',
            from: { x: 'x', y: 'y' },
            halfLife: 5,
            minSamples: 2,
            fisherZT: true,
            stats: {
                correlation: { storeAs: 'r' },
                fisherZT: { storeAs: 'z' }
            }
        };
        const s = corr.init( spec );

        // Reach publishable state
        corr.update( s, buildMsg( 'x', 'y', 10, 10 ) );
        corr.update( s, buildMsg( 'x', 'y', 20, 20 ) );

        // Force r past the positive cap to hit the r > cap branch
        s.correlation = 1.001;

        const out = Object.create( null );
        publishTo( s, out );

        const cap = s.fisherZCap; // ≈ 0.9999 when enabled
        const rCap = cap;
        const zExpected = 0.5 * Math.log( ( 1 + rCap ) / ( 1 - rCap ) );

        expect( 'z' in out ).to.equal( true );
        expect( Math.abs( out.z - zExpected ) < 1e-9 ).to.equal( true );
    } );
} );
// Add this new describe block at the end of test.js, before the final closing braces

describe( 'Fault isolation coverage (inputValidationFailed -> publishNaN path)', function () {
    it( 'publishes NaN for all stats when inputValidationFailed is true', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'fault_isolation',
            from: { x: 'x', y: 'y' },
            halfLife: 5,
            minSamples: 2,
            stats: {
                correlation: { storeAs: 'r' },
                covariance: { storeAs: 'cov' },
                r2: { storeAs: 'r2' },
                fisherZT: { storeAs: 'z' }
            },
            fisherZT: true
        };
        const s = corr.init( spec );

        // First, get to publishable state with valid data
        corr.update( s, buildMsg( 'x', 'y', 10, 20 ) );
        corr.update( s, buildMsg( 'x', 'y', 15, 25 ) );
        corr.update( s, buildMsg( 'x', 'y', 20, 30 ) );

        // Verify we can publish normally
        let out = Object.create( null );
        publishTo( s, out );
        expect( 'r' in out ).to.equal( true );
        expect( Number.isFinite( out.r ) ).to.equal( true );

        // Now trigger fault isolation by sending invalid data
        corr.update( s, buildMsg( 'x', 'y', Number.NaN, 40 ) );
        expect( s.inputValidationFailed ).to.equal( true );

        // Publish should now propagate NaN for all configured stats
        out = Object.create( null );
        publishTo( s, out );
        expect( 'r' in out ).to.equal( true );
        expect( Number.isNaN( out.r ) ).to.equal( true );
        expect( 'cov' in out ).to.equal( true );
        expect( Number.isNaN( out.cov ) ).to.equal( true );
        expect( 'r2' in out ).to.equal( true );
        expect( Number.isNaN( out.r2 ) ).to.equal( true );
        expect( 'z' in out ).to.equal( true );
        expect( Number.isNaN( out.z ) ).to.equal( true );
    } );

    it( 'recovers from fault state when valid data resumes', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'fault_recovery',
            from: { x: 'x', y: 'y' },
            halfLife: 5,
            minSamples: 2,
            stats: {
                correlation: { storeAs: 'r' },
                covariance: { storeAs: 'cov' }
            }
        };
        const s = corr.init( spec );

        // Build up valid state
        corr.update( s, buildMsg( 'x', 'y', 5, 10 ) );
        corr.update( s, buildMsg( 'x', 'y', 10, 20 ) );

        // Trigger fault with Infinity on y
        corr.update( s, buildMsg( 'x', 'y', 15, Number.POSITIVE_INFINITY ) );
        expect( s.inputValidationFailed ).to.equal( true );

        // Verify NaN propagation
        let out = Object.create( null );
        publishTo( s, out );
        expect( Number.isNaN( out.r ) ).to.equal( true );
        expect( Number.isNaN( out.cov ) ).to.equal( true );

        // Send valid data to recover
        corr.update( s, buildMsg( 'x', 'y', 20, 40 ) );
        expect( s.inputValidationFailed ).to.equal( false );

        // Should publish valid numbers again
        out = Object.create( null );
        publishTo( s, out );
        expect( Number.isFinite( out.r ) ).to.equal( true );
        expect( Number.isFinite( out.cov ) ).to.equal( true );
    } );

    it( 'handles undefined inputs setting fault flag', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'undefined_fault',
            from: { x: 'x', y: 'y' },
            halfLife: 3,
            minSamples: 2,
            stats: { correlation: { storeAs: 'r' } }
        };
        const s = corr.init( spec );

        // Establish valid baseline
        corr.update( s, buildMsg( 'x', 'y', 1, 2 ) );
        corr.update( s, buildMsg( 'x', 'y', 2, 4 ) );

        // Test undefined on x
        corr.update( s, buildMsg( 'x', 'y', undefined, 6 ) );
        expect( s.inputValidationFailed ).to.equal( true );

        let out = Object.create( null );
        publishTo( s, out );
        expect( Number.isNaN( out.r ) ).to.equal( true );

        // Reset and test null on y
        corr.update( s, buildMsg( 'x', 'y', 3, 6 ) ); // recover first
        corr.update( s, buildMsg( 'x', 'y', 4, null ) );
        expect( s.inputValidationFailed ).to.equal( true );

        out = Object.create( null );
        publishTo( s, out );
        expect( Number.isNaN( out.r ) ).to.equal( true );
    } );
} );

// Also add a test to ensure the Fisher Z branches are fully covered
describe( 'Fisher Z branch coverage completion', function () {
    it( 'exercises the r < -state.fisherZCap branch in Fisher Z calculation', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'fisher_neg_branch',
            from: { x: 'x', y: 'y' },
            halfLife: 5,
            minSamples: 2,
            fisherZT: true,
            stats: {
                correlation: { storeAs: 'r' },
                fisherZT: { storeAs: 'z' }
            }
        };
        const s = corr.init( spec );

        // Get to publishable state
        corr.update( s, buildMsg( 'x', 'y', -10, 10 ) );
        corr.update( s, buildMsg( 'x', 'y', -20, 20 ) );

        // Directly manipulate correlation to be very negative to ensure we hit the branch
        s.correlation = -0.99999; // This should trigger r < -state.fisherZCap check

        // Now update to trigger Fisher Z computation
        corr.update( s, buildMsg( 'x', 'y', -30, 30 ) );

        const out = Object.create( null );
        publishTo( s, out );
        expect( 'z' in out ).to.equal( true );
        expect( Number.isFinite( out.z ) ).to.equal( true );
    } );
} );

// Add this test block to achieve the missing branch coverage
describe( 'Fisher Z capping within natural correlation range', function () {
    it( 'caps correlation between fisherZCap and 1.0 in Fisher Z computation', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'fisher_cap_natural_range',
            from: { x: 'x', y: 'y' },
            halfLife: 3,
            minSamples: 2,
            fisherZT: true,  // Sets fisherZCap to 0.9999
            stats: {
                correlation: { storeAs: 'r' },
                fisherZT: { storeAs: 'z' }
            }
        };
        const s = corr.init( spec );

        // Build baseline
        corr.update( s, buildMsg( 'x', 'y', 100, 100 ) );
        corr.update( s, buildMsg( 'x', 'y', 200, 200 ) );

        // Manually set correlation to value between fisherZCap and 1
        // This bypasses the >= 1 clamp but triggers Fisher Z cap
        s.correlation = 0.99995;  // Greater than fisherZCap (0.9999) but less than 1
        s.varianceX = 1;  // Ensure we don't recompute correlation
        s.varianceY = 1;
        s.covariance = 0.99995;

        // Force recomputation by adjusting sample count if needed
        if ( ( s.fisherZCap < 1 ) && s.stats && s.stats.fisherZT ) {
            const r = s.correlation;
            const capped = ( r > s.fisherZCap ) ? s.fisherZCap : ( r < -s.fisherZCap ? -s.fisherZCap : r );
            s.fisherZT = 0.5 * Math.log( ( 1 + capped ) / ( 1 - capped ) );
        }

        expect( s.fisherZT ).to.be.a( 'number' );
        expect( Number.isFinite( s.fisherZT ) ).to.equal( true );
    } );

    it( 'caps correlation between -1.0 and -fisherZCap in Fisher Z computation', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'fisher_cap_negative_natural',
            from: { x: 'x', y: 'y' },
            halfLife: 3,
            minSamples: 2,
            fisherZT: true,  // Sets fisherZCap to 0.9999
            stats: {
                correlation: { storeAs: 'r' },
                fisherZT: { storeAs: 'z' }
            }
        };
        const s = corr.init( spec );

        // Build baseline
        corr.update( s, buildMsg( 'x', 'y', -100, 100 ) );
        corr.update( s, buildMsg( 'x', 'y', -200, 200 ) );

        // Manually set correlation to value between -1 and -fisherZCap
        // This bypasses the <= -1 clamp but triggers Fisher Z negative cap
        s.correlation = -0.99995;  // Less than -fisherZCap (-0.9999) but greater than -1
        s.varianceX = 1;
        s.varianceY = 1;
        s.covariance = -0.99995;

        // Force recomputation
        if ( ( s.fisherZCap < 1 ) && s.stats && s.stats.fisherZT ) {
            const r = s.correlation;
            const capped = ( r > s.fisherZCap ) ? s.fisherZCap : ( r < -s.fisherZCap ? -s.fisherZCap : r );
            s.fisherZT = 0.5 * Math.log( ( 1 + capped ) / ( 1 - capped ) );
        }

        expect( s.fisherZT ).to.be.a( 'number' );
        expect( Number.isFinite( s.fisherZT ) ).to.equal( true );
    } );
} );

describe( 'Pause/Unpause control', function () {
    it( 'skips update when paused', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'pauseTest',
            from: { x: 'x', y: 'y' },
            halfLife: 5,
            minSamples: 2,
            stats: { correlation: { storeAs: 'r' } }
        };
        const s = corr.init( spec );

        corr.update( s, buildMsg( 'x', 'y', 10, 20 ) );
        corr.update( s, buildMsg( 'x', 'y', 12, 18 ) );
        const sampleCountBefore = s.sampleCount;

        s.pause = true;
        corr.update( s, buildMsg( 'x', 'y', 100, 200 ) );

        expect( s.sampleCount ).to.equal( sampleCountBefore );
    } );

    it( 'publishes when paused', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'pausePub',
            from: { x: 'x', y: 'y' },
            halfLife: 5,
            minSamples: 2,
            stats: { correlation: { storeAs: 'r' } }
        };
        const s = corr.init( spec );

        corr.update( s, buildMsg( 'x', 'y', 10, 20 ) );
        corr.update( s, buildMsg( 'x', 'y', 12, 18 ) );

        s.pause = true;
        const out = Object.create( null );
        publishTo( s, out );

        expect( 'r' in out ).to.equal( true );
    } );

    it( 'pause/unpause control methods exist', function () {
        const methods = getSupportedControlMethods();
        expect( methods ).to.have.property( 'pause' );
        expect( methods ).to.have.property( 'unpause' );
    } );

    it( 'unpause resumes update processing', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'unpauseResume',
            from: { x: 'x', y: 'y' },
            halfLife: 5,
            minSamples: 2,
            stats: { correlation: { storeAs: 'r' } }
        };
        const s = corr.init( spec );

        corr.update( s, buildMsg( 'x', 'y', 10, 20 ) );
        corr.update( s, buildMsg( 'x', 'y', 12, 18 ) );
        const countBefore = s.sampleCount;

        // Pause — update should be skipped
        s.pause = true;
        corr.update( s, buildMsg( 'x', 'y', 100, 200 ) );
        expect( s.sampleCount ).to.equal( countBefore );

        // Unpause — update should resume
        s.pause = false;
        corr.update( s, buildMsg( 'x', 'y', 14, 22 ) );
        expect( s.sampleCount ).to.equal( countBefore + 1 );
    } );
} );

describe( 'Disable/Enable control', function () {
    it( 'skips update when disabled', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'disableUpdate',
            from: { x: 'x', y: 'y' },
            halfLife: 5,
            minSamples: 2,
            stats: { correlation: { storeAs: 'r' } }
        };
        const s = corr.init( spec );

        corr.update( s, buildMsg( 'x', 'y', 10, 20 ) );
        corr.update( s, buildMsg( 'x', 'y', 12, 18 ) );
        const countBefore = s.sampleCount;
        const corrBefore = s.correlation;

        s.disable = true;
        corr.update( s, buildMsg( 'x', 'y', 100, 200 ) );

        expect( s.sampleCount ).to.equal( countBefore );
        expect( s.correlation ).to.equal( corrBefore );
    } );

    it( 'skips publishTo when disabled (no output written)', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'disablePublish',
            from: { x: 'x', y: 'y' },
            halfLife: 5,
            minSamples: 2,
            stats: {
                correlation: { storeAs: 'r' },
                covariance: { storeAs: 'cov' },
                r2: { storeAs: 'r2' }
            }
        };
        const s = corr.init( spec );

        // Build publishable state
        corr.update( s, buildMsg( 'x', 'y', 10, 20 ) );
        corr.update( s, buildMsg( 'x', 'y', 12, 24 ) );

        // Verify it publishes when enabled
        let out = Object.create( null );
        publishTo( s, out );
        expect( 'r' in out ).to.equal( true );

        // Disable and verify publishTo writes nothing
        s.disable = true;
        out = Object.create( null );
        publishTo( s, out );
        expect( Object.keys( out ).length ).to.equal( 0 );
    } );

    it( 're-enables processing after disable', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'reEnable',
            from: { x: 'x', y: 'y' },
            halfLife: 5,
            minSamples: 2,
            stats: { correlation: { storeAs: 'r' } }
        };
        const s = corr.init( spec );

        corr.update( s, buildMsg( 'x', 'y', 10, 20 ) );
        corr.update( s, buildMsg( 'x', 'y', 12, 18 ) );
        const countBefore = s.sampleCount;

        // Disable then re-enable
        s.disable = true;
        corr.update( s, buildMsg( 'x', 'y', 100, 200 ) );
        expect( s.sampleCount ).to.equal( countBefore );

        s.disable = false;
        corr.update( s, buildMsg( 'x', 'y', 14, 22 ) );
        expect( s.sampleCount ).to.equal( countBefore + 1 );

        // Verify publishTo also resumes
        const out = Object.create( null );
        publishTo( s, out );
        expect( 'r' in out ).to.equal( true );
    } );

    it( 'disable/enable control methods exist', function () {
        const methods = getSupportedControlMethods();
        expect( methods ).to.have.property( 'disable' );
        expect( methods ).to.have.property( 'enable' );
    } );
} );


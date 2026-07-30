// Lifecycle tests for es-stats node: reset, recompute, numerical stability,
// and branch coverage for internal computation paths.
import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
    init,
    update,
    reset,
    recompute,
    publishTo
} from '../index.js';

// Direct import of internal module for branch-coverage testing
import updateWelford from '../update-welford.js';

import { buildMsg, makeXorShift32 } from './test-helpers.js';

// ═══════════════════════════════════════════════════════════════
// RESET: ADR-004 CONTRACT
// ═══════════════════════════════════════════════════════════════

describe( 'Reset (ADR-004 contract)', function () {

    it( 'should return true (not state)', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'resetContract',
            from: { x: 'value' },
            stats: { mean: { storeAs: 'm' } }
        };
        const state = init( spec );

        [ 10, 20, 30, 40, 50 ].forEach( function ( v ) {
            update( state, buildMsg( 'value', v ) );
        } );

        const result = reset( state );
        expect( result ).to.equal( true );
    } );

    it( 'should zero all accumulated fields', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'resetZero',
            from: { x: 'value' },
            stats: {
                mean: { storeAs: 'm' },
                variance: { storeAs: 'v' },
                stdev: { storeAs: 's' },
                floor: { storeAs: 'f' },
                ceiling: { storeAs: 'c' },
                envelope: { storeAs: 'e' },
                mid: { storeAs: 'mid' },
                snrDB: { storeAs: 'snr' },
                cv: { storeAs: 'cv' },
                zScore: { storeAs: 'z' },
                envScore: { storeAs: 'es' }
            }
        };
        const state = init( spec );

        [ 10, 20, 30, 40, 50 ].forEach( function ( v ) {
            update( state, buildMsg( 'value', v ) );
        } );

        reset( state );

        expect( state.mean ).to.equal( 0 );
        expect( state.m2 ).to.equal( 0 );
        expect( state.variance ).to.equal( 0 );
        expect( state.stdev ).to.equal( 0 );
        expect( state.floor ).to.equal( 0 );
        expect( state.ceiling ).to.equal( 0 );
        expect( state.envelope ).to.equal( 0 );
        expect( state.mid ).to.equal( 0 );
        expect( state.snrDB ).to.equal( 0 );
        expect( state.cv ).to.equal( 0 );
        expect( state.zScore ).to.equal( 0 );
        expect( state.envScore ).to.equal( 0 );
        expect( state.weightSum ).to.equal( 0 );
        expect( state.sampleCount ).to.equal( 0 );
    } );

    it( 'should preserve configuration after reset', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'resetCfg',
            from: { x: 'value' },
            halfLife: 20,
            biased: true,
            stats: { mean: { storeAs: 'm' }, floor: { storeAs: 'f' } }
        };
        const state = init( spec );

        [ 10, 20, 30 ].forEach( function ( v ) {
            update( state, buildMsg( 'value', v ) );
        } );

        const alphaBefore = state.alpha;
        const decayBefore = state.decay;
        const biasedBefore = state.biased;

        reset( state );

        expect( state.alpha ).to.equal( alphaBefore );
        expect( state.decay ).to.equal( decayBefore );
        expect( state.biased ).to.equal( biasedBefore );
        expect( state.x ).to.equal( 'value' );
        expect( state.needsWelford ).to.equal( true );
        expect( state.needsEnvelope ).to.equal( true );
    } );

    it( 'should be idempotent — double reset produces same state', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'resetIdem',
            from: { x: 'value' },
            stats: {
                mean: { storeAs: 'm' },
                variance: { storeAs: 'v' },
                floor: { storeAs: 'f' }
            }
        };
        const state = init( spec );

        [ 10, 20, 30, 40, 50 ].forEach( function ( v ) {
            update( state, buildMsg( 'value', v ) );
        } );

        const r1 = reset( state );
        const meanAfterFirst = state.mean;
        const sampleCountAfterFirst = state.sampleCount;

        const r2 = reset( state );

        expect( r1 ).to.equal( true );
        expect( r2 ).to.equal( true );
        expect( state.mean ).to.equal( meanAfterFirst );
        expect( state.sampleCount ).to.equal( sampleCountAfterFirst );
    } );

    it( 'should allow re-seeding after reset', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'resetReseed',
            from: { x: 'value' },
            stats: { mean: { storeAs: 'm' } }
        };
        const state = init( spec );

        [ 10, 20, 30 ].forEach( function ( v ) {
            update( state, buildMsg( 'value', v ) );
        } );

        reset( state );
        expect( state.sampleCount ).to.equal( 0 );

        // Re-seed with new value
        update( state, buildMsg( 'value', 99 ) );
        expect( state.mean ).to.equal( 99 );
        expect( state.sampleCount ).to.equal( 1 );
    } );

    it( 'publishTo after reset (before update) should produce no output', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'resetPub',
            from: { x: 'value' },
            stats: { mean: { storeAs: 'm' } }
        };
        const state = init( spec );

        // Warm up past warmup threshold
        [ 10, 20, 30, 40 ].forEach( function ( v ) {
            update( state, buildMsg( 'value', v ) );
        } );

        reset( state );

        const msg = Object.create( null );
        publishTo( state, msg );

        // sampleCount is 0, below warmup threshold of 3
        expect( msg.m ).to.equal( undefined );
    } );
} );

// ═══════════════════════════════════════════════════════════════
// RECOMPUTE: NUMERICAL CORRECTIONS
// ═══════════════════════════════════════════════════════════════

describe( 'Recompute (numerical correction)', function () {

    it( 'should correct negative m2', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'reNegM2',
            from: { x: 'value' },
            stats: { variance: { storeAs: 'v' } }
        };
        const state = init( spec );
        state.sampleCount = 5;
        state.m2 = -1;

        recompute( state );

        expect( state.m2 ).to.equal( 0 );
    } );

    it( 'should correct negative variance', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'reNegVar',
            from: { x: 'value' },
            stats: { variance: { storeAs: 'v' } }
        };
        const state = init( spec );
        state.sampleCount = 5;
        state.variance = -5;

        recompute( state );

        expect( state.variance ).to.equal( 0 );
        expect( state.stdev ).to.equal( 0 );
    } );

    it( 'should fix inverted floor/ceiling', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'reFlip',
            from: { x: 'value' },
            stats: { envelope: { storeAs: 'e' } }
        };
        const state = init( spec );
        state.floor = 100;
        state.ceiling = 50;

        recompute( state );

        expect( state.floor ).to.equal( 50 );
        expect( state.ceiling ).to.equal( 100 );
        expect( state.envelope ).to.equal( 50 );
        expect( state.mid ).to.equal( 75 );
    } );

    it( 'should recompute biased variance from m2', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'reBiased',
            from: { x: 'value' },
            biased: true,
            stats: { variance: { storeAs: 'v' } }
        };
        const state = init( spec );
        state.sampleCount = 5;
        state.m2 = 10;

        recompute( state );

        expect( state.variance ).to.equal( 10 );
        expect( state.stdev ).to.equal( Math.sqrt( 10 ) );
    } );

    it( 'should recompute unbiased variance from m2/weightSum', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'reUnbiased',
            from: { x: 'value' },
            biased: false,
            stats: { variance: { storeAs: 'v' } }
        };
        const state = init( spec );
        state.sampleCount = 5;
        state.m2 = 10;
        state.weightSum = 0.8;

        recompute( state );

        expect( state.variance ).to.equal( 10 / 0.8 );
        expect( state.stdev ).to.equal( Math.sqrt( 10 / 0.8 ) );
    } );

    it( 'should use m2 directly when weightSum is tiny (unbiased)', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'reTinyW',
            from: { x: 'value' },
            biased: false,
            stats: { variance: { storeAs: 'v' } }
        };
        const state = init( spec );
        state.sampleCount = 3;
        state.m2 = 10;
        state.weightSum = 1e-13; // Below EPS threshold in recompute (1e-12)

        recompute( state );

        expect( state.variance ).to.equal( state.m2 );
    } );

    it( 'should return true on normal path', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'reRetNorm',
            from: { x: 'value' },
            stats: { mean: { storeAs: 'm' } }
        };
        const state = init( spec );
        state.sampleCount = 5;
        state.mean = 50;

        const result = recompute( state );
        expect( result ).to.equal( true );
    } );

    it( 'should return true on catastrophic NaN path', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'reRetNaN',
            from: { x: 'value' },
            stats: { mean: { storeAs: 'm' } }
        };
        const state = init( spec );
        state.mean = NaN;
        state.variance = 100;
        state.sampleCount = 100;

        const result = recompute( state );

        expect( result ).to.equal( true );
        expect( state.mean ).to.equal( 0 );
        expect( state.sampleCount ).to.equal( 0 );
    } );

    it( 'should return true on catastrophic Infinity path', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'reRetInf',
            from: { x: 'value' },
            stats: { mean: { storeAs: 'm' } }
        };
        const state = init( spec );
        state.mean = Infinity;
        state.sampleCount = 50;

        const result = recompute( state );

        expect( result ).to.equal( true );
        expect( state.mean ).to.equal( 0 );
        expect( state.sampleCount ).to.equal( 0 );
    } );

    it( 'should reset on unrecoverable Infinity in variance (m2 also Infinity)', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'reVarInf',
            from: { x: 'value' },
            stats: { mean: { storeAs: 'm' }, variance: { storeAs: 'v' } }
        };
        const state = init( spec );
        state.mean = 50;
        state.m2 = Infinity; // Unrecoverable — recompute from m2 still yields Infinity
        state.variance = Infinity;
        state.weightSum = 0.8;
        state.sampleCount = 10;

        const result = recompute( state );

        expect( result ).to.equal( true );
        expect( state.mean ).to.equal( 0 );
        expect( state.sampleCount ).to.equal( 0 );
    } );

    it( 'should correct recoverable Infinity in variance (m2 is finite)', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'reVarFix',
            from: { x: 'value' },
            stats: { mean: { storeAs: 'm' }, variance: { storeAs: 'v' } }
        };
        const state = init( spec );
        state.mean = 50;
        state.m2 = 10;
        state.variance = Infinity; // Correctable — recompute from finite m2
        state.weightSum = 0.8;
        state.sampleCount = 10;

        const result = recompute( state );

        expect( result ).to.equal( true );
        // Variance corrected from m2, not reset
        expect( state.variance ).to.equal( 10 / 0.8 );
        expect( state.mean ).to.equal( 50 ); // Not reset
    } );

    it( 'should reset on Infinity in floor', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'reFloorInf',
            from: { x: 'value' },
            stats: { mean: { storeAs: 'm' } }
        };
        const state = init( spec );
        state.mean = 50;
        state.floor = -Infinity;
        state.sampleCount = 10;

        const result = recompute( state );

        expect( result ).to.equal( true );
        expect( state.mean ).to.equal( 0 );
    } );

    it( 'should reset on Infinity in ceiling', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'reCeilInf',
            from: { x: 'value' },
            stats: { mean: { storeAs: 'm' } }
        };
        const state = init( spec );
        state.mean = 50;
        state.ceiling = Infinity;
        state.sampleCount = 10;

        const result = recompute( state );

        expect( result ).to.equal( true );
        expect( state.mean ).to.equal( 0 );
    } );
} );

// ═══════════════════════════════════════════════════════════════
// updateWelford: BRANCH COVERAGE
// ═══════════════════════════════════════════════════════════════

describe( 'updateWelford branch coverage', function () {

    it( 'should hit weightSum <= EPS branch in unbiased mode', function () {
        // To cover update-welford.js:27 false branch (weightSum <= EPS when
        // biased=false), we need weightSum to remain below EPS (1e-12) after
        // the Welford update: weightSum = decay * prevWeightSum + alpha.
        // With alpha = 1e-20 and prevWeightSum = 0:
        //   weightSum = (1 - 1e-20) * 0 + 1e-20 = 1e-20 < EPS
        const spec = {
            nodeType: 'ES Stats',
            name: 'welfordBranch',
            from: { x: 'value' },
            biased: false,
            stats: { variance: { storeAs: 'v' } }
        };
        const state = init( spec );

        // First sample to get past the sampleCount === 0 path
        update( state, buildMsg( 'value', 100 ) );

        // Override alpha to be extremely small so weightSum stays below EPS
        state.alpha = 1e-20;
        state.decay = 1 - 1e-20;
        state.weightSum = 0; // Will become alpha = 1e-20 after next update
        state.m2 = 25; // Positive m2 to see the fallback behavior

        // Call updateWelford directly — weightSum will be 1e-20 (below EPS)
        updateWelford( state, 105 );

        // When weightSum <= EPS, variance should equal m2 (not m2/weightSum)
        // The variance value should be close to m2 (slightly updated by the delta)
        expect( state.weightSum ).to.be.below( state.EPS );
        expect( state.variance ).to.equal( state.m2 );
    } );
} );

// ═══════════════════════════════════════════════════════════════
// NUMERICAL STABILITY
// ═══════════════════════════════════════════════════════════════

describe( 'Numerical stability', function () {

    it( 'should maintain stability over 1000 samples (deterministic)', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'longStream',
            from: { x: 'value' },
            halfLife: 10,
            stats: {
                mean: { storeAs: 'm' },
                variance: { storeAs: 'v' }
            }
        };
        const state = init( spec );
        const rng = makeXorShift32( 0xDEAD );

        for ( let i = 0; i < 1000; i += 1 ) {
            update( state, buildMsg( 'value', 100 + ( rng() * 10 ) ) );
        }

        expect( state.mean ).to.be.within( 100, 110 );
        expect( Number.isFinite( state.variance ) ).to.equal( true );
        expect( state.weightSum ).to.be.closeTo( 1, 1e-10 );
    } );

    it( 'should clamp weightSum when artificially set above 1', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'wClamp',
            from: { x: 'value' },
            stats: { mean: { storeAs: 'm' } }
        };
        const state = init( spec );

        update( state, buildMsg( 'value', 100 ) );

        // Simulate numerical drift
        state.weightSum = 1.0001;
        state.needsWelford = true;

        update( state, buildMsg( 'value', 100 ) );

        expect( state.weightSum ).to.equal( 1 );
    } );

    it( 'should handle extreme value ranges', function () {
        const spec = {
            nodeType: 'ES Stats',
            name: 'extreme',
            from: { x: 'value' },
            stats: {
                mean: { storeAs: 'm' },
                floor: { storeAs: 'f' },
                ceiling: { storeAs: 'c' }
            }
        };
        const state = init( spec );

        // Very small value
        update( state, buildMsg( 'value', 1e-10 ) );
        expect( state.mean ).to.be.closeTo( 1e-10, 1e-15 );

        // Very large value
        update( state, buildMsg( 'value', 1e10 ) );
        expect( state.ceiling ).to.equal( 1e10 );
        expect( Number.isFinite( state.mean ) ).to.equal( true );
    } );
} );

// Recompute: numerical stability tests for es-correlation node.
// Covers variance flooring, correlation clamping, NaN recovery,
// and derived stat (r2, fisherZT) consistency after adjustment.
import { expect } from 'chai';
import { describe, it } from 'mocha';

import * as corr from '../index.js';
import recompute from '../recompute.js';
import { buildMsg } from './test-helpers.js';

describe( 'recompute: floors & clamps edge branches', function () {
    it( 'returns true; floors negative variances, clamps correlation to [-1,1]', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'recompute_edges',
            from: { x: 'x', y: 'y' },
            halfLife: 12,
            minSamples: 3,
            stats: { correlation: { storeAs: 'r' } }
        };
        const s = corr.init( spec );

        // Push through some data to have non-zero stats
        [ [ 1, 1 ], [ 2, 2 ], [ 3, 3 ] ].forEach( ( p ) => corr.update( s, buildMsg( 'x', 'y', p[ 0 ], p[ 1 ] ) ) );

        // Corrupt state to hit recompute floors/clamps deterministically
        s.varianceX = -1e-9;
        s.varianceY = -1e-9;
        s.covariance = 1e308;    // absurd value → post-clamp should keep |r| ≤ 1
        const ok = recompute( s );
        expect( ok ).to.equal( true );
        expect( s.varianceX ).to.be.at.least( 0 );
        expect( s.varianceY ).to.be.at.least( 0 );
        expect( Math.abs( s.correlation ) ).to.be.at.most( 1 );
    } );
} );

describe( 'recompute edge coverage', function () {
    it( 'clamps correlation to -1 when covariance is extremely negative', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'recompute_negative_clamp',
            from: { x: 'x', y: 'y' },
            halfLife: 10,
            minSamples: 2,
            stats: { correlation: { storeAs: 'r' } }
        };
        const s = corr.init( spec );
        corr.update( s, buildMsg( 'x', 'y', -1, 1 ) );
        corr.update( s, buildMsg( 'x', 'y', -2, 2 ) );

        // Create conditions for a huge negative correlation
        s.covariance = -1e308;
        s.varianceX = 1;
        s.varianceY = 1;

        const ok = recompute( s );
        expect( ok ).to.equal( true );
        expect( s.correlation ).to.be.at.least( -1 );
        expect( s.correlation ).to.be.at.most( 1 );
    } );

    it( 'sets correlation to 0 when computed value is NaN', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'recompute_nan_to_zero',
            from: { x: 'x', y: 'y' },
            halfLife: 10,
            minSamples: 2,
            stats: { correlation: { storeAs: 'r' } }
        };
        const s = corr.init( spec );
        corr.update( s, buildMsg( 'x', 'y', 1, 1 ) );
        corr.update( s, buildMsg( 'x', 'y', 2, 2 ) );

        // Force a NaN correlation at recompute
        s.covariance = Number.NaN;
        const ok = recompute( s );
        expect( ok ).to.equal( true );
        expect( Number.isNaN( s.correlation ) ).to.equal( false );
        expect( s.correlation ).to.equal( 0 ); // NaN → 0
    } );

    it( 'updates r2 after correlation adjustment', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'recompute_r2_sync',
            from: { x: 'x', y: 'y' },
            halfLife: 10,
            minSamples: 2,
            stats: {
                correlation: { storeAs: 'r' },
                r2: { storeAs: 'r2' }
            }
        };
        const s = corr.init( spec );
        corr.update( s, buildMsg( 'x', 'y', 1, 1 ) );
        corr.update( s, buildMsg( 'x', 'y', 2, 2 ) );

        // Corrupt state: huge covariance + negative variances
        s.varianceX = -1e-9;
        s.varianceY = -1e-9;
        s.covariance = 1e308;
        s.r2 = 0.123; // stale value

        const ok = recompute( s );
        expect( ok ).to.equal( true );
        expect( s.r2 ).to.equal( s.correlation * s.correlation );
    } );

    it( 'updates fisherZT after correlation adjustment', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'recompute_fisher_sync',
            from: { x: 'x', y: 'y' },
            halfLife: 10,
            minSamples: 2,
            fisherZT: true,
            stats: {
                correlation: { storeAs: 'r' },
                fisherZT: { storeAs: 'z' }
            }
        };
        const s = corr.init( spec );
        corr.update( s, buildMsg( 'x', 'y', 1, 2 ) );
        corr.update( s, buildMsg( 'x', 'y', 3, 5 ) );
        corr.update( s, buildMsg( 'x', 'y', 5, 8 ) );

        // Corrupt: large positive covariance → clamps to 1 → fisherZCap
        s.covariance = 1e308;
        s.varianceX = 1;
        s.varianceY = 1;
        s.fisherZT = -999; // stale value

        const ok = recompute( s );
        expect( ok ).to.equal( true );
        // Correlation clamped to 1, then fisherZCap applied
        const cap = s.fisherZCap;
        const expectedZ = 0.5 * Math.log( ( 1 + cap ) / ( 1 - cap ) );
        expect( s.fisherZT ).to.be.closeTo( expectedZ, 1e-12 );
    } );

    it( 'updates fisherZT without capping when |correlation| < fisherZCap', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'recompute_fisher_mid',
            from: { x: 'x', y: 'y' },
            halfLife: 10,
            minSamples: 2,
            fisherZT: true,
            stats: {
                correlation: { storeAs: 'r' },
                fisherZT: { storeAs: 'z' }
            }
        };
        const s = corr.init( spec );
        corr.update( s, buildMsg( 'x', 'y', 1, 2 ) );
        corr.update( s, buildMsg( 'x', 'y', 3, 5 ) );

        // Set moderate covariance → correlation in middle range
        s.covariance = 0.5;
        s.varianceX = 1;
        s.varianceY = 1;
        s.fisherZT = -999; // stale

        const ok = recompute( s );
        expect( ok ).to.equal( true );
        expect( s.correlation ).to.equal( 0.5 );
        const expectedZ = 0.5 * Math.log( ( 1 + 0.5 ) / ( 1 - 0.5 ) );
        expect( s.fisherZT ).to.be.closeTo( expectedZ, 1e-12 );
    } );

    it( 'updates fisherZT with negative capping after correlation adjustment', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'recompute_fisher_neg',
            from: { x: 'x', y: 'y' },
            halfLife: 10,
            minSamples: 2,
            fisherZT: true,
            stats: {
                correlation: { storeAs: 'r' },
                fisherZT: { storeAs: 'z' }
            }
        };
        const s = corr.init( spec );
        corr.update( s, buildMsg( 'x', 'y', 1, 2 ) );
        corr.update( s, buildMsg( 'x', 'y', 3, 5 ) );

        // Corrupt: huge negative covariance → correlation clamps to -1
        s.covariance = -1e308;
        s.varianceX = 1;
        s.varianceY = 1;

        const ok = recompute( s );
        expect( ok ).to.equal( true );
        const cap = s.fisherZCap;
        const expectedZ = 0.5 * Math.log( ( 1 - cap ) / ( 1 + cap ) );
        expect( s.fisherZT ).to.be.closeTo( expectedZ, 1e-12 );
    } );

    it( 'updates r2 to 0 when correlation is NaN→0', function () {
        const spec = {
            nodeType: 'ES Correlation',
            name: 'recompute_nan_r2',
            from: { x: 'x', y: 'y' },
            halfLife: 10,
            minSamples: 2,
            stats: {
                correlation: { storeAs: 'r' },
                r2: { storeAs: 'r2' }
            }
        };
        const s = corr.init( spec );
        corr.update( s, buildMsg( 'x', 'y', 1, 1 ) );
        corr.update( s, buildMsg( 'x', 'y', 2, 2 ) );

        // Force NaN correlation
        s.covariance = Number.NaN;
        s.r2 = 0.99; // stale value

        const ok = recompute( s );
        expect( ok ).to.equal( true );
        expect( s.correlation ).to.equal( 0 );
        expect( s.r2 ).to.equal( 0 );
    } );
} );

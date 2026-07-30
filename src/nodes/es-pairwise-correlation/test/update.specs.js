// Update function tests for es-pairwise-correlation node.
// Covers first-sample initialization, invalid input handling,
// warm-up gating, and numeric sanity for small sequences.
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as ecv from '../index.js';
import { msgFrom, steadyRun } from './test-helpers.js';

describe( 'update: first-sample init, skip invalids, and correlation fill', function () {
    it( 'initializes means on first valid sample and returns early', function () {
        const fields = [ 't', 'p', 'f' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'firstSample',
            from: { x: fields },
            halfLife: 2,
            minSamples: 3,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );

        ecv.update( s, msgFrom( fields, [ 10, 20, 30 ] ) );
        expect( s.sampleCount ).to.equal( 1 );
        for ( let i = 0; i < fields.length; i += 1 ) {
            expect( s.means[ i ] ).to.equal( [ 10, 20, 30 ][ i ] );
        }

        // Invalid inputs should not mutate state
        const snap = {
            sampleCount: s.sampleCount,
            means: s.means.slice()
        };
        ecv.update( s, { t: undefined, p: 22, f: 33 } );
        ecv.update( s, { t: 11, p: null, f: 33 } );
        ecv.update( s, { t: Number.NaN, p: 22, f: 33 } );
        ecv.update( s, { t: Infinity, p: 22, f: 33 } );
        expect( s.sampleCount ).to.equal( snap.sampleCount );
        for ( let i = 0; i < s.means.length; i += 1 ) {
            expect( s.means[ i ] ).to.equal( snap.means[ i ] );
        }
    } );

    it( 'fills correlation vector only after warm-up threshold', function () {
        const fields = [ 'x', 'y' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'minGate',
            from: { x: fields },
            halfLife: 4,
            minSamples: 3,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );

        // 1st → init
        ecv.update( s, msgFrom( fields, [ 1, 2 ] ) );
        expect( s.correlations[ 0 ] ).to.equal( 0 );
        expect( s.sampleCount ).to.equal( 1 );

        // 2nd → sampleCount becomes 2, still < minSamples(3)
        ecv.update( s, msgFrom( fields, [ 2, 4 ] ) );
        expect( s.correlations[ 0 ] ).to.equal( 0 );
        expect( s.sampleCount ).to.equal( 2 );

        // 3rd → sampleCount becomes 3 == minSamples → correlation computed
        ecv.update( s, msgFrom( fields, [ 3, 6 ] ) );
        expect( s.sampleCount ).to.equal( 3 );
        expect( s.correlations[ 0 ] ).to.not.equal( 0 );
        expect( s.correlations[ 0 ] ).to.be.within( -1, 1 );
    } );

    it( 'skips update when disabled', function () {
        const fields = [ 'a', 'b' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'disableSkip',
            from: { x: fields },
            halfLife: 5,
            minSamples: 2,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );

        ecv.update( s, msgFrom( fields, [ 1, 2 ] ) );
        ecv.update( s, msgFrom( fields, [ 2, 4 ] ) );
        const countBefore = s.sampleCount;

        s.disable = true;
        ecv.update( s, msgFrom( fields, [ 100, 200 ] ) );
        expect( s.sampleCount ).to.equal( countBefore );
    } );
} );

describe( 'Correlation numeric sanity (small sequences)', function () {
    it( 'strongly positive linear relationships push r toward +1', function () {
        const fields = [ 'A', 'B', 'C' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'posCorr',
            from: { x: fields },
            halfLife: 20,
            minSamples: 3,
            stats: { correlations: { storeAs: 'vec' } }
        };
        const s = ecv.init( spec );

        steadyRun( s, fields, [
            [ 10, 20, 30 ],
            [ 20, 40, 60 ],
            [ 30, 60, 90 ],
            [ 40, 80, 120 ],
            [ 50, 100, 150 ]
        ] );

        for ( let i = 0; i < s.correlations.length; i += 1 ) {
            expect( s.correlations[ i ] ).to.be.greaterThan( 0.8 );
        }
    } );

    it( 'opposing pairs push r toward -1', function () {
        const fields = [ 'X', 'Y' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'negCorr',
            from: { x: fields },
            halfLife: 15,
            minSamples: 3,
            stats: { correlations: { storeAs: 'vec' } }
        };
        const s = ecv.init( spec );

        steadyRun( s, fields, [
            [ -2, 2 ],
            [ -4, 4 ],
            [ -6, 6 ],
            [ -8, 8 ],
            [ -10, 10 ]
        ] );

        expect( s.correlations[ 0 ] ).to.be.lessThan( -0.8 );
    } );
} );

// Lifecycle tests for es-pairwise-correlation node.
// Covers reset, recompute (floors/clamps/NaN-recovery), disable/enable,
// pause/unpause, IIoT scenarios (process monitoring, sensor drift,
// numerical stability, missing data), and performance sanity.
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as ecv from '../index.js';
import { msgFrom, steadyRun, createRng, createRandn, normal } from './test-helpers.js';

// ── Reset ───────────────────────────────────────────────────────────────────

describe( 'reset: clears accumulators, workspace, and counters', function () {
    it( 'resets all arrays to zero and sampleCount to 0', function () {
        const fields = [ 'a', 'b', 'c', 'd' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'resetAll',
            from: { x: fields },
            halfLife: 3,
            minSamples: 2,
            fisherZT: true,
            stats: { correlations: { storeAs: 'vec' } }
        };
        const s = ecv.init( spec );

        ecv.update( s, msgFrom( fields, [ 1, 2, 3, 4 ] ) );
        ecv.update( s, msgFrom( fields, [ 2, 1, 4, 3 ] ) );
        expect( s.sampleCount ).to.be.greaterThan( 0 );

        ecv.reset( s );
        const checkZero = function ( arr ) {
            return Array.from( arr ).every( ( v ) => v === 0 );
        };
        expect( checkZero( s.means ) ).to.equal( true );
        expect( checkZero( s.variances ) ).to.equal( true );
        expect( checkZero( s.covariances ) ).to.equal( true );
        expect( checkZero( s.correlations ) ).to.equal( true );
        expect( checkZero( s.fisherZT ) ).to.equal( true );
        expect( s.sampleCount ).to.equal( 0 );
        expect( checkZero( s.values ) ).to.equal( true );
        expect( checkZero( s.deltas ) ).to.equal( true );
    } );

    it( 'is idempotent (double reset)', function () {
        const fields = [ 'x', 'y' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'resetIdempotent',
            from: { x: fields },
            halfLife: 5,
            minSamples: 2,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );

        ecv.update( s, msgFrom( fields, [ 1, 2 ] ) );
        ecv.update( s, msgFrom( fields, [ 2, 4 ] ) );
        ecv.reset( s );
        const ok1 = ecv.reset( s );
        expect( ok1 ).to.equal( true );
        expect( s.sampleCount ).to.equal( 0 );
    } );
} );

// ── Recompute ───────────────────────────────────────────────────────────────

describe( 'recompute: floors negatives, clamps, and recomputes Fisher Z', function () {
    it( 'returns true and keeps correlation vector consistent and finite', function () {
        const fields = [ 'u', 'v', 'w' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'recomputeOk',
            from: { x: fields },
            halfLife: 6,
            minSamples: 3,
            fisherZT: true,
            stats: { correlations: { storeAs: 'vec' }, fisherZT: { storeAs: 'z' } }
        };
        const s = ecv.init( spec );

        steadyRun( s, fields, [
            [ 10, 11, 12 ],
            [ 11, 12, 13 ],
            [ 12, 13, 14 ],
            [ 13, 14, 15 ]
        ] );

        // Corrupt a variance to exercise the floor
        s.variances[ 0 ] = -1e-6;

        const ok = ecv.recompute( s );
        expect( ok ).to.equal( true );
        for ( let i = 0; i < s.correlations.length; i += 1 ) {
            expect( s.correlations[ i ] ).to.be.within( -1, 1 );
            expect( Number.isFinite( s.correlations[ i ] ) ).to.equal( true );
        }

        // Fisher Z should be recomputed and finite
        for ( let i = 0; i < s.fisherZT.length; i += 1 ) {
            expect( Number.isFinite( s.fisherZT[ i ] ) ).to.equal( true );
        }
    } );
} );

describe( 'recompute: defensive edge cases (corrupted state)', function () {
    it( 'coerces NaN correlation (0/0) to 0', function () {
        const fields = [ 'a', 'b' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'nanEdge',
            from: { x: fields },
            halfLife: 5,
            minSamples: 2,
            stats: { correlations: { storeAs: 'vec' } }
        };
        const s = ecv.init( spec );

        ecv.update( s, { a: 1, b: 2 } );
        ecv.update( s, { a: 2, b: 4 } );

        // Corrupt invariants to force 0/0 in recompute
        s.minVariance = 0;
        s.variances[ 0 ] = 0;
        s.variances[ 1 ] = 0;
        s.covariances[ 0 ] = 0;

        // Prove overwrite
        s.correlations[ 0 ] = 0.12345;

        const ok = ecv.recompute( s );
        expect( ok ).to.equal( true );
        expect( s.correlations[ 0 ] ).to.equal( 0 ); // NaN → 0
    } );
} );

describe( 'recompute: clamp branches (forged state)', function () {
    it( 'clamps to +fisherZCap when r > cap', function () {
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'clampPlus',
            from: { x: [ 'p', 'q' ] },
            halfLife: 6,
            minSamples: 2,
            fisherZT: true,
            stats: { correlations: { storeAs: 'vec' }, fisherZT: { storeAs: 'z' } }
        };
        const s = ecv.init( spec );

        // Forge state so r = cov / (sqrt(vx)*sqrt(vy)) > 1
        s.variances[ 0 ] = 1.0;
        s.variances[ 1 ] = 1.0;
        s.covariances[ 0 ] = 1.1; // r = 1.1
        const ok = ecv.recompute( s );
        expect( ok ).to.equal( true );
        expect( s.correlations[ 0 ] ).to.equal( s.fisherZCap ); // +0.9999
        expect( Number.isFinite( s.fisherZT[ 0 ] ) ).to.equal( true );
    } );

    it( 'clamps to -fisherZCap when r < -cap', function () {
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'clampMinus',
            from: { x: [ 'p', 'q' ] },
            halfLife: 6,
            minSamples: 2,
            fisherZT: true,
            stats: { correlations: { storeAs: 'vec' }, fisherZT: { storeAs: 'z' } }
        };
        const s = ecv.init( spec );

        // Forge state so r < -1
        s.variances[ 0 ] = 1.0;
        s.variances[ 1 ] = 1.0;
        s.covariances[ 0 ] = -1.1; // r = -1.1
        const ok = ecv.recompute( s );
        expect( ok ).to.equal( true );
        expect( s.correlations[ 0 ] ).to.equal( -s.fisherZCap ); // -0.9999
        expect( Number.isFinite( s.fisherZT[ 0 ] ) ).to.equal( true );
    } );
} );

// ── Disable / Enable ────────────────────────────────────────────────────────

describe( 'disable/enable control', function () {
    it( 'disable skips update (sampleCount unchanged)', function () {
        const fields = [ 'a', 'b' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'disableUpdate',
            from: { x: fields },
            halfLife: 5,
            minSamples: 2,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );

        ecv.update( s, msgFrom( fields, [ 1, 2 ] ) );
        ecv.update( s, msgFrom( fields, [ 2, 4 ] ) );
        const countBefore = s.sampleCount;

        ecv.disable( s );
        expect( s.disable ).to.equal( true );

        ecv.update( s, msgFrom( fields, [ 100, 200 ] ) );
        expect( s.sampleCount ).to.equal( countBefore );
    } );

    it( 'disable skips publishTo (empty output)', function () {
        const fields = [ 'x', 'y' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'disablePublish',
            from: { x: fields },
            halfLife: 5,
            minSamples: 2,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );

        ecv.update( s, msgFrom( fields, [ 1, 2 ] ) );
        ecv.update( s, msgFrom( fields, [ 2, 4 ] ) );

        ecv.disable( s );
        const out = Object.create( null );
        ecv.publishTo( s, out );
        expect( Object.keys( out ).length ).to.equal( 0 );
    } );

    it( 'enable recovers processing after disable', function () {
        const fields = [ 'a', 'b' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'enableRecovery',
            from: { x: fields },
            halfLife: 5,
            minSamples: 2,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );

        // Warm up
        ecv.update( s, msgFrom( fields, [ 1, 2 ] ) );
        ecv.update( s, msgFrom( fields, [ 2, 4 ] ) );
        const countBefore = s.sampleCount;

        // Disable → enable → verify processing resumes
        ecv.disable( s );
        ecv.update( s, msgFrom( fields, [ 99, 99 ] ) );
        expect( s.sampleCount ).to.equal( countBefore ); // No change

        ecv.enable( s );
        expect( s.disable ).to.equal( false );

        ecv.update( s, msgFrom( fields, [ 3, 6 ] ) );
        expect( s.sampleCount ).to.equal( countBefore + 1 );

        // PublishTo works again
        const out = Object.create( null );
        ecv.publishTo( s, out );
        expect( out.corr ).to.be.instanceOf( Float64Array );
    } );
} );

// ── Pause / Unpause ─────────────────────────────────────────────────────────

describe( 'pause/unpause control', function () {
    it( 'skips update when paused', function () {
        const fields = [ 'a', 'b' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'pauseSkip',
            from: { x: fields },
            halfLife: 5,
            minSamples: 2,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );

        ecv.update( s, msgFrom( fields, [ 1, 2 ] ) );
        ecv.update( s, msgFrom( fields, [ 2, 4 ] ) );
        const countBefore = s.sampleCount;

        ecv.pause( s );
        expect( s.pause ).to.equal( true );

        ecv.update( s, msgFrom( fields, [ 100, 200 ] ) );
        expect( s.sampleCount ).to.equal( countBefore );
    } );

    it( 'publishTo still works when paused (last-known values)', function () {
        const fields = [ 'a', 'b' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'pausePub',
            from: { x: fields },
            halfLife: 5,
            minSamples: 2,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );

        ecv.update( s, msgFrom( fields, [ 1, 2 ] ) );
        ecv.update( s, msgFrom( fields, [ 2, 4 ] ) );

        ecv.pause( s );

        const out = Object.create( null );
        ecv.publishTo( s, out );
        expect( out.corr ).to.be.instanceOf( Float64Array );
    } );

    it( 'unpause resumes processing', function () {
        const fields = [ 'a', 'b' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'unpauseResume',
            from: { x: fields },
            halfLife: 5,
            minSamples: 2,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );

        ecv.update( s, msgFrom( fields, [ 1, 2 ] ) );
        ecv.update( s, msgFrom( fields, [ 2, 4 ] ) );
        const countBefore = s.sampleCount;

        ecv.pause( s );
        ecv.update( s, msgFrom( fields, [ 99, 99 ] ) );
        expect( s.sampleCount ).to.equal( countBefore );

        ecv.unpause( s );
        expect( s.pause ).to.equal( false );

        ecv.update( s, msgFrom( fields, [ 3, 6 ] ) );
        expect( s.sampleCount ).to.equal( countBefore + 1 );
    } );
} );

// ── IIoT Scenarios ──────────────────────────────────────────────────────────

describe( 'IIoT Scenarios', function () {
    it( 'Industrial process monitoring: process vars correlate, mechanical channel stays low', function () {
        const rng = createRng( 13579 );
        const randn = createRandn( rng );

        const fields = [ 'temperature', 'pressure', 'flow', 'vibration' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'procMon',
            from: { x: fields },
            halfLife: 8,
            minSamples: 10,
            stats: {
                correlations: { storeAs: 'corr' },
                pairNames: { storeAs: 'pairs' },
                varNames: { storeAs: 'vars' }
            }
        };
        const s = ecv.init( spec );

        const N = 160;
        for ( let i = 0; i < N; i += 1 ) {
            const base = i + ( 0.2 * randn() );
            const temperature = normal( randn, base, 0.05 );
            const pressure = normal( randn, ( base * 1.5 ), 0.05 );
            const flow = normal( randn, ( base * 0.8 ), 0.05 );
            const vibration = 5 + ( 2 * rng() ); // uniform independent channel

            ecv.update( s, { temperature, pressure, flow, vibration } );
        }

        const pairs = s.pairCount;
        expect( pairs ).to.equal( ( fields.length * ( fields.length - 1 ) ) / 2 );

        const procPairValues = [];
        const vibPairValues = [];
        let idx = 0;
        for ( let i = 0; i < fields.length; i += 1 ) {
            for ( let j = i + 1; j < fields.length; j += 1 ) {
                const r = s.correlations[ idx ];
                if ( fields[ i ] === 'vibration' || fields[ j ] === 'vibration' ) {
                    vibPairValues.push( r );
                } else {
                    procPairValues.push( r );
                }
                idx += 1;
            }
        }

        const median = function ( arr ) {
            const a = arr.slice().sort( ( x, y ) => x - y );
            return a[ Math.floor( a.length / 2 ) ];
        };
        expect( median( procPairValues ) ).to.be.greaterThan( 0.7 );
        expect( median( vibPairValues ) ).to.be.lessThan( 0.4 );
    } );

    it( 'Correlation breakdown: two remain high, pairs involving drifting sensor drop', function () {
        const rng = createRng( 24680 );
        const randn = createRandn( rng );

        const fields = [ 'sensor1', 'sensor2', 'sensor3' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'driftDetect',
            from: { x: fields },
            halfLife: 4,
            minSamples: 8,
            fisherZT: true,
            stats: {
                correlations: { storeAs: 'corr' },
                fisherZT: { storeAs: 'z' },
                pairNames: { storeAs: 'pairs' }
            }
        };
        const s = ecv.init( spec );

        // Phase 1: all correlated
        for ( let i = 0; i < 100; i += 1 ) {
            const base = i + ( 0.2 * randn() );
            const sensor1 = normal( randn, base, 0.1 );
            const sensor2 = normal( randn, ( base * 1.1 ), 0.1 );
            const sensor3 = normal( randn, ( base * 0.9 ), 0.1 );
            ecv.update( s, { sensor1, sensor2, sensor3 } );
        }

        // Phase 2: sensor2 breaks away
        for ( let i = 0; i < 200; i += 1 ) {
            const base = 100 + i + ( 0.2 * randn() );
            const sensor1 = normal( randn, base, 0.1 );
            const sensor2 = normal( randn, 75, 8 ); // decoupled
            const sensor3 = normal( randn, ( base * 0.9 ), 0.1 );
            ecv.update( s, { sensor1, sensor2, sensor3 } );
        }

        // Pairs order: [ s1-s2, s1-s3, s2-s3 ]
        const r12 = s.correlations[ 0 ];
        const r13 = s.correlations[ 1 ];
        const r23 = s.correlations[ 2 ];

        // s1-s3 >> (s1-s2, s2-s3) since sensor2 drifted
        const margin = 0.2;
        expect( r13 ).to.be.greaterThan( r12 + margin );
        expect( r13 ).to.be.greaterThan( r23 + margin );

        expect( r12 ).to.be.within( -1, 1 );
        expect( r23 ).to.be.within( -1, 1 );
        expect( r13 ).to.be.within( -1, 1 );

        // Fisher Z should be finite
        for ( let k = 0; k < s.fisherZT.length; k += 1 ) {
            expect( Number.isFinite( s.fisherZT[ k ] ) ).to.equal( true );
        }
    } );

    it( 'Numerical stability under extreme ranges (no NaN/Inf; recompute heals)', function () {
        const rng = createRng( 97531 );
        const fields = [ 'large1', 'large2', 'small', 'zeroish' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'numStab',
            from: { x: fields },
            halfLife: 10,
            minSamples: 10,
            stats: {
                correlations: { storeAs: 'corr' },
                covariances: { storeAs: 'cov' }
            }
        };
        const s = ecv.init( spec );

        for ( let i = 0; i < 80; i += 1 ) {
            const large1 = 1e6 + ( rng() * 1e-3 );
            const large2 = 1e6 + ( rng() * 1e-3 );
            const small = 1e-6 * rng();
            const zeroish = ( i < 40 ) ? 0 : 1e-10;
            ecv.update( s, { large1, large2, small, zeroish } );
        }

        for ( const r of s.correlations ) {
            expect( Number.isFinite( r ) ).to.equal( true );
            expect( r ).to.be.within( -1, 1 );
        }

        // Corrupt and ensure recompute recovers
        s.variances[ 0 ] = -1e-6;
        const ok = ecv.recompute( s );
        expect( ok ).to.equal( true );
        for ( const r of s.correlations ) {
            expect( Number.isFinite( r ) ).to.equal( true );
            expect( r ).to.be.within( -1, 1 );
        }
    } );

    it( 'Missing-data cadence: skips when any field invalid, stable when valid', function () {
        const rng = createRng( 112233 );
        const fields = [ 'reliable', 'intermittent', 'sporadic' ];
        const spec = {
            nodeType: 'ES Pairwise Correlation',
            name: 'missingData',
            from: { x: fields },
            halfLife: 6,
            minSamples: 6,
            stats: { correlations: { storeAs: 'corr' } }
        };
        const s = ecv.init( spec );

        let updates = 0;
        let skips = 0;
        for ( let i = 0; i < 150; i += 1 ) {
            const msgObj = {
                reliable: i + rng()
            };
            msgObj.intermittent = ( i % 3 === 0 ) ? undefined : i + rng();
            msgObj.sporadic = ( i % 5 === 0 ) ? null : i + rng();

            const before = s.sampleCount;
            ecv.update( s, msgObj );
            if ( s.sampleCount > before ) {
                updates += 1;
            } else {
                skips += 1;
            }
        }

        expect( skips ).to.be.greaterThan( 0 );
        expect( updates ).to.be.greaterThan( 0 );

        for ( const r of s.correlations ) {
            expect( Number.isFinite( r ) ).to.equal( true );
            expect( r ).to.be.within( -1, 1 );
        }
    } );

    it( 'Lightweight performance sanity', function () {
        const rng = createRng( 424242 );
        const nList = [ 4, 6, 8 ];
        const iterations = 100000;

        const fmt = function ( x, d = 1 ) {
            return Number.isFinite( x ) ? x.toFixed( d ) : '∞';
        };

        for ( let nIdx = 0; nIdx < nList.length; nIdx += 1 ) {
            const n = nList[ nIdx ];
            const fields = Array.from( { length: n }, ( _, i ) => `v${i}` );
            const spec = {
                nodeType: 'ES Pairwise Correlation',
                name: `perf${n}`,
                from: { x: fields },
                halfLife: 8,
                minSamples: 5,
                stats: { correlations: { storeAs: 'corr' } }
            };
            const s = ecv.init( spec );

            const msgObj = Object.create( null );
            for ( let i = 0; i < n; i += 1 ) {
                msgObj[ fields[ i ] ] = rng() * 100;
            }

            for ( let i = 0; i < 50; i += 1 ) {
                ecv.update( s, msgObj );
            }

            const start = process.hrtime.bigint();
            for ( let i = 0; i < iterations; i += 1 ) {
                ecv.update( s, msgObj );
            }
            const end = process.hrtime.bigint();

            const perUpdateNs = Number( end - start ) / iterations;
            const updatesPerSec = ( perUpdateNs > 0 ) ? ( 1e9 / perUpdateNs ) : Infinity;

            console.log(
                `\t\tPerformance: ${fmt( updatesPerSec, 0 )} updates/second for ${n} variables`
            );

            // Heuristic: ensure no catastrophic regression (> 1 ms/update)
            expect( perUpdateNs ).to.be.below( 1e6 );
        }
    } );
} );

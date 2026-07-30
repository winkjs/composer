// test/tw-stats.specs.js
import { expect } from 'chai';
import { describe, it } from 'mocha';

import { init, update, publishTo, flush, reset, recompute } from '../index.js';
import {
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities,
    getDSLMetadata,
    DEFAULT_OPTIONS
} from '../introspect.js';
import { gt } from '../../moments-digest/test/moments-digest-ground-truth.js';

// ── Helpers ─────────────────────────────────────────────────────────────

/** Tolerant comparator: uses both absolute and relative tolerances */
const expectClose = function ( actual, expected, absTol, relTol, label ) {
    const a = Number( actual );
    const e = Number( expected );
    const diff = Math.abs( a - e );
    const tol = Math.max( absTol, ( relTol * Math.max( 1, Math.abs( e ) ) ) );
    if ( diff > tol ) {
        throw new Error(
            `${label} | actual=${a}, expected=${e}, diff=${diff}, tol=${tol}`
        );
    }
};

/**
 * Feed raw samples through a twStats node and collect published outputs.
 * @param {number[]} data - Raw samples
 * @param {number} windowSize - Samples per window
 * @param {Object} stats - Stats spec (e.g., { mean: 'avg', stddev: 'sd' })
 * @param {Object} [options] - Additional options (biased, epsilon)
 * @returns {{ outputs: Object[], msgs: Object[] }}
 */
const runNode = function ( data, windowSize, stats, options ) {
    // Convert shorthand { mean: 'avg' } to { mean: { storeAs: 'avg' } }
    const statsSpec = Object.create( null );
    // eslint-disable-next-line guard-for-in
    for ( const key in stats ) {
        statsSpec[ key ] = { storeAs: stats[ key ] };
    }

    const spec = {
        nodeType: 'TW Stats',
        name: 'tw',
        from: { x: 'x' },
        windowSize,
        stats: statsSpec,
        ...( options || {} )
    };
    const state = init( spec );
    const outputs = [];
    const msgs = [];

    for ( let i = 0; i < data.length; i += 1 ) {
        const msg = Object.create( null );
        msg.x = data[ i ];
        update( state, msg );
        publishTo( state, msg );
        msgs.push( msg );
        if ( msg.tw === true ) {
            outputs.push( { ...msg } );
        }
    }
    return { outputs, msgs, state };
};

/**
 * Create a twStats state with full stats for testing.
 */
const fullSpec = function ( windowSize, options ) {
    return {
        nodeType: 'TW Stats',
        name: 'tw',
        from: { x: 'x' },
        windowSize,
        stats: {
            n: { storeAs: 'sn' },
            mean: { storeAs: 'smean' },
            variance: { storeAs: 'svar' },
            stddev: { storeAs: 'sstd' },
            cv: { storeAs: 'scv' },
            skew: { storeAs: 'sskew' },
            kurtosis: { storeAs: 'skurt' },
            min: { storeAs: 'smin' },
            max: { storeAs: 'smax' }
        },
        ...( options || {} )
    };
};

// ── Known values for deterministic datasets ────────────────────────────

// [1, 2, 3, 4, 5] — windowSize=5
// Mean = 3, Variance (unbiased) = 2.5, StdDev = sqrt(2.5)
// Population m2 = 2.0, m3 = 0, m4 = 6.8
// Skew = m3 / m2^1.5 = 0
// Excess kurtosis = (m4 / m2^2) - 3 = (6.8 / 4) - 3 = -1.3
const SIMPLE_5 = {
    data: [ 1, 2, 3, 4, 5 ],
    n: 5,
    mean: 3,
    variance: 2.5,       // M2/(n-1) = 10/4
    stddev: Math.sqrt( 2.5 ),
    min: 1,
    max: 5,
    skew: 0,
    kurtosis: -1.3
};

// [7, 7, 7, 7] — windowSize=4, all equal
const ALL_EQUAL = {
    data: [ 7, 7, 7, 7 ],
    n: 4,
    mean: 7,
    variance: 0,
    stddev: 0,
    min: 7,
    max: 7
};

// ── Tests ───────────────────────────────────────────────────────────────

describe( 'twStats — introspection', function () {
    it( 'getSupportedStats returns correct list with safe copy', function () {
        const stats = getSupportedStats();
        expect( stats ).to.deep.equal( [
            'n', 'mean', 'variance', 'stddev', 'cv', 'skew', 'kurtosis', 'min', 'max',
            'rms', 'crestFactor'
        ] );
        stats.push( 'rogue' );
        expect( getSupportedStats() ).to.not.include( 'rogue' );
    } );

    it( 'getStatDescriptions returns descriptions with safe copy', function () {
        const desc = getStatDescriptions();
        expect( desc.mean ).to.be.a( 'string' );
        desc.mean = 'tampered';
        expect( getStatDescriptions().mean ).to.not.equal( 'tampered' );
    } );

    it( 'getSupportedControlMethods includes reset, enable, disable, pause, unpause, flush', function () {
        const methods = getSupportedControlMethods();
        expect( methods ).to.have.all.keys( 'reset', 'enable', 'disable', 'pause', 'unpause', 'flush' );
    } );

    it( 'getNodeType returns TW Stats', function () {
        expect( getNodeType() ).to.equal( 'TW Stats' );
    } );

    it( 'getCapabilities returns features with safe copy', function () {
        const cap = getCapabilities();
        expect( cap.features ).to.be.an( 'array' );
        cap.features.push( 'rogue' );
        expect( getCapabilities().features ).to.not.include( 'rogue' );
    } );

    it( 'getDSLMetadata returns specSchema and buildSpec', function () {
        const meta = getDSLMetadata();
        expect( meta.specSchema ).to.be.an( 'object' );
        expect( meta.buildSpec ).to.be.a( 'function' );
    } );

    it( 'DEFAULT_OPTIONS has expected defaults', function () {
        expect( DEFAULT_OPTIONS.windowSize ).to.equal( 100 );
        expect( DEFAULT_OPTIONS.biased ).to.equal( false );
        expect( DEFAULT_OPTIONS.epsilon ).to.equal( 1e-12 );
    } );

    it( 'buildSpec creates valid spec', function () {
        const meta = getDSLMetadata();
        const spec = meta.buildSpec(
            'myStats', 'temp', { mean: { storeAs: 'avg' } }, { windowSize: 50 }
        );
        expect( spec.nodeType ).to.equal( 'TW Stats' );
        expect( spec.name ).to.equal( 'myStats' );
        expect( spec.from.x ).to.equal( 'temp' );
        expect( spec.stats.mean.storeAs ).to.equal( 'avg' );
        expect( spec.windowSize ).to.equal( 50 );
    } );
} );

describe( 'twStats — init validation', function () {
    it( 'throws on missing stats', function () {
        expect( () => init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' }
        } ) ).to.throw();
    } );

    it( 'throws on invalid stat name', function () {
        expect( () => init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            stats: { rogue: { storeAs: 'val' } }
        } ) ).to.throw();
    } );

    it( 'throws on windowSize below 4', function () {
        expect( () => init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            windowSize: 3,
            stats: { mean: { storeAs: 'avg' } }
        } ) ).to.throw();
    } );

    it( 'throws on windowSize above 1,000,000', function () {
        expect( () => init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            windowSize: 1000001,
            stats: { mean: { storeAs: 'avg' } }
        } ) ).to.throw();
    } );

    it( 'accepts a field-keyed windowSize, resolving the node\'s field', function () {
        const state = init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'temp' },
            windowSize: { temp: 50, pressure: 20 },
            stats: { mean: { storeAs: 'avg' } }
        } );
        expect( state.windowSize ).to.equal( 50 );
    } );

    it( 'throws on a field-keyed windowSize whose entry is below 4', function () {
        expect( () => init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'temp' },
            windowSize: { temp: 3 },
            stats: { mean: { storeAs: 'avg' } }
        } ) ).to.throw();
    } );

    it( 'applies default options when not specified', function () {
        const state = init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            stats: { mean: { storeAs: 'avg' } }
        } );
        expect( state.windowSize ).to.equal( 100 );
        expect( state.biased ).to.equal( false );
        expect( state.epsilon ).to.equal( 1e-12 );
    } );

    it( 'computes maxMoment=1 for mean-only', function () {
        const state = init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            stats: { mean: { storeAs: 'avg' } }
        } );
        expect( state.maxMoment ).to.equal( 1 );
    } );

    it( 'computes maxMoment=2 for variance', function () {
        const state = init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            stats: { variance: { storeAs: 'v' } }
        } );
        expect( state.maxMoment ).to.equal( 2 );
    } );

    it( 'computes maxMoment=2 for cv', function () {
        const state = init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            stats: { cv: { storeAs: 'c' } }
        } );
        expect( state.maxMoment ).to.equal( 2 );
    } );

    it( 'computes maxMoment=3 for skew', function () {
        const state = init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            stats: { skew: { storeAs: 's' } }
        } );
        expect( state.maxMoment ).to.equal( 3 );
    } );

    it( 'computes maxMoment=4 for kurtosis', function () {
        const state = init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            stats: { kurtosis: { storeAs: 'k' } }
        } );
        expect( state.maxMoment ).to.equal( 4 );
    } );

    it( 'sets needsMinMax correctly', function () {
        const s1 = init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            stats: { mean: { storeAs: 'avg' } }
        } );
        expect( s1.needsMinMax ).to.equal( false );

        const s2 = init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            stats: {
                min: { storeAs: 'lo' },
                max: { storeAs: 'hi' }
            }
        } );
        expect( s2.needsMinMax ).to.equal( true );
    } );

    it( 'pre-computes scrubKeys from stats', function () {
        const state = init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            stats: {
                mean: { storeAs: 'avg' },
                stddev: { storeAs: 'sd' }
            }
        } );
        expect( state.scrubKeys ).to.include( 'avg' );
        expect( state.scrubKeys ).to.include( 'sd' );
    } );
} );

describe( 'twStats — window completion', function () {
    it( 'does not publish during warm-up', function () {
        const { msgs } = runNode( [ 1, 2, 3 ], 5, { mean: 'avg' } );
        for ( let i = 0; i < msgs.length; i += 1 ) {
            expect( msgs[ i ].tw ).to.not.equal( true );
            expect( msgs[ i ].avg ).to.equal( undefined );
        }
    } );

    it( 'publishes on window boundary with msg[name]=true', function () {
        const { outputs } = runNode( SIMPLE_5.data, 5, { mean: 'avg' } );
        expect( outputs.length ).to.equal( 1 );
        expect( outputs[ 0 ].tw ).to.equal( true );
        expectClose( outputs[ 0 ].avg, SIMPLE_5.mean, 1e-12, 1e-12, 'mean' );
    } );

    it( 'scrubs storeAs fields to undefined on non-publish ticks', function () {
        const state = init( fullSpec( 4 ) );
        const msg = Object.create( null );
        msg.x = 1;
        update( state, msg );
        publishTo( state, msg );
        expect( msg.smean ).to.equal( undefined );
        expect( msg.svar ).to.equal( undefined );
    } );

    it( 'produces correct consecutive independent windows', function () {
        const data = [ 1, 2, 3, 4, 5, 10, 20, 30, 40, 50 ];
        const { outputs } = runNode( data, 5, {
            mean: 'avg',
            n: 'cnt'
        } );
        expect( outputs.length ).to.equal( 2 );
        expectClose( outputs[ 0 ].avg, 3, 1e-12, 1e-12, 'window1 mean' );
        expectClose( outputs[ 1 ].avg, 30, 1e-12, 1e-12, 'window2 mean' );
        expect( outputs[ 0 ].cnt ).to.equal( 5 );
        expect( outputs[ 1 ].cnt ).to.equal( 5 );
    } );
} );

describe( 'twStats — numerical accuracy', function () {
    it( 'computes correct full stats for [1,2,3,4,5]', function () {
        const { outputs } = runNode( SIMPLE_5.data, 5, {
            n: 'cnt',
            mean: 'avg',
            variance: 'var',
            stddev: 'sd',
            skew: 'sk',
            kurtosis: 'ku',
            min: 'lo',
            max: 'hi'
        } );
        expect( outputs.length ).to.equal( 1 );
        const o = outputs[ 0 ];
        expect( o.cnt ).to.equal( SIMPLE_5.n );
        expectClose( o.avg, SIMPLE_5.mean, 1e-12, 1e-12, 'mean' );
        expectClose( o.var, SIMPLE_5.variance, 1e-10, 1e-10, 'variance' );
        expectClose( o.sd, SIMPLE_5.stddev, 1e-10, 1e-10, 'stddev' );
        expectClose( o.sk, SIMPLE_5.skew, 1e-10, 1e-10, 'skew' );
        expectClose( o.ku, SIMPLE_5.kurtosis, 1e-8, 1e-8, 'kurtosis' );
        expect( o.lo ).to.equal( SIMPLE_5.min );
        expect( o.hi ).to.equal( SIMPLE_5.max );
    } );

    it( 'symmetric data [-2,-1,0,1,2] has skew near 0', function () {
        const { outputs } = runNode( [ -2, -1, 0, 1, 2 ], 5, { skew: 'sk' } );
        expectClose( outputs[ 0 ].sk, 0, 1e-10, 1e-10, 'skew' );
    } );

    it( 'all-equal data has variance=0 and degenerate higher stats', function () {
        const { outputs } = runNode( ALL_EQUAL.data, 4, {
            mean: 'avg',
            variance: 'var',
            stddev: 'sd',
            cv: 'cv',
            skew: 'sk',
            kurtosis: 'ku'
        } );
        const o = outputs[ 0 ];
        expect( o.avg ).to.equal( ALL_EQUAL.mean );
        expect( o.var ).to.equal( 0 );
        expect( o.sd ).to.equal( 0 );
        // eslint-disable-next-line no-unused-expressions
        expect( o.cv ).to.be.NaN;
        expect( o.sk ).to.equal( 0 );
        expect( o.ku ).to.equal( -3 );
    } );

    it( 'biased=true produces population variance M2/n', function () {
        // [1,2,3,4,5]: M2=10, population variance = 10/5 = 2.0
        const { outputs } = runNode(
            SIMPLE_5.data, 5,
            { variance: 'var', stddev: 'sd' },
            { biased: true }
        );
        expectClose( outputs[ 0 ].var, 2.0, 1e-12, 1e-12, 'biased variance' );
        expectClose( outputs[ 0 ].sd, Math.sqrt( 2.0 ), 1e-12, 1e-12, 'biased stddev' );
    } );

    it( 'cross-validates against momentsDigest ground truth (size-8 windows)', function () {
        const { outputs } = runNode( gt.data, 8, {
            n: 'cnt',
            mean: 'avg',
            variance: 'var',
            stddev: 'sd',
            skew: 'sk',
            kurtosis: 'ku',
            min: 'lo',
            max: 'hi'
        } );

        expect( outputs.length ).to.equal( gt.windows.size8.length );

        for ( let i = 0; i < outputs.length; i += 1 ) {
            const o = outputs[ i ];
            const e = gt.windows.size8[ i ];

            // n must match exactly
            expect( o.cnt ).to.equal( e.n );

            // Mean = M1 (tight tolerance)
            expectClose( o.avg, e.M1, 1e-9, 1e-10, `window${i} mean` );

            // Variance (unbiased) = M2/(n-1) — tighter than raw M2
            const expectedVariance = e.M2 / ( e.n - 1 );
            expectClose( o.var, expectedVariance, 1e-6, 1e-9, `window${i} variance` );

            // StdDev
            expectClose( o.sd, Math.sqrt( expectedVariance ), 1e-6, 1e-9, `window${i} stddev` );

            // Min/max
            expectClose( o.lo, e.min, 1e-12, 1e-12, `window${i} min` );
            expectClose( o.hi, e.max, 1e-12, 1e-12, `window${i} max` );

            // Skew: m3/m2^1.5 — progressive tolerance
            const m2 = e.M2 / e.n;
            const expectedSkew = ( e.M3 / e.n ) / Math.pow( m2, 1.5 );
            expectClose( o.sk, expectedSkew, 1e-4, 1e-6, `window${i} skew` );

            // Kurtosis: m4/m2^2 - 3 — loosest tolerance
            const expectedKurtosis = ( ( e.M4 / e.n ) / ( m2 * m2 ) ) - 3;
            expectClose( o.ku, expectedKurtosis, 1e-1, 1e-4, `window${i} kurtosis` );
        }
    } );
} );

describe( 'twStats — selective accumulation', function () {
    it( 'mean-only (tier 1) publishes only mean', function () {
        const { outputs } = runNode( SIMPLE_5.data, 5, { mean: 'avg' } );
        expect( outputs[ 0 ].avg ).to.equal( SIMPLE_5.mean );
        // No variance-dependent stats should be present
        expect( outputs[ 0 ] ).to.not.have.property( 'var' );
    } );

    it( 'variance subset (tier 2) publishes variance and stddev', function () {
        const { outputs } = runNode( SIMPLE_5.data, 5, {
            variance: 'var',
            stddev: 'sd'
        } );
        expectClose( outputs[ 0 ].var, SIMPLE_5.variance, 1e-10, 1e-10, 'variance' );
        expectClose( outputs[ 0 ].sd, SIMPLE_5.stddev, 1e-10, 1e-10, 'stddev' );
    } );

    it( 'n and min/max only (tier 1 + minMax)', function () {
        const { outputs } = runNode( SIMPLE_5.data, 5, {
            n: 'cnt',
            min: 'lo',
            max: 'hi'
        } );
        expect( outputs[ 0 ].cnt ).to.equal( 5 );
        expect( outputs[ 0 ].lo ).to.equal( 1 );
        expect( outputs[ 0 ].hi ).to.equal( 5 );
    } );
} );

describe( 'twStats — invalid input handling', function () {
    it( 'skips NaN samples without counting them', function () {
        // Insert NaN in the middle — window still completes with 5 valid samples
        const data = [ 1, NaN, 2, 3, NaN, 4, 5 ];
        const { outputs } = runNode( data, 5, {
            n: 'cnt',
            mean: 'avg'
        } );
        expect( outputs.length ).to.equal( 1 );
        expect( outputs[ 0 ].cnt ).to.equal( 5 );
        expectClose( outputs[ 0 ].avg, SIMPLE_5.mean, 1e-12, 1e-12, 'mean after NaN skip' );
    } );

    it( 'skips Infinity samples', function () {
        const data = [ 1, Infinity, 2, 3, -Infinity, 4, 5 ];
        const { outputs } = runNode( data, 5, {
            n: 'cnt',
            mean: 'avg'
        } );
        expect( outputs.length ).to.equal( 1 );
        expect( outputs[ 0 ].cnt ).to.equal( 5 );
    } );

    it( 'skips undefined samples', function () {
        const data = [ 1, undefined, 2, 3, undefined, 4, 5 ];
        const { outputs } = runNode( data, 5, { n: 'cnt' } );
        expect( outputs.length ).to.equal( 1 );
        expect( outputs[ 0 ].cnt ).to.equal( 5 );
    } );
} );

describe( 'twStats — flush', function () {
    it( 'publishes partial window on flush', function () {
        const state = init( fullSpec( 8 ) );
        // Feed 3 samples (partial window)
        for ( let i = 1; i <= 3; i += 1 ) {
            const msg = Object.create( null );
            msg.x = i;
            update( state, msg );
            publishTo( state, msg );
        }
        // Latch flush
        flush( state );
        // Next update triggers prelude → snapshot → publish
        const msg = Object.create( null );
        msg.x = 99;   // This starts the next window
        update( state, msg );
        publishTo( state, msg );
        expect( msg.tw ).to.equal( true );
        expect( msg.sn ).to.equal( 3 );
        expectClose( msg.smean, 2, 1e-12, 1e-12, 'flush mean' );
    } );

    it( 'flush with n=0 does not publish', function () {
        const state = init( fullSpec( 8 ) );
        flush( state );
        const msg = Object.create( null );
        msg.x = 1;
        update( state, msg );
        publishTo( state, msg );
        // No publish (flush had no data); msg is scrubbed
        expect( msg.tw ).to.not.equal( true );
        expect( msg.smean ).to.equal( undefined );
    } );

    it( 'resets state after flush publish', function () {
        const state = init( fullSpec( 8 ) );
        // Feed 3 samples then flush
        for ( let i = 1; i <= 3; i += 1 ) {
            const msg = Object.create( null );
            msg.x = i;
            update( state, msg );
            publishTo( state, msg );
        }
        flush( state );
        // Next update: flush publishes previous window
        const flushMsg = Object.create( null );
        flushMsg.x = 100;
        update( state, flushMsg );
        publishTo( state, flushMsg );
        expect( flushMsg.sn ).to.equal( 3 );

        // Feed another full window — should be independent
        for ( let i = 2; i <= 8; i += 1 ) {
            const msg = Object.create( null );
            msg.x = 100;
            update( state, msg );
            publishTo( state, msg );
        }
        // Window of 8 samples all equal to 100
        const lastMsg = Object.create( null );
        lastMsg.x = 0; // This is beyond the window
        update( state, lastMsg );
        // The 8th sample (100) already triggered window completion
        // Let's check: state should have reset after 8 samples
        // Actually the 8th sample was the last 100, so window completed there
        expect( state.currentCount ).to.equal( 1 ); // 0 is the first of next window
    } );

    it( 'flush always returns true', function () {
        const state = init( fullSpec( 4 ) );
        expect( flush( state ) ).to.equal( true );
    } );

    it( 'flush with n=1 publishes mean but variance is NaN', function () {
        const state = init( fullSpec( 8 ) );
        const msg1 = Object.create( null );
        msg1.x = 42;
        update( state, msg1 );
        publishTo( state, msg1 );

        flush( state );
        const msg2 = Object.create( null );
        msg2.x = 99;
        update( state, msg2 );
        publishTo( state, msg2 );
        expect( msg2.tw ).to.equal( true );
        expect( msg2.sn ).to.equal( 1 );
        expectClose( msg2.smean, 42, 1e-12, 1e-12, 'flush mean n=1' );
        // eslint-disable-next-line no-unused-expressions
        expect( msg2.svar ).to.be.NaN;
        // eslint-disable-next-line no-unused-expressions
        expect( msg2.sstd ).to.be.NaN;
    } );
} );

describe( 'twStats — disable/enable', function () {
    it( 'disabled node skips update (no accumulation)', function () {
        const state = init( fullSpec( 4 ) );
        state.disable = true;
        const msg = Object.create( null );
        msg.x = 42;
        update( state, msg );
        expect( state.n ).to.equal( 0 );
    } );

    it( 'disabled node skips publishTo', function () {
        const state = init( fullSpec( 4 ) );
        state.planPublish = true;
        state.disable = true;
        const msg = Object.create( null );
        publishTo( state, msg );
        expect( msg.smean ).to.equal( undefined );
        expect( msg.tw ).to.equal( undefined );
    } );
} );

describe( 'twStats — reset', function () {
    it( 'clears all accumulators', function () {
        const state = init( fullSpec( 4 ) );
        // Accumulate some data
        for ( let i = 1; i <= 3; i += 1 ) {
            const msg = Object.create( null );
            msg.x = i * 10;
            update( state, msg );
            publishTo( state, msg );
        }
        expect( state.n ).to.be.above( 0 );
        reset( state );
        expect( state.n ).to.equal( 0 );
        expect( state.M1 ).to.equal( 0 );
        expect( state.M2 ).to.equal( 0 );
        expect( state.M3 ).to.equal( 0 );
        expect( state.M4 ).to.equal( 0 );
        expect( state.min ).to.equal( Infinity );
        expect( state.max ).to.equal( -Infinity );
        expect( state.currentCount ).to.equal( 0 );
    } );

    it( 'is idempotent', function () {
        const state = init( fullSpec( 4 ) );
        reset( state );
        reset( state );
        expect( state.n ).to.equal( 0 );
        expect( state.currentCount ).to.equal( 0 );
    } );
} );

describe( 'twStats — recompute', function () {
    it( 'returns true (no-op)', function () {
        expect( recompute() ).to.equal( true );
    } );

    it( 'returns true even with a live state', function () {
        const state = init( fullSpec( 4 ) );
        expect( recompute( state ) ).to.equal( true );
    } );
} );

describe( 'twStats — large window', function () {
    it( 'windowSize=1000 produces correct mean', function () {
        // 1000 samples: 0, 1, 2, ..., 999
        // Mean = 499.5
        const data = [];
        for ( let i = 0; i < 1000; i += 1 ) {
            data.push( i );
        }
        const { outputs } = runNode( data, 1000, {
            mean: 'avg',
            n: 'cnt'
        } );
        expect( outputs.length ).to.equal( 1 );
        expect( outputs[ 0 ].cnt ).to.equal( 1000 );
        expectClose( outputs[ 0 ].avg, 499.5, 1e-10, 1e-10, 'large window mean' );
    } );
} );

describe( 'twStats — windowSize=4 (minimum)', function () {
    it( 'completes correctly at minimum window size', function () {
        const { outputs } = runNode( [ 10, 20, 30, 40 ], 4, {
            mean: 'avg',
            n: 'cnt',
            min: 'lo',
            max: 'hi'
        } );
        expect( outputs.length ).to.equal( 1 );
        expect( outputs[ 0 ].cnt ).to.equal( 4 );
        expectClose( outputs[ 0 ].avg, 25, 1e-12, 1e-12, 'min-window mean' );
        expect( outputs[ 0 ].lo ).to.equal( 10 );
        expect( outputs[ 0 ].hi ).to.equal( 40 );
    } );
} );

describe( 'twStats — RMS and crest factor', function () {
    // [1,2,3,4,5]: M2=10, n=5, M1=3
    // RMS = sqrt(M2/n + M1²) = sqrt(10/5 + 9) = sqrt(11) ≈ 3.3166
    // Sum of squares = 1+4+9+16+25 = 55, RMS = sqrt(55/5) = sqrt(11) ✓
    // Crest factor = max(|1|,|5|) / sqrt(11) = 5/sqrt(11) ≈ 1.5076
    const EXPECTED_RMS_5 = Math.sqrt( 11 );
    const EXPECTED_CF_5 = 5 / Math.sqrt( 11 );

    it( 'computes correct RMS for [1,2,3,4,5]', function () {
        const { outputs } = runNode( SIMPLE_5.data, 5, { rms: 'r' } );
        expect( outputs.length ).to.equal( 1 );
        expectClose( outputs[ 0 ].r, EXPECTED_RMS_5, 1e-12, 1e-12, 'rms' );
    } );

    it( 'computes correct crest factor for [1,2,3,4,5]', function () {
        const { outputs } = runNode( SIMPLE_5.data, 5, { crestFactor: 'cf' } );
        expect( outputs.length ).to.equal( 1 );
        expectClose( outputs[ 0 ].cf, EXPECTED_CF_5, 1e-12, 1e-12, 'crestFactor' );
    } );

    it( 'all-equal [7,7,7,7]: RMS=7, crestFactor=1', function () {
        const { outputs } = runNode( ALL_EQUAL.data, 4, {
            rms: 'r',
            crestFactor: 'cf'
        } );
        expectClose( outputs[ 0 ].r, 7, 1e-12, 1e-12, 'rms equal' );
        expectClose( outputs[ 0 ].cf, 1, 1e-12, 1e-12, 'crestFactor equal' );
    } );

    it( 'all-zero [0,0,0,0]: RMS=0, crestFactor=NaN', function () {
        const { outputs } = runNode( [ 0, 0, 0, 0 ], 4, {
            rms: 'r',
            crestFactor: 'cf'
        } );
        expectClose( outputs[ 0 ].r, 0, 1e-12, 1e-12, 'rms zero' );
        // eslint-disable-next-line no-unused-expressions
        expect( outputs[ 0 ].cf ).to.be.NaN;
    } );

    it( 'rms-only promotes maxMoment to 2', function () {
        const state = init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            stats: { rms: { storeAs: 'r' } }
        } );
        expect( state.maxMoment ).to.equal( 2 );
        expect( state.needsRms ).to.equal( true );
        expect( state.needsMinMax ).to.equal( false );
    } );

    it( 'crestFactor-only promotes maxMoment to 2 and sets needsMinMax', function () {
        const state = init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            stats: { crestFactor: { storeAs: 'cf' } }
        } );
        expect( state.maxMoment ).to.equal( 2 );
        expect( state.needsRms ).to.equal( true );
        expect( state.needsMinMax ).to.equal( true );
    } );

    it( 'scrubs rms and crestFactor on non-publish ticks', function () {
        const state = init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            windowSize: 4,
            stats: {
                rms: { storeAs: 'r' },
                crestFactor: { storeAs: 'cf' }
            }
        } );
        const msg = Object.create( null );
        msg.x = 1;
        update( state, msg );
        publishTo( state, msg );
        expect( msg.r ).to.equal( undefined );
        expect( msg.cf ).to.equal( undefined );
    } );

    it( 'flush with n=1 produces valid RMS', function () {
        const state = init( {
            nodeType: 'TW Stats',
            name: 'tw',
            from: { x: 'x' },
            windowSize: 8,
            stats: {
                rms: { storeAs: 'r' },
                crestFactor: { storeAs: 'cf' }
            }
        } );
        const msg1 = Object.create( null );
        msg1.x = 42;
        update( state, msg1 );
        publishTo( state, msg1 );

        flush( state );
        const msg2 = Object.create( null );
        msg2.x = 99;
        update( state, msg2 );
        publishTo( state, msg2 );
        // n=1: RMS = sqrt(0 + 42²) = 42, crestFactor = 42/42 = 1
        expect( msg2.tw ).to.equal( true );
        expectClose( msg2.r, 42, 1e-12, 1e-12, 'rms n=1' );
        expectClose( msg2.cf, 1, 1e-12, 1e-12, 'crestFactor n=1' );
    } );

    it( 'negative values: crest factor uses absolute peak', function () {
        // [-10, -20, -5, -15]: peak = |-20| = 20
        // M1 = -12.5, M2 = Σ(x-μ)² = 6.25+56.25+56.25+6.25 = 125
        // RMS = sqrt(125/4 + 156.25) = sqrt(31.25 + 156.25) = sqrt(187.5)
        // Also: sum of squares = 100+400+25+225 = 750, RMS = sqrt(750/4) = sqrt(187.5) ✓
        // CF = 20 / sqrt(187.5)
        const data = [ -10, -20, -5, -15 ];
        const expectedRms = Math.sqrt( 187.5 );
        const expectedCf = 20 / expectedRms;
        const { outputs } = runNode( data, 4, {
            rms: 'r',
            crestFactor: 'cf'
        } );
        expectClose( outputs[ 0 ].r, expectedRms, 1e-10, 1e-10, 'rms negative' );
        expectClose( outputs[ 0 ].cf, expectedCf, 1e-10, 1e-10, 'cf negative' );
    } );
} );

describe( 'twStats — Pause/Unpause control', function () {
    it( 'skips update when paused', function () {
        const state = init( fullSpec( 4 ) );

        const msg1 = Object.create( null );
        msg1.x = 10;
        update( state, msg1 );
        const nBefore = state.n;

        state.pause = true;

        const msg2 = Object.create( null );
        msg2.x = 999;
        update( state, msg2 );
        expect( state.n ).to.equal( nBefore ); // Unchanged
    } );

    it( 'publishes when paused', function () {
        const state = init( fullSpec( 5 ) );

        // Fill a full window
        for ( let i = 1; i <= 5; i += 1 ) {
            const msg = Object.create( null );
            msg.x = i;
            update( state, msg );
        }

        state.pause = true;

        // Trigger publish via next update to complete window boundary
        // Since window just completed, planPublish should be true
        state.planPublish = true;
        const output = Object.create( null );
        publishTo( state, output );
        expect( output.smean ).to.not.equal( undefined );
    } );

    it( 'pause/unpause control methods exist', function () {
        const methods = getSupportedControlMethods();
        expect( methods ).to.have.property( 'pause' );
        expect( methods ).to.have.property( 'unpause' );
    } );
} );

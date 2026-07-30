/* eslint-disable max-statements-per-line */
// test/moments-digest.specs.js
import { expect } from 'chai';
import { describe, it } from 'mocha';

// ADJUST this import to your repo layout:
import { init, update, publishTo, flush, recompute } from '../index.js';
import {
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities,
    getDSLMetadata,
    DEFAULT_OPTIONS
} from '../introspect.js';
import { gt } from './moments-digest-ground-truth.js';

// --- Helpers ---------------------------------------------------------------

/** Tolerant comparator: uses both absolute and relative tolerances */
const expectClose = function ( actual, expected, absTol, relTol, label ) {
    const a = Number( actual );
    const e = Number( expected );
    const diff = Math.abs( a - e );
    const tol = Math.max( absTol, ( relTol * Math.max( 1, Math.abs( e ) ) ) );
    if ( diff > tol ) {
        // Helpful diagnostics on failure
        throw new Error(
            `${label} | actual=${a}, expected=${e}, diff=${diff}, tol=${tol}`
        );
    }
};

// Extract digest stats from message given base field name
const pickDigest = function ( msg, base ) {
    return {
        n: msg[ `${base}_n` ],
        M1: msg[ `${base}_M1` ],
        M2: msg[ `${base}_M2` ],
        M3: msg[ `${base}_M3` ],
        M4: msg[ `${base}_M4` ],
        min: msg[ `${base}_min` ],
        max: msg[ `${base}_max` ]
    };
};

// Numeric tolerances tuned for stable double-precision pipelines.
// Rationale: higher-order moments accumulate rounding—looser relTol progressively.
const TOL = {
    n: { abs: 0,       rel: 0 },
    M1: { abs: 1e-9,    rel: 1e-10 },
    M2: { abs: 1e-6,    rel: 1e-9  },
    M3: { abs: 1e-3,    rel: 1e-8  },
    M4: { abs: 1e-1,    rel: 1e-7  },
    minmax: { abs: 1e-12,   rel: 1e-12 }
};

const compareStats = function ( actual, expected ) {
    expect( actual.n ).to.equal( expected.n );
    expectClose( actual.M1, expected.M1, TOL.M1.abs, TOL.M1.rel, 'M1' );
    expectClose( actual.M2, expected.M2, TOL.M2.abs, TOL.M2.rel, 'M2' );
    expectClose( actual.M3, expected.M3, TOL.M3.abs, TOL.M3.rel, 'M3' );
    expectClose( actual.M4, expected.M4, TOL.M4.abs, TOL.M4.rel, 'M4' );
    expectClose( actual.min, expected.min, TOL.minmax.abs, TOL.minmax.rel, 'min' );
    expectClose( actual.max, expected.max, TOL.minmax.abs, TOL.minmax.rel, 'max' );
};

// Simulate a single momentsDigest node over raw samples
const runSingleNode = function ( data, windowSize, baseField, name ) {
    const spec = {
        nodeType: 'Moments Digest',
        name,
        from: { x: baseField },
        windowSize,
        cascade: false
    };
    const state = init( spec );
    const outputs = [];
    for ( let i = 0; i < data.length; i += 1 ) {
        const msg = Object.create( null );
        msg[ baseField ] = data[ i ];
        update( state, msg );
        publishTo( state, msg );
        if ( msg[ name ] ) {
            outputs.push( pickDigest( msg, baseField ) );
        }
    }
    return outputs;
};

// Simulate a two-level cascade: raw (w=8) → cascade (w=8) → 64-sample windows
const runTwoLevelCascade = function ( data, windowSize, baseField, rawName, cascadeName ) {
    const s1 = init( {
        nodeType: 'Moments Digest',
        name: rawName,
        from: { x: baseField },
        windowSize,
        cascade: false
    } );
    const s2 = init( {
        nodeType: 'Moments Digest',
        name: cascadeName,
        from: { x: baseField },
        windowSize,
        cascade: true
    } );
    const outputs = [];

    for ( let i = 0; i < data.length; i += 1 ) {
        const msg = Object.create( null );
        msg[ baseField ] = data[ i ];

        // Level 1
        update( s1, msg );
        publishTo( s1, msg );

        // Only update level 2 when level 1 published its window digest (moments present)
        update( s2, msg );
        publishTo( s2, msg );

        if ( msg[ cascadeName ] ) {
            outputs.push( pickDigest( msg, baseField ) );
        }
    }
    return outputs;
};

// Simulate three-level (4×4×4 = 64) cascade
const runThreeLevelCascade4x = function ( data, baseField ) {
    const mk = ( name, cascade ) => init( {
        nodeType: 'Moments Digest',
        name,
        from: { x: baseField },
        windowSize: 4,
        cascade
    } );

    const s1 = mk( 'lvl1', false ); // raw 4-sample windows
    const s2 = mk( 'lvl2', true );  // aggregates 4 x lvl1 => 16
    const s3 = mk( 'lvl3', true );  // aggregates 4 x lvl2 => 64

    const outputs = [];
    for ( let i = 0; i < data.length; i += 1 ) {
        const msg = Object.create( null );
        msg[ baseField ] = data[ i ];

        // Level 1
        update( s1, msg );
        publishTo( s1, msg );

        update( s2, msg );
        publishTo( s2, msg );

        update( s3, msg );
        publishTo( s3, msg );

        if ( msg.lvl3 === true ) {
            outputs.push( {
                n: msg[ `${baseField}_n` ],
                M1: msg[ `${baseField}_M1` ],
                M2: msg[ `${baseField}_M2` ],
                M3: msg[ `${baseField}_M3` ],
                M4: msg[ `${baseField}_M4` ],
                min: msg[ `${baseField}_min` ],
                max: msg[ `${baseField}_max` ]
            } );
        }
    }
    return outputs;
};

const makeMsg = function ( x ) {
    const m = Object.create( null );
    m.x = x;
    return m;
};

// --- Tests -----------------------------------------------------------------

describe( 'momentsDigest — functional (windows & cascades)', function () {
    it( 'computes correct stats for 16 contiguous size-8 windows (single node)', function () {
        const data = gt.data;
        const expected = gt.windows.size8;

        const actual = runSingleNode( data, 8, 'x', 'raw8' );
        expect( actual.length ).to.equal( expected.length );

        for ( let i = 0; i < expected.length; i += 1 ) {
            compareStats( actual[ i ], expected[ i ] );
        }
    } );

    it( 'combines correctly at cascade level (8→8) to produce size-64 windows', function () {
        const data = gt.data;
        const expected = gt.windows.size64;

        const actual = runTwoLevelCascade( data, 8, 'x', 'raw8', 'casc8' );
        expect( actual.length ).to.equal( expected.length );

        for ( let i = 0; i < expected.length; i += 1 ) {
            compareStats( actual[ i ], expected[ i ] );
        }
    } );

    it( 'three-level 4×4×4 cascade also equals size-64 ground truth', function () {
        const data = gt.data;
        const expected = gt.windows.size64;

        const actual = runThreeLevelCascade4x( data, 'x' );
        expect( actual.length ).to.equal( expected.length );

        for ( let i = 0; i < expected.length; i += 1 ) {
            compareStats( actual[ i ], expected[ i ] );
        }
    } );
} );

describe( 'momentsDigest — publish-plan semantics', function () {
    it( 'scrubs outputs on non-publish ticks', function () {
        const s = init( { nodeType: 'Moments Digest', name: 'raw8', from: { x: 'x' }, windowSize: 8 } );
        const msg = Object.create( null );
        msg.x = 1;                 // 1st sample (no publish yet)
        update( s, msg );
        publishTo( s, msg );
        expect( msg.x_n ).to.equal( undefined );
        expect( msg.x_M1 ).to.equal( undefined );
    });

    it( 'flush BEFORE (upstream) publishes snapshot now and excludes current sample', function () {
        const s = init( { nodeType: 'Moments Digest', name: 'raw8', from: { x: 'x' }, windowSize: 8 } );
        const data = gt.data.slice( 0, 5 ); // k = 5 (< window)
        for ( let i = 0; i < data.length; i += 1 ) {
            const msg = Object.create( null );
            msg.x = data[ i ];
            update( s, msg );
            publishTo( s, msg );
        }
        // Upstream controller effect: latch before processing next message
        s.flushLatched = true;
        const msg = Object.create( null );
        msg.x = 999; // “current” sample must start the next window
        update( s, msg );
        publishTo( s, msg );
        // Published now from snapshot (k samples); current sample excluded
        expect( msg.raw8 ).to.equal( true );
        expect( msg.x_n ).to.equal( 5 );
        // And a new window has started (internal), so no double count
    });

    it( 'flush AFTER (downstream) publishes snapshot on the next tick (includes decision sample)', function () {
        const s = init( { nodeType: 'Moments Digest', name: 'raw8', from: { x: 'x' }, windowSize: 8 } );
        // Feed one sample
        let msg = Object.create( null );
        msg.x = gt.data[ 0 ];
        update( s, msg );
        publishTo( s, msg );
        // Downstream controller: latch after node has processed this tick
        s.flushLatched = true;
        // Nothing this tick:
        expect( msg.raw8 || false ).to.equal( false );

        // Next tick triggers snapshot publish (includes previous sample)
        msg = Object.create( null );
        msg.x = gt.data[ 1 ];
        update( s, msg );
        publishTo( s, msg );
        expect( msg.raw8 ).to.equal( true );
        expect( msg.x_n ).to.equal( 1 );
    });

    it( 'signal-only flush (n===0 at root) sets x_flush without stats', function () {
        const s1 = init( { nodeType: 'Moments Digest', name: 'raw8', from: { x: 'x' }, windowSize: 8 } );
        const s2 = init( { nodeType: 'Moments Digest', name: 'casc8', from: { x: 'x' }, windowSize: 8, cascade: true } );

        // Upstream: latch before any data
        s1.flushLatched = true;

        const msg = Object.create( null );
        msg.x = gt.data[ 0 ];

        update( s1, msg );
        publishTo( s1, msg );
        // Root sets x_flush, but no stats fields
        expect( msg.x_flush ).to.equal( true );
        expect( msg.x_n ).to.equal( undefined );

        // Cascade sees x_flush and should publish/reset its partial if any (here none yet)
        update( s2, msg );
        publishTo( s2, msg );
        // No stats, but no errors; behavior defined
    });

    it( 'flush tick with NaN input: publishes prior snapshot (single node)', function () {
        const s = init( { nodeType: 'Moments Digest', name: 'raw4', from: { x: 'x' }, windowSize: 4 } );

        // Two valid samples → no publish yet, but we’ll have a non-empty snapshot on flush
        let msg = makeMsg( 10 );
        update( s, msg ); publishTo( s, msg );

        msg = makeMsg( 20 );
        update( s, msg ); publishTo( s, msg );

        // Latch flush BEFORE next message
        s.flushLatched = true;

        // Current input invalid; snapshot taken in prelude must still publish
        msg = makeMsg( NaN );
        update( s, msg ); publishTo( s, msg );

        expect( msg.x_flush ).to.equal( true );
        expect( msg.raw4 ).to.equal( true );
        expect( msg.x_n ).to.equal( 2 ); // from the prior snapshot
    } );
});

describe( 'momentsDigest — cascade + flush edge cases', function () {
    it( 'cascade: FLUSH BEFORE (upstream) — cascade ingests root flush snapshot then publishes', function () {
        // Root=4 (publishes on 4), Cascade=8
        const s1 = init( { nodeType: 'Moments Digest', name: 'sd0', from: { x: 'x' }, windowSize: 4 } );
        const s2 = init( { nodeType: 'Moments Digest', name: 'sd1', from: { x: 'x' }, windowSize: 8, cascade: true } );

        // Feed 4 samples → root publishes one window; cascade ingests once (n=4 partial)
        [ 10, 20, 30, 40 ].forEach( function ( v ) {
            const msg = makeMsg( v );
            update( s1, msg ); publishTo( s1, msg );
            update( s2, msg ); publishTo( s2, msg );
        } );

        // Start next root window with 1 sample (so root has n=1 partial)
        let msg = makeMsg( 50 );
        update( s1, msg ); publishTo( s1, msg );
        update( s2, msg ); publishTo( s2, msg ); // no ingest (root didn't publish)

        // Upstream controller: latch flush BEFORE processing next message
        s1.flushLatched = true;

        // On this tick: root publishes snapshot (n=1) + x_flush; cascade ingests (n=5) then publishes
        // Key invariant: cascade ingests whatever root published to prevent data loss
        msg = makeMsg( 60 );
        update( s1, msg ); publishTo( s1, msg );
        update( s2, msg ); publishTo( s2, msg );

        expect( msg.sd1 ).to.equal( true );
        expect( msg.x_n ).to.equal( 5 ); // cascade ingested root's flush snapshot (4+1=5)
    } );

    it( 'cascade: FLUSH AFTER (downstream) — cascade ingests root flush snapshot then publishes', function () {
        const s1 = init( { nodeType: 'Moments Digest', name: 'sd0', from: { x: 'x' }, windowSize: 4 } );
        const s2 = init( { nodeType: 'Moments Digest', name: 'sd1', from: { x: 'x' }, windowSize: 8, cascade: true } );

        // Seed one root window → cascade partial (n=4)
        [ 1, 2, 3, 4 ].forEach( function ( v ) {
            const msg = makeMsg( v );
            update( s1, msg ); publishTo( s1, msg );
            update( s2, msg ); publishTo( s2, msg );
        } );

        // Add 1 sample to start next root window (n=1 partial)
        let msg = makeMsg( 5 );
        update( s1, msg ); publishTo( s1, msg );
        update( s2, msg ); publishTo( s2, msg );

        // Downstream controller: latch AFTER this tick's publishTo
        s1.flushLatched = true;

        // Tick T+1: root publishes snapshot (n=1) + x_flush; cascade ingests (n=5) then publishes
        // Key invariant: cascade ingests whatever root published to prevent data loss
        msg = makeMsg( 6 );
        update( s1, msg ); publishTo( s1, msg );
        update( s2, msg ); publishTo( s2, msg );

        expect( msg.sd1 ).to.equal( true );
        expect( msg.x_n ).to.equal( 5 ); // cascade ingested root's flush snapshot (4+1=5)
    } );

    it( 'cascade: signal-only flush (root n===0) propagates x_flush; cascade publishes its partial snapshot', function () {
        const s1 = init( { nodeType: 'Moments Digest', name: 'sd0', from: { x: 'x' }, windowSize: 4 } );
        const s2 = init( { nodeType: 'Moments Digest', name: 'sd1', from: { x: 'x' }, windowSize: 8, cascade: true } );

        // Make cascade partial: complete exactly one root window (n=4) → cascade n=4 partial; root now n===0
        [ 5, 6, 7, 8 ].forEach( function ( v ) {
            const msg = makeMsg( v );
            update( s1, msg ); publishTo( s1, msg );
            update( s2, msg ); publishTo( s2, msg );
        } );

        // Upstream: latch flush BEFORE next message while root is empty
        s1.flushLatched = true;

        // On this tick: root emits x_flush WITHOUT stats; cascade publishes its partial snapshot (n=4)
        const msg = makeMsg( 9 );
        update( s1, msg ); publishTo( s1, msg );
        update( s2, msg ); publishTo( s2, msg );

        expect( msg.x_flush ).to.equal( true );  // root propagated flush
        expect( msg.sd1 ).to.equal( true );      // cascade published
        expect( msg.x_n ).to.equal( 4 );         // cascade's partial
    } );

    describe( 'Field-keying support', function () {
        it( 'accepts direct windowSize value', function () {
            const state = init( {
                nodeType: 'Moments Digest',
                name: 'test',
                from: { x: 'temperature' },
                windowSize: 50
            } );

            expect( state.windowSize ).to.equal( 50 );
        } );

        it( 'uses default windowSize when not specified', function () {
            const state = init( {
                nodeType: 'Moments Digest',
                name: 'test',
                from: { x: 'temperature' }
            } );

            expect( state.windowSize ).to.equal( 100 );  // DEFAULT_OPTIONS.windowSize
        } );

        it( 'accepts a field-keyed windowSize, resolving the node\'s field', function () {
            const state = init( {
                nodeType: 'Moments Digest',
                name: 'test',
                from: { x: 'temperature' },
                windowSize: { temperature: 50, pressure: 80 }
            } );

            expect( state.windowSize ).to.equal( 50 );
        } );

        it( 'rejects a field-keyed windowSize whose entry is below the minimum', function () {
            expect( () => init( {
                nodeType: 'Moments Digest',
                name: 'test',
                from: { x: 'temperature' },
                windowSize: { temperature: 2 }  // below min 4
            } ) ).to.throw();
        } );

        it( 'accepts direct cascade value', function () {
            const state = init( {
                nodeType: 'Moments Digest',
                name: 'test',
                from: { x: 'temperature' },
                cascade: true
            } );

            // cascade is stored as isCascading
            expect( state.isCascading ).to.equal( true );
        } );

        it( 'uses default cascade when not specified', function () {
            const state = init( {
                nodeType: 'Moments Digest',
                name: 'test',
                from: { x: 'temperature' }
            } );

            // cascade is stored as isCascading, default is false
            expect( state.isCascading ).to.equal( false );
        } );
    } );
} );

describe( 'momentsDigest — flush function', function () {
    it( 'returns true for non-cascading node and latches flush', function () {
        const state = init( {
            nodeType: 'Moments Digest',
            name: 'test',
            from: { x: 'x' },
            windowSize: 8,
            cascade: false
        } );

        const result = flush( state );
        expect( result ).to.equal( true );
        expect( state.flushLatched ).to.equal( true );
    } );

    it( 'returns false for cascading node (cannot flush directly)', function () {
        const state = init( {
            nodeType: 'Moments Digest',
            name: 'cascadeNode',
            from: { x: 'x' },
            windowSize: 8,
            cascade: true
        } );

        const result = flush( state );
        expect( result ).to.equal( false );
        expect( state.flushLatched ).to.not.equal( true );
    } );
} );

describe( 'momentsDigest — recompute function', function () {
    it( 'returns true (no recomputation needed for stats digest)', function () {
        const state = init( {
            nodeType: 'Moments Digest',
            name: 'test',
            from: { x: 'x' },
            windowSize: 8
        } );

        // Feed some data
        const msg = Object.create( null );
        msg.x = 42;
        update( state, msg );

        const result = recompute( state );
        expect( result ).to.equal( true );
    } );

    it( 'returns true even with no data', function () {
        const state = init( {
            nodeType: 'Moments Digest',
            name: 'empty',
            from: { x: 'x' },
            windowSize: 4
        } );

        const result = recompute( state );
        expect( result ).to.equal( true );
    } );
} );

describe( 'momentsDigest — introspect functions', function () {
    it( 'getSupportedStats returns array of stat names', function () {
        const stats = getSupportedStats();
        expect( stats ).to.be.an( 'array' );
        expect( stats ).to.include( 'n' );
        expect( stats ).to.include( 'M1' );
        expect( stats ).to.include( 'M2' );
        expect( stats ).to.include( 'M3' );
        expect( stats ).to.include( 'M4' );
        expect( stats ).to.include( 'min' );
        expect( stats ).to.include( 'max' );
    } );

    it( 'getSupportedStats returns a safe copy', function () {
        const stats1 = getSupportedStats();
        stats1.push( '__mutation__' );
        const stats2 = getSupportedStats();
        expect( stats2 ).to.not.include( '__mutation__' );
    } );

    it( 'getStatDescriptions returns descriptions for all stats', function () {
        const desc = getStatDescriptions();
        expect( desc ).to.be.an( 'object' );
        expect( desc.n ).to.be.a( 'string' );
        expect( desc.M1 ).to.be.a( 'string' );
        expect( desc.M2 ).to.be.a( 'string' );
    } );

    it( 'getStatDescriptions returns a safe copy', function () {
        const desc1 = getStatDescriptions();
        desc1.custom = '__mutation__';
        const desc2 = getStatDescriptions();
        expect( desc2.custom ).to.equal( undefined );
    } );

    it( 'getSupportedControlMethods returns control methods', function () {
        const methods = getSupportedControlMethods();
        expect( methods ).to.be.an( 'object' );
        expect( methods.reset ).to.be.a( 'string' );
        expect( methods.enable ).to.be.a( 'string' );
        expect( methods.disable ).to.be.a( 'string' );
        expect( methods.flush ).to.be.a( 'string' );
    } );

    it( 'getSupportedControlMethods returns a safe copy', function () {
        const m1 = getSupportedControlMethods();
        m1.custom = '__mutation__';
        const m2 = getSupportedControlMethods();
        expect( m2.custom ).to.equal( undefined );
    } );

    it( 'getNodeType returns correct type', function () {
        const type = getNodeType();
        expect( type ).to.equal( 'Moments Digest' );
    } );

    it( 'getCapabilities returns capabilities object', function () {
        const caps = getCapabilities();
        expect( caps ).to.be.an( 'object' );
        expect( caps.description ).to.be.a( 'string' );
        expect( caps.features ).to.be.an( 'array' );
        expect( caps.features.length ).to.be.greaterThan( 0 );
    } );

    it( 'getCapabilities returns a safe copy', function () {
        const caps1 = getCapabilities();
        caps1.features.push( '__mutation__' );
        caps1.custom = '__mutation__';
        const caps2 = getCapabilities();
        expect( caps2.features ).to.not.include( '__mutation__' );
        expect( caps2.custom ).to.equal( undefined );
    } );

    it( 'getDSLMetadata returns metadata with specSchema and buildSpec', function () {
        const meta = getDSLMetadata();
        expect( meta ).to.be.an( 'object' );
        expect( meta.specSchema ).to.be.an( 'object' );
        expect( meta.buildSpec ).to.be.a( 'function' );
    } );

    it( 'getDSLMetadata.buildSpec creates valid spec', function () {
        const meta = getDSLMetadata();
        const spec = meta.buildSpec( 'myNode', 'temperature', { windowSize: 50 } );
        expect( spec.nodeType ).to.equal( 'Moments Digest' );
        expect( spec.name ).to.equal( 'myNode' );
        expect( spec.from.x ).to.equal( 'temperature' );
        expect( spec.windowSize ).to.equal( 50 );
    } );

    it( 'DEFAULT_OPTIONS has expected defaults', function () {
        expect( DEFAULT_OPTIONS.windowSize ).to.equal( 100 );
        expect( DEFAULT_OPTIONS.cascade ).to.equal( false );
    } );
} );

describe( 'momentsDigest — Pause/Unpause control', function () {
    it( 'skips update when paused', function () {
        const state = init( {
            nodeType: 'Moments Digest',
            name: 'pauseTest',
            from: { x: 'x' },
            windowSize: 8
        } );

        const msg1 = Object.create( null );
        msg1.x = 42;
        update( state, msg1 );
        const countAfterFirst = state.count;

        state.pause = true;

        const msg2 = Object.create( null );
        msg2.x = 99;
        update( state, msg2 );

        expect( state.count ).to.equal( countAfterFirst );
    } );

    it( 'publishes when paused', function () {
        const state = init( {
            nodeType: 'Moments Digest',
            name: 'pausePub',
            from: { x: 'x' },
            windowSize: 4
        } );

        // Fill one complete window so there is something to publish
        for ( let i = 0; i < 4; i += 1 ) {
            const msg = Object.create( null );
            msg.x = 10 + i;
            update( state, msg );
        }

        state.pause = true;

        const output = Object.create( null );
        publishTo( state, output );

        expect( output.x_n ).to.not.equal( undefined );
    } );

    it( 'pause/unpause control methods exist', function () {
        const methods = getSupportedControlMethods();
        expect( methods ).to.have.property( 'pause' );
        expect( methods ).to.have.property( 'unpause' );
    } );
} );

// nodes/sw-stats/test.js

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import * as swStats from '../index.js';
import * as swIntrospect from '../introspect.js';

const EPS_STRICT = 1e-12;
const EPS_RELAX  = 1e-6;
const EPS_ID     = 1e-9;

const msgWith = function ( fieldName, value ) {
    return { [ fieldName ]: value };
}; // msgWith()

const close = function ( actual, expected, eps = EPS_STRICT ) {
    return ( Number.isFinite( actual ) &&
             Number.isFinite( expected ) &&
             Math.abs( actual - expected ) <= eps );
}; // close()

const PRECOMP = {
    // eslint-disable-next-line camelcase
    one_to_five: {
        seq: [ 1, 2, 3, 4, 5 ],
        mean: 3.0,
        variance: 2.5,
        stdev: 1.5811388300841898,
        rms: 3.3166247903554
    },
    symm: {
        seq: [ -2, -1, 0, 1, 2 ],
        mean: 0.0,
        variance: 2.5,
        stdev: 1.5811388300841898,
        rms: 1.4142135623730951
    },
    mixed: {
        seq: [ 2, 8, -3, 4, 10 ],
        mean: 4.2,
        variance: 26.2,
        stdev: 5.118593556827891,
        rms: 6.212889826803627
    },
    // eslint-disable-next-line camelcase
    all_equal: {
        seq: [ 7, 7, 7, 7, 7 ],
        mean: 7.0,
        variance: 0.0,
        stdev: 0.0,
        rms: 7.0
    },
    floating: {
        seq: [ 0.1, -0.2, 0.3, -0.4, 0.5 ],
        mean: 0.06,
        variance: 0.133,
        stdev: 0.3646916505762094,
        rms: 0.33166247903554
    }
}; // PRECOMP

const buildSpec = function ( windowSize, statsWanted, fieldName = 'value', nodeName = 'sw_stats_test' ) {
    return {
        nodeType: 'SW Stats',
        name: nodeName,
        from: { x: fieldName },
        x: fieldName,
        windowSize,
        stats: Object.fromEntries( statsWanted.map( ( s ) => ( [ s, { storeAs: `${s}_out` } ] ) ) )
    };
}; // buildSpec()

describe( 'sw-stats: structure and behavior', function () {
    const fieldName = 'value';
    const N = 5;
    let state;

    beforeEach( function () {
        const spec = buildSpec(
            N,
            [ 'mean', 'variance', 'stdev', 'skewness', 'kurtosis', 'rms' ],
            fieldName
        );
        state = swStats.init( spec );
        expect( state ).to.be.an( 'object' );
        expect( state.disable ).to.equal( false );
        expect( state.inputValidationFailed ).to.equal( false );
        expect( state.ring ).to.be.an( 'object' );
    } );

    it( 'should not publish during warm-up (window not full)', function () {
        const msg = Object.create( null );
        [ 1, 2, 3 ].forEach( ( v ) => swStats.update( state, msgWith( fieldName, v ) ) );
        swStats.publishTo( state, msg );
        expect( Object.keys( msg ) ).to.have.lengthOf( 0 );
    } );

    it( 'computes SAMPLE stats for a full window (1..5)', function () {
        const { seq, mean, variance, stdev, rms } = PRECOMP.one_to_five;
        seq.forEach( ( v ) => swStats.update( state, msgWith( fieldName, v ) ) );

        const msg = Object.create( null );
        swStats.publishTo( state, msg );

        expect( close( msg.mean_out, mean, 1e-12 ) ).to.equal( true );
        expect( close( msg.variance_out, variance, 1e-12 ) ).to.equal( true );
        expect( close( msg.stdev_out, stdev, 1e-12 ) ).to.equal( true );
        expect( close( msg.rms_out, rms, 1e-12 ) ).to.equal( true );

        expect( close( ( msg.stdev_out * msg.stdev_out ), msg.variance_out, EPS_ID ) ).to.equal( true );
        const rhs = ( msg.mean_out * msg.mean_out ) + ( msg.variance_out * ( ( N - 1 ) / N ) );
        expect( close( ( msg.rms_out * msg.rms_out ), rhs, EPS_ID ) ).to.equal( true );

        expect( Number.isFinite( msg.skewness_out ) ).to.equal( true );
        expect( Math.abs( msg.skewness_out ) <= 0.2 ).to.equal( true );
        expect( Number.isFinite( msg.kurtosis_out ) ).to.equal( true );
        expect( msg.kurtosis_out >= -2.0 && msg.kurtosis_out <= 0.1 ).to.equal( true );
    } );

    it( 'evicts correctly and matches recompute()', function () {
        const { seq, mean, variance, stdev, rms } = PRECOMP.mixed;
        seq.forEach( ( v ) => swStats.update( state, msgWith( fieldName, v ) ) );

        const s1 = state.s1;
        const s2 = state.s2;
        const s3 = state.s3;
        const s4 = state.s4;

        const ok = swStats.recompute( state );
        expect( ok ).to.equal( true );

        expect( close( state.s1, s1, 1e-12 ) ).to.equal( true );
        if ( state.need2 ) expect( close( state.s2, s2, 1e-12 ) ).to.equal( true );
        if ( state.need3 ) expect( close( state.s3, s3, 1e-12 ) ).to.equal( true );
        if ( state.need4 ) expect( close( state.s4, s4, 1e-12 ) ).to.equal( true );

        const msg = Object.create( null );
        swStats.publishTo( state, msg );

        expect( close( msg.mean_out, mean, 1e-12 ) ).to.equal( true );
        expect( close( msg.variance_out, variance, 1e-10 ) ).to.equal( true );
        expect( close( msg.stdev_out, stdev, 1e-9 ) ).to.equal( true );
        expect( close( msg.rms_out, rms, 1e-12 ) ).to.equal( true );

        expect( close( ( msg.stdev_out * msg.stdev_out ), msg.variance_out, EPS_ID ) ).to.equal( true );
        {
            const rhs2 = ( msg.mean_out * msg.mean_out ) + ( msg.variance_out * ( ( N - 1 ) / N ) );
            expect( close( ( msg.rms_out * msg.rms_out ), rhs2, EPS_ID ) ).to.equal( true );
        }

        expect( Number.isFinite( msg.skewness_out ) ).to.equal( true );
        expect( msg.skewness_out >= -1.0 && msg.skewness_out <= 1.0 ).to.equal( true );
        expect( Number.isFinite( msg.kurtosis_out ) ).to.equal( true );
        expect( msg.kurtosis_out >= -2.5 && msg.kurtosis_out <= 1.0 ).to.equal( true );
    } );

    it( 'handles symmetric data (skew≈0, known kurtosis band)', function () {
        const { seq, mean, stdev } = PRECOMP.symm;
        seq.forEach( ( v ) => swStats.update( state, msgWith( fieldName, v ) ) );

        const msg = Object.create( null );
        swStats.publishTo( state, msg );

        expect( close( msg.mean_out, mean, 1e-12 ) ).to.equal( true );
        expect( close( msg.stdev_out, stdev, 1e-12 ) ).to.equal( true );

        const rhs = ( msg.mean_out * msg.mean_out ) + ( msg.variance_out * ( ( N - 1 ) / N ) );
        expect( close( ( msg.rms_out * msg.rms_out ), rhs, EPS_ID ) ).to.equal( true );

        expect( Math.abs( msg.skewness_out ) <= EPS_RELAX ).to.equal( true );
        expect( Number.isFinite( msg.kurtosis_out ) ).to.equal( true );
        expect( msg.kurtosis_out >= -2.0 && msg.kurtosis_out <= -0.1 ).to.equal( true );
    } );

    it( 'degenerate window (all equal): variance=0, skewness=0, kurtosis=-3', function () {
        const { seq, mean, variance, stdev, rms } = PRECOMP.all_equal;
        seq.forEach( ( v ) => swStats.update( state, msgWith( fieldName, v ) ) );

        const msg = Object.create( null );
        swStats.publishTo( state, msg );

        expect( close( msg.mean_out, mean, 1e-12 ) ).to.equal( true );
        expect( close( msg.variance_out, variance, 1e-12 ) ).to.equal( true );
        expect( close( msg.stdev_out, stdev, 1e-12 ) ).to.equal( true );
        expect( close( msg.skewness_out, 0, 1e-12 ) ).to.equal( true );
        expect( close( msg.kurtosis_out, -3, 1e-12 ) ).to.equal( true );
        expect( close( msg.rms_out, rms, 1e-12 ) ).to.equal( true );
    } );

    it( 'supports floats/signs', function () {
        const { seq, mean, variance, stdev, rms } = PRECOMP.floating;
        seq.forEach( ( v ) => swStats.update( state, msgWith( fieldName, v ) ) );

        const msg = Object.create( null );
        swStats.publishTo( state, msg );

        expect( close( msg.mean_out, mean, 1e-12 ) ).to.equal( true );
        expect( close( msg.variance_out, variance, 1e-12 ) ).to.equal( true );
        expect( close( msg.stdev_out, stdev, 1e-12 ) ).to.equal( true );
        expect( close( msg.rms_out, rms, 1e-12 ) ).to.equal( true );

        expect( close( ( msg.stdev_out * msg.stdev_out ), msg.variance_out, EPS_ID ) ).to.equal( true );
        {
            const rhs = ( msg.mean_out * msg.mean_out ) + ( msg.variance_out * ( ( N - 1 ) / N ) );
            expect( close( ( msg.rms_out * msg.rms_out ), rhs, EPS_ID ) ).to.equal( true );
        }

        expect( Number.isFinite( msg.skewness_out ) ).to.equal( true );
        expect( msg.skewness_out >= -1.0 && msg.skewness_out <= 1.0 ).to.equal( true );
        expect( Number.isFinite( msg.kurtosis_out ) ).to.equal( true );
        expect( msg.kurtosis_out >= -2.5 && msg.kurtosis_out <= 1.0 ).to.equal( true );
    } );

    it( 'publishes NaN when a non-finite input is observed', function () {
        PRECOMP.one_to_five.seq.forEach( ( v ) => swStats.update( state, msgWith( fieldName, v ) ) );
        swStats.update( state, msgWith( fieldName, Infinity ) );
        expect( state.inputValidationFailed ).to.equal( true );

        const msg = Object.create( null );
        swStats.publishTo( state, msg );

        const keys = [ 'mean_out', 'variance_out', 'stdev_out', 'skewness_out', 'kurtosis_out', 'rms_out' ];
        expect( Object.keys( msg ) ).to.have.members( keys );
        for ( let i = 0; i < keys.length; i += 1 ) {
            expect( Number.isNaN( msg[ keys[ i ] ] ) ).to.equal( true );
        }
    } );

    it( 'reset() clears and restarts warm-up; then publishes again when full', function () {
        PRECOMP.one_to_five.seq.forEach( ( v ) => swStats.update( state, msgWith( fieldName, v ) ) );
        const msg1 = Object.create( null );
        swStats.publishTo( state, msg1 );
        expect( Object.keys( msg1 ) ).to.have.lengthOf( 6 );

        const ok = swStats.reset( state );
        expect( ok ).to.equal( true );

        const warm = Object.create( null );
        [ 10, 10, 10, 10 ].forEach( ( v ) => swStats.update( state, msgWith( fieldName, v ) ) );
        swStats.publishTo( state, warm );
        expect( Object.keys( warm ) ).to.have.lengthOf( 0 );

        const msg2 = Object.create( null );
        swStats.update( state, msgWith( fieldName, 10 ) );
        swStats.publishTo( state, msg2 );

        expect( close( msg2.mean_out, 10, 1e-12 ) ).to.equal( true );
        expect( close( msg2.variance_out, 0, 1e-12 ) ).to.equal( true );
        expect( close( msg2.stdev_out, 0, 1e-12 ) ).to.equal( true );
        expect( close( msg2.skewness_out, 0, 1e-12 ) ).to.equal( true );
        expect( close( msg2.kurtosis_out, -3, 1e-12 ) ).to.equal( true );
        expect( close( msg2.rms_out, 10, 1e-12 ) ).to.equal( true );
    } );

    it( 'honors disable flag (no updates, no publish)', function () {
        if ( typeof swStats.disable === 'function' ) swStats.disable( state );
        else state.disable = true;

        const before = {
            s1: state.s1,
            s2: state.s2,
            s3: state.s3,
            s4: state.s4
        };

        swStats.update( state, msgWith( fieldName, 123 ) );
        expect( state.s1 ).to.equal( before.s1 );
        if ( state.need2 ) expect( state.s2 ).to.equal( before.s2 );
        if ( state.need3 ) expect( state.s3 ).to.equal( before.s3 );
        if ( state.need4 ) expect( state.s4 ).to.equal( before.s4 );

        const msg = Object.create( null );
        swStats.publishTo( state, msg );
        expect( Object.keys( msg ) ).to.have.lengthOf( 0 );

        if ( typeof swStats.enable === 'function' ) {
            swStats.enable( state );
            const msg2 = Object.create( null );
            PRECOMP.one_to_five.seq.forEach( ( v ) => swStats.update( state, msgWith( fieldName, v ) ) );
            swStats.publishTo( state, msg2 );
            expect( Object.keys( msg2 ).length > 0 ).to.equal( true );
        }
    } );

    it( 'publishes only requested stats when spec requests a subset', function () {
        const spec = buildSpec( N, [ 'mean', 'variance' ], fieldName, 'subset_node' );
        state = swStats.init( spec );

        PRECOMP.one_to_five.seq.forEach( ( v ) => swStats.update( state, msgWith( fieldName, v ) ) );

        const msg = Object.create( null );
        swStats.publishTo( state, msg );

        expect( Object.keys( msg ) ).to.have.members( [ 'mean_out', 'variance_out' ] );
        expect( msg.stdev_out ).to.equal( undefined );
        expect( msg.skewness_out ).to.equal( undefined );
        expect( msg.kurtosis_out ).to.equal( undefined );
        expect( msg.rms_out ).to.equal( undefined );
    } );

    it( 'recompute() on empty and warm-up states returns truthy and keeps sums consistent', function () {
        const emptyOk = swStats.recompute( state );
        expect( emptyOk ).to.equal( true );
        expect( state.s1 ).to.equal( 0 );
        if ( state.need2 ) expect( state.s2 ).to.equal( 0 );

        [ 5, 5, 5 ].forEach( ( v ) => swStats.update( state, msgWith( fieldName, v ) ) );
        const s1 = state.s1;
        const s2 = state.s2;
        const s3 = state.s3;
        const s4 = state.s4;

        const warmOk = swStats.recompute( state );
        expect( warmOk ).to.equal( true );
        expect( close( state.s1, s1, 1e-12 ) ).to.equal( true );
        if ( state.need2 ) expect( close( state.s2, s2, 1e-12 ) ).to.equal( true );
        if ( state.need3 ) expect( close( state.s3, s3, 1e-12 ) ).to.equal( true );
        if ( state.need4 ) expect( close( state.s4, s4, 1e-12 ) ).to.equal( true );
    } );

    it( 'reset() on a fresh state is idempotent and OK', function () {
        const spec = buildSpec( N, [ 'mean' ], fieldName, 'fresh_reset_node' );
        const fresh = swStats.init( spec );
        const ok = swStats.reset( fresh );
        expect( ok ).to.equal( true );
        expect( fresh.s1 ).to.equal( 0 );
        if ( fresh.need2 ) expect( fresh.s2 ).to.equal( 0 );
    } );

    it( 'recompute() with mean-only spec works and skips higher moments', function () {
        const spec = buildSpec( N, [ 'mean' ], fieldName, 'mean_only_node' );
        const st = swStats.init( spec );
        [ 3, 6, 9, 12, 15 ].forEach( ( v ) => swStats.update( st, msgWith( fieldName, v ) ) );

        const ok = swStats.recompute( st );
        expect( ok ).to.equal( true );

        const msg = Object.create( null );
        swStats.publishTo( st, msg );
        expect( close( msg.mean_out, 9, 1e-12 ) ).to.equal( true );
        expect( msg.variance_out ).to.equal( undefined );
    } );

    // Coverage: init default window size path
    it( 'init() applies default windowSize = 10 when not provided', function () {
        const specNoWin = {
            nodeType: 'SW Stats',
            name: 'default_win',
            from: { x: fieldName },
            x: fieldName,
            stats: {
                mean: { storeAs: 'mean_out' },
                variance: { storeAs: 'variance_out' },
                stdev: { storeAs: 'stdev_out' },
                rms: { storeAs: 'rms_out' }
            }
        };
        const st = swStats.init( specNoWin );

        for ( let i = 1; i <= 9; i += 1 ) {
            swStats.update( st, msgWith( fieldName, i ) );
        }
        const warm = Object.create( null );
        swStats.publishTo( st, warm );
        expect( Object.keys( warm ) ).to.have.lengthOf( 0 );

        swStats.update( st, msgWith( fieldName, 10 ) );
        const msg = Object.create( null );
        swStats.publishTo( st, msg );

        const mean = 5.5;
        const varianceSample = 9.166666666666666;
        const stdevSample = Math.sqrt( varianceSample );
        const rms = Math.sqrt( 38.5 );

        expect( close( msg.mean_out, mean, 1e-12 ) ).to.equal( true );
        expect( close( msg.variance_out, varianceSample, 1e-12 ) ).to.equal( true );
        expect( close( msg.stdev_out, stdevSample, 1e-12 ) ).to.equal( true );
        expect( close( msg.rms_out, rms, 1e-12 ) ).to.equal( true );

        const rhs = ( msg.mean_out * msg.mean_out ) + ( msg.variance_out * ( ( 10 - 1 ) / 10 ) );
        expect( close( ( msg.rms_out * msg.rms_out ), rhs, EPS_ID ) ).to.equal( true );
    } );

    // Coverage: recompute with need2=true, need3/need4=false
    it( 'recompute() with variance-only spec (need2=true, need3=false, need4=false)', function () {
        const spec = buildSpec( N, [ 'variance' ], fieldName, 'variance_only_node' );
        const st = swStats.init( spec );
        PRECOMP.one_to_five.seq.forEach( ( v ) => swStats.update( st, msgWith( fieldName, v ) ) );

        const ok = swStats.recompute( st );
        expect( ok ).to.equal( true );

        const msg = Object.create( null );
        swStats.publishTo( st, msg );

        expect( close( msg.variance_out, PRECOMP.one_to_five.variance, 1e-12 ) ).to.equal( true );
        expect( msg.mean_out ).to.equal( undefined );
        expect( msg.stdev_out ).to.equal( undefined );
        expect( msg.skewness_out ).to.equal( undefined );
        expect( msg.kurtosis_out ).to.equal( undefined );
        expect( msg.rms_out ).to.equal( undefined );
    } );

    // Coverage: introspect default store mapping tail
    it( 'introspect.createSmartStoreAs() defaults storeAs to the stat name', function () {
        if ( typeof swIntrospect.createSmartStoreAs !== 'function' ) return;

        const store = swIntrospect.createSmartStoreAs( {
            stats: {
                mean: {},
                variance: {}
            }
        } );
        expect( store ).to.be.an( 'object' );
        expect( store.mean ).to.equal( 'mean' );
        expect( store.variance ).to.equal( 'variance' );
    } );

    // Coverage: bump enable()/disable() exported helpers if present
    it( 'enable()/disable() helpers toggle state.disable when exported', function () {
        if ( typeof swStats.disable !== 'function' || typeof swStats.enable !== 'function' ) return;

        const spec = buildSpec( N, [ 'mean' ], fieldName, 'toggle_node' );
        const st = swStats.init( spec );

        swStats.disable( st );
        expect( st.disable ).to.equal( true );
        const msg1 = Object.create( null );
        [ 1, 2, 3, 4, 5 ].forEach( ( v ) => swStats.update( st, msgWith( fieldName, v ) ) );
        swStats.publishTo( st, msg1 );
        expect( Object.keys( msg1 ) ).to.have.lengthOf( 0 );

        swStats.enable( st );
        expect( st.disable ).to.equal( false );
        const msg2 = Object.create( null );
        [ 1, 2, 3, 4, 5 ].forEach( ( v ) => swStats.update( st, msgWith( fieldName, v ) ) );
        swStats.publishTo( st, msg2 );
        expect( Object.keys( msg2 ) ).to.have.lengthOf( 1 );
    } );

    describe( 'Field-keying support', function () {
        it( 'accepts direct windowSize value', function () {
            const fkState = swStats.init( {
                nodeType: 'SW Stats',
                name: 'test',
                from: { x: 'temperature' },
                windowSize: 20,
                stats: { mean: { storeAs: 'avg' } }
            } );

            // windowSize is stored in ring.size
            expect( fkState.ring.size ).to.equal( 20 );
        } );

        it( 'uses default windowSize when not specified', function () {
            const fkState = swStats.init( {
                nodeType: 'SW Stats',
                name: 'test',
                from: { x: 'temperature' },
                stats: { mean: { storeAs: 'avg' } }
            } );

            // windowSize is stored in ring.size, default is 10
            expect( fkState.ring.size ).to.equal( 10 );
        } );

        it( 'accepts a field-keyed windowSize, resolving the node\'s field', function () {
            const fkState = swStats.init( {
                nodeType: 'SW Stats',
                name: 'test',
                from: { x: 'temperature' },
                windowSize: { temperature: 20, pressure: 30 },
                stats: { mean: { storeAs: 'avg' } }
            } );

            // resolves the 'temperature' entry → ring.size 20
            expect( fkState.ring.size ).to.equal( 20 );
        } );

        it( 'rejects a field-keyed windowSize whose entry is below the minimum', function () {
            expect( () => swStats.init( {
                nodeType: 'SW Stats',
                name: 'test',
                from: { x: 'temperature' },
                windowSize: { temperature: 2 },  // below min 4
                stats: { mean: { storeAs: 'avg' } }
            } ) ).to.throw();
        } );

        it( 'windowSize affects buffer capacity', function () {
            const fkState = swStats.init( {
                nodeType: 'SW Stats',
                name: 'test',
                from: { x: 'temperature' },
                windowSize: 5,
                stats: { mean: { storeAs: 'avg' } }
            } );

            // Fill beyond window size
            [ 1, 2, 3, 4, 5, 6, 7, 8 ].forEach( ( v ) => {
                swStats.update( fkState, { temperature: v } );
            } );

            // ring.used should be equal to windowSize (capped at 5)
            expect( fkState.ring.used ).to.equal( 5 );
        } );
    } );

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused', function () {
            const spec = buildSpec( N, [ 'mean' ], fieldName, 'pause_test' );
            const st = swStats.init( spec );

            PRECOMP.one_to_five.seq.forEach( ( v ) => swStats.update( st, msgWith( fieldName, v ) ) );
            const s1Before = st.s1;

            st.pause = true;

            swStats.update( st, msgWith( fieldName, 999 ) );
            expect( st.s1 ).to.equal( s1Before ); // Unchanged
        } );

        it( 'publishes when paused', function () {
            const spec = buildSpec( N, [ 'mean' ], fieldName, 'pause_pub' );
            const st = swStats.init( spec );

            PRECOMP.one_to_five.seq.forEach( ( v ) => swStats.update( st, msgWith( fieldName, v ) ) );

            st.pause = true;

            const msg = Object.create( null );
            swStats.publishTo( st, msg );
            expect( msg.mean_out ).to.not.equal( undefined );
        } );

        it( 'pause/unpause control methods exist', function () {
            const methods = swIntrospect.getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );
    } );
} );

describe( 'sw-stats — introspect functions', function () {
    it( 'getSupportedStats returns array of stat names', function () {
        const stats = swIntrospect.getSupportedStats();
        expect( stats ).to.be.an( 'array' );
        expect( stats ).to.include( 'mean' );
        expect( stats ).to.include( 'variance' );
        expect( stats ).to.include( 'stdev' );
        expect( stats ).to.include( 'skewness' );
        expect( stats ).to.include( 'kurtosis' );
        expect( stats ).to.include( 'rms' );
    } );

    it( 'getSupportedStats returns a safe copy', function () {
        const stats1 = swIntrospect.getSupportedStats();
        stats1.push( '__mutation__' );
        const stats2 = swIntrospect.getSupportedStats();
        expect( stats2 ).to.not.include( '__mutation__' );
    } );

    it( 'getStatDescriptions returns descriptions for all stats', function () {
        const desc = swIntrospect.getStatDescriptions();
        expect( desc ).to.be.an( 'object' );
        expect( desc.mean ).to.be.a( 'string' );
        expect( desc.variance ).to.be.a( 'string' );
        expect( desc.stdev ).to.be.a( 'string' );
    } );

    it( 'getStatDescriptions returns a safe copy', function () {
        const desc1 = swIntrospect.getStatDescriptions();
        desc1.custom = '__mutation__';
        const desc2 = swIntrospect.getStatDescriptions();
        expect( desc2.custom ).to.equal( undefined );
    } );

    it( 'getSupportedControlMethods returns control methods', function () {
        const methods = swIntrospect.getSupportedControlMethods();
        expect( methods ).to.be.an( 'object' );
        expect( methods.reset ).to.be.a( 'string' );
        expect( methods.enable ).to.be.a( 'string' );
        expect( methods.disable ).to.be.a( 'string' );
    } );

    it( 'getSupportedControlMethods returns a safe copy', function () {
        const m1 = swIntrospect.getSupportedControlMethods();
        m1.custom = '__mutation__';
        const m2 = swIntrospect.getSupportedControlMethods();
        expect( m2.custom ).to.equal( undefined );
    } );

    it( 'getNodeType returns correct type', function () {
        const type = swIntrospect.getNodeType();
        expect( type ).to.equal( 'SW Stats' );
    } );

    it( 'getCapabilities returns capabilities object', function () {
        const caps = swIntrospect.getCapabilities();
        expect( caps ).to.be.an( 'object' );
        expect( caps.description ).to.be.a( 'string' );
        expect( caps.features ).to.be.an( 'array' );
        expect( caps.features.length ).to.be.greaterThan( 0 );
    } );

    it( 'getCapabilities returns a safe copy', function () {
        const caps1 = swIntrospect.getCapabilities();
        caps1.features.push( '__mutation__' );
        caps1.custom = '__mutation__';
        const caps2 = swIntrospect.getCapabilities();
        expect( caps2.features ).to.not.include( '__mutation__' );
        expect( caps2.custom ).to.equal( undefined );
    } );

    it( 'getDSLMetadata returns metadata with specSchema and buildSpec', function () {
        const meta = swIntrospect.getDSLMetadata();
        expect( meta ).to.be.an( 'object' );
        expect( meta.specSchema ).to.be.an( 'object' );
        expect( meta.buildSpec ).to.be.a( 'function' );
    } );

    it( 'getDSLMetadata.buildSpec creates valid spec', function () {
        const meta = swIntrospect.getDSLMetadata();
        const spec = meta.buildSpec( 'myNode', 'temperature', { mean: { storeAs: 'avg' } }, { windowSize: 50 } );
        expect( spec.nodeType ).to.equal( 'SW Stats' );
        expect( spec.name ).to.equal( 'myNode' );
        expect( spec.from.x ).to.equal( 'temperature' );
        expect( spec.stats.mean.storeAs ).to.equal( 'avg' );
        expect( spec.windowSize ).to.equal( 50 );
    } );

    it( 'DEFAULT_OPTIONS has expected defaults', function () {
        expect( swIntrospect.DEFAULT_OPTIONS.windowSize ).to.equal( 10 );
    } );
} );

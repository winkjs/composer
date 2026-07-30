// nodes/butterworth-filter/test/butterworth-filter.specs.js

import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import init from '../init.js';
import enable from '../../../core/utils/node/enable.js';
import update from '../update.js';
import publishTo from '../publish-to.js';
import reset from '../reset.js';
import recompute from '../recompute.js';
import {
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities,
    getDSLMetadata,
    getDesignInfo,
    getPerformance,
    describe as describeFilter,
    DEFAULT_OPTIONS
} from '../introspect.js';

describe( 'Butterworth Filter Node', function () {
    // Base spec reused across tests (fc=10Hz, fs=100Hz lowpass)
    const BASE = {
        nodeType: 'Butterworth Filter',
        name: 'test',
        from: { x: 'signal' },
        stats: { filtered: { storeAs: 'out' } },
        sampleRateHz: 100,
        cutoffHz: 10
    };

    describe( 'init()', function () {
        it( 'initializes with cutoffHz', function () {
            const state = init( { ...BASE } );

            expect( state.nodeType ).to.equal( 'Butterworth Filter' );
            expect( state.x ).to.equal( 'signal' );
            expect( state.filterType ).to.equal( 'lowpass' );
            expect( state.config.cutoffHz ).to.equal( 10 );
            expect( state.config.sampleRateHz ).to.equal( 100 );
            expect( state.disable ).to.equal( false );
        } );

        it( 'initializes with settlingTimeMs', function () {
            const state = init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                settlingTimeMs: 100
            } );

            expect( state.config.intent ).to.equal( 'settling-time' );
            // settlingTimeMs=100 -> cutoffHz = 4/(2π×0.1) (see golden-truth-butterworth.py §4)
            expect( state.config.cutoffHz ).to.be.closeTo( 6.36619772367581e+00, 1e-10 );
        } );

        it( 'initializes with cutoffRatio', function () {
            const state = init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                cutoffRatio: 0.2
            } );

            expect( state.config.intent ).to.equal( 'ratio' );
            // 0.2 * 50Hz (Nyquist) = 10Hz
            expect( state.config.cutoffHz ).to.equal( 10 );
        } );

        it( 'accepts highpass filterType', function () {
            const state = init( { ...BASE, filterType: 'highpass' } );

            expect( state.filterType ).to.equal( 'highpass' );
        } );

        it( 'accepts a field-keyed filterType and cutoffHz, resolving the node\'s field', function () {
            const state = init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                filterType: { signal: 'highpass', other: 'lowpass' },
                cutoffHz: { signal: 10, other: 5 }
            } );

            expect( state.filterType ).to.equal( 'highpass' );
            expect( state.config.cutoffHz ).to.equal( 10 );
        } );

        it( 'rejects a field-keyed filterType with an unknown value', function () {
            expect( () => init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                filterType: { signal: 'bandstop' },  // not a known filter type
                cutoffHz: 10
            } ) ).to.throw();
        } );

        it( 'computes filter coefficients', function () {
            const state = init( { ...BASE } );

            // Lowpass symmetry: b0 === b2, b1 === 2*b0
            expect( state.b0 ).to.equal( state.b2 );
            expect( state.b1 ).to.equal( 2 * state.b0 );
            // Exact scipy.signal.butter values (see golden-truth-butterworth.py §4)
            expect( state.b0 ).to.be.closeTo( 6.74552738890719e-02, 1e-12 );
            expect( state.a1 ).to.be.closeTo( -1.14298050253990e+00, 1e-12 );
            expect( state.a2 ).to.be.closeTo( 4.12801598096189e-01, 1e-12 );
        } );

        it( 'initializes state variables to zero', function () {
            const state = init( { ...BASE } );

            expect( state.z1 ).to.equal( 0 );
            expect( state.z2 ).to.equal( 0 );
            expect( state.output ).to.equal( 0 );
        } );

        it( 'applies DC initialization strategy', function () {
            const state = init( { ...BASE, initStrategy: 'dc', dcEstimate: 50 } );

            // State should be initialized for DC level, not zero
            expect( state.output ).to.be.closeTo( 50, 1e-10 );
            expect( state.z1 ).to.not.equal( 0 );
            expect( state.z2 ).to.not.equal( 0 );
        } );

        it( 'maintains steady state after DC initialization', function () {
            const state = init( { ...BASE, initStrategy: 'dc', dcEstimate: 50 } );

            // Feed constant input — must hold steady (see golden-truth-butterworth.py §3)
            for ( let i = 0; i < 10; i += 1 ) {
                update( state, { signal: 50 } );
            }
            expect( state.output ).to.be.closeTo( 50, 1e-10 );
        } );

        it( 'adjusts for cascade filtering', function () {
            const cascadeState = init( { ...BASE, adjustForCascade: 2 } );

            // cascadeAdjustment = 2^(1/2-1); cutoff = 10/adj (see golden-truth-butterworth.py §4)
            expect( cascadeState.config.cutoffHz ).to.be.closeTo( 1.41421356237309e+01, 1e-10 );
            expect( cascadeState.config.cascadeAdjustment ).to.be.closeTo( 7.07106781186548e-01, 1e-12 );
            expect( cascadeState.config.intent ).to.equal( 'direct-cascade-adjusted' );
        } );

        it( 'computes performance metrics', function () {
            const state = init( { ...BASE } );

            expect( state.performance.multipliesPerSample ).to.equal( 5 );
            expect( state.performance.addsPerSample ).to.equal( 4 );
            expect( state.performance.groupDelaySamples ).to.equal( 1 );
            expect( state.performance.settlingTimeSamples ).to.equal( 3 );
        } );
    } );

    describe( 'spec validation', function () {
        it( 'rejects missing nodeType', function () {
            expect( () => init( {
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                cutoffHz: 10
            } ) ).to.throw( /nodeType/ );
        } );

        it( 'rejects missing name', function () {
            expect( () => init( {
                nodeType: 'Butterworth Filter',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                cutoffHz: 10
            } ) ).to.throw( /name/ );
        } );

        it( 'rejects missing from.x', function () {
            expect( () => init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: {},
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                cutoffHz: 10
            } ) ).to.throw( /Required field missing/ );
        } );

        it( 'rejects missing sampleRateHz', function () {
            expect( () => init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                cutoffHz: 10
            } ) ).to.throw( /sampleRateHz/ );
        } );

        it( 'rejects missing cutoff specification', function () {
            expect( () => init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100
            } ) ).to.throw( /cutoff/ );
        } );

        it( 'rejects multiple cutoff specifications', function () {
            expect( () => init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                cutoffHz: 10,
                cutoffRatio: 0.2
            } ) ).to.throw( /only one/ );
        } );

        it( 'rejects invalid filterType', function () {
            expect( () => init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                cutoffHz: 10,
                filterType: 'bandpass'
            } ) ).to.throw( /lowpass.*highpass/i );
        } );

        it( 'rejects cutoffHz at or above Nyquist', function () {
            expect( () => init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                cutoffHz: 50  // Nyquist = 50Hz
            } ) ).to.throw( /outside valid range/ );
        } );

        it( 'rejects negative cutoffHz', function () {
            expect( () => init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                cutoffHz: -10
            } ) ).to.throw( /must be positive/ );
        } );

        it( 'rejects cutoffRatio outside 0-1', function () {
            expect( () => init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                cutoffRatio: 1.5
            } ) ).to.throw( /0 and 1/ );
        } );

        it( 'rejects adjustForCascade less than 2', function () {
            expect( () => init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                cutoffHz: 10,
                adjustForCascade: 1
            } ) ).to.throw( /Minimum value is 2/ );
        } );

        it( 'rejects dcEstimate without initStrategy', function () {
            expect( () => init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                cutoffHz: 10,
                dcEstimate: 50
            } ) ).to.throw( /initStrategy.*"dc"/ );
        } );

        it( 'rejects dc initStrategy without dcEstimate', function () {
            expect( () => init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                cutoffHz: 10,
                initStrategy: 'dc'
            } ) ).to.throw( /dcEstimate.*required/ );
        } );
    } );

    describe( 'update() - lowpass filtering', function () {
        let state;

        beforeEach( function () {
            state = init( { ...BASE } );
        } );

        it( 'filters step input', function () {
            // Feed step from 0 to 1
            for ( let i = 0; i < 20; i += 1 ) {
                update( state, { signal: 1 } );
            }

            // DC passes through lowpass (see golden-truth-butterworth.py §5)
            expect( state.output ).to.be.closeTo( 1.00013479499229e+00, 1e-10 );
        } );

        it( 'smooths noisy signal', function () {
            // Feed constant + high-frequency noise
            const outputs = [];
            for ( let i = 0; i < 50; i += 1 ) {
                const noise = ( ( i % 2 ) * 2 ) - 1;  // Alternating +1/-1
                update( state, { signal: 10 + noise } );
                outputs.push( state.output );
            }

            // After settling, output near DC level (see golden-truth-butterworth.py §5)
            const lastFew = outputs.slice( -10 );
            const avg = lastFew.reduce( ( a, b ) => a + b, 0 ) / lastFew.length;
            expect( avg ).to.be.closeTo( 9.99999995438981e+00, 1e-6 );
        } );

        it( 'attenuates high frequencies', function () {
            // Feed signal well above cutoff (25Hz for 10Hz cutoff)
            const outputs = [];
            for ( let i = 0; i < 100; i += 1 ) {
                // 25Hz sine at 100Hz sample rate = 4 samples per cycle
                const input = Math.sin( ( 2 * Math.PI * 25 * i ) / 100 );
                update( state, { signal: input } );
                outputs.push( state.output );
            }

            // Output amplitude should be significantly reduced
            const lastOutputs = outputs.slice( -40 );
            const maxAmp = Math.max( ...lastOutputs.map( Math.abs ) );
            expect( maxAmp ).to.be.lessThan( 0.5 );  // Attenuated from 1.0
        } );
    } );

    describe( 'update() - highpass filtering', function () {
        let state;

        beforeEach( function () {
            state = init( { ...BASE, filterType: 'highpass' } );
        } );

        it( 'blocks DC component', function () {
            // Feed constant DC
            for ( let i = 0; i < 50; i += 1 ) {
                update( state, { signal: 10 } );
            }

            // DC should be blocked
            expect( Math.abs( state.output ) ).to.be.lessThan( 0.5 );
        } );

        it( 'passes high frequencies', function () {
            // Feed signal well above cutoff (25Hz for 10Hz cutoff)
            const outputs = [];
            for ( let i = 0; i < 100; i += 1 ) {
                // 25Hz sine at 100Hz sample rate
                const input = Math.sin( ( 2 * Math.PI * 25 * i ) / 100 );
                update( state, { signal: input } );
                outputs.push( state.output );
            }

            // Output amplitude should be close to input (slightly reduced)
            const lastOutputs = outputs.slice( -40 );
            const maxAmp = Math.max( ...lastOutputs.map( Math.abs ) );
            expect( maxAmp ).to.be.greaterThan( 0.5 );  // Mostly preserved
        } );
    } );

    describe( 'update() - invalid input handling', function () {
        let state;

        beforeEach( function () {
            state = init( { ...BASE } );
        } );

        it( 'sets inputValidationFailed for NaN', function () {
            update( state, { signal: NaN } );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed for Infinity', function () {
            update( state, { signal: Infinity } );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed for -Infinity and undefined', function () {
            update( state, { signal: -Infinity } );
            expect( state.inputValidationFailed ).to.equal( true );
            state.inputValidationFailed = false;
            update( state, {} );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'preserves filter state on invalid input', function () {
            // Process valid sample first
            update( state, { signal: 5 } );
            const z1Before = state.z1;
            const z2Before = state.z2;

            // Invalid input should not modify filter state
            update( state, { signal: NaN } );

            expect( state.z1 ).to.equal( z1Before );
            expect( state.z2 ).to.equal( z2Before );
        } );

        it( 'clears inputValidationFailed on valid input', function () {
            update( state, { signal: NaN } );
            expect( state.inputValidationFailed ).to.equal( true );

            update( state, { signal: 5 } );
            expect( state.inputValidationFailed ).to.equal( false );
        } );
    } );

    describe( 'update() - disable behavior', function () {
        let state;

        beforeEach( function () {
            state = init( { ...BASE } );
        } );

        it( 'skips processing when disabled', function () {
            state.disable = true;
            const outputBefore = state.output;

            update( state, { signal: 100 } );

            expect( state.output ).to.equal( outputBefore );
        } );

        it( 'preserves filter state when disabled', function () {
            update( state, { signal: 50 } );
            const z1Before = state.z1;

            state.disable = true;
            update( state, { signal: 100 } );

            expect( state.z1 ).to.equal( z1Before );
        } );
    } );

    describe( 'update() - numerical stability', function () {
        it( 'flushes denormals to zero', function () {
            const state = init( { ...BASE } );

            // Feed impulse then decay
            update( state, { signal: 1 } );
            for ( let i = 0; i < 200; i += 1 ) {
                update( state, { signal: 0 } );
            }

            // State should be exactly zero (denormals flushed)
            expect( state.z1 ).to.equal( 0 );
            expect( state.z2 ).to.equal( 0 );
        } );
    } );

    describe( 'field-keying support', function () {
        // Field-keyed forms (e.g. cutoffHz: { signal: 10, other: 5 }) are covered in
        // the init() describe above and pinned by the field-keyed contract test; the
        // direct-value cases below round out per-option coverage.

        it( 'accepts direct cutoffHz value', function () {
            const state = init( { ...BASE, cutoffHz: 15 } );

            expect( state.config.cutoffHz ).to.equal( 15 );
        } );

        it( 'accepts direct cutoffRatio value', function () {
            const state = init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 100,
                cutoffRatio: 0.3
            } );

            // 0.3 * 50 = 15Hz
            expect( state.config.cutoffHz ).to.equal( 15 );
        } );

        it( 'accepts direct filterType value', function () {
            const state = init( { ...BASE, filterType: 'highpass' } );

            expect( state.filterType ).to.equal( 'highpass' );
        } );

        it( 'uses default filterType when not specified', function () {
            const state = init( { ...BASE } );

            expect( state.filterType ).to.equal( DEFAULT_OPTIONS.filterType );
        } );
    } );

    describe( 'publishTo()', function () {
        let state;

        beforeEach( function () {
            state = init( { ...BASE, stats: { filtered: { storeAs: 'smoothed' } } } );
        } );

        it( 'publishes filtered output to message', function () {
            update( state, { signal: 10 } );

            const msg = {};
            publishTo( state, msg );

            expect( msg.smoothed ).to.equal( state.output );
        } );

        it( 'publishes NaN when inputValidationFailed', function () {
            update( state, { signal: NaN } );

            const msg = {};
            publishTo( state, msg );

            expect( msg.smoothed ).to.satisfy( Number.isNaN );
        } );

        it( 'does not publish when disabled', function () {
            state.disable = true;

            const msg = {};
            publishTo( state, msg );

            expect( msg.smoothed ).to.equal( undefined );
        } );
    } );

    describe( 'reset()', function () {
        let state;

        beforeEach( function () {
            state = init( { ...BASE } );
        } );

        it( 'clears delay elements', function () {
            // Process some samples
            for ( let i = 0; i < 10; i += 1 ) {
                update( state, { signal: 100 } );
            }

            expect( state.z1 ).to.not.equal( 0 );
            expect( state.z2 ).to.not.equal( 0 );

            reset( state );

            expect( state.z1 ).to.equal( 0 );
            expect( state.z2 ).to.equal( 0 );
        } );

        it( 'clears output', function () {
            update( state, { signal: 100 } );

            reset( state );

            expect( state.output ).to.equal( 0 );
        } );

        it( 're-initializes with DC estimate if provided', function () {
            const dcState = init( { ...BASE, initStrategy: 'dc', dcEstimate: 50 } );

            // Process some different values
            for ( let i = 0; i < 10; i += 1 ) {
                update( dcState, { signal: 100 } );
            }

            reset( dcState );

            // After reset, should be at DC estimate, not zero
            expect( dcState.z1 ).to.not.equal( 0 );
            expect( dcState.z2 ).to.not.equal( 0 );
            expect( dcState.output ).to.be.closeTo( 50, 1e-10 );
        } );

        it( 'DC reset produces dcEstimate on publishTo without update', function () {
            const dcState = init( { ...BASE, initStrategy: 'dc', dcEstimate: 50 } );

            // Move away from DC estimate
            for ( let i = 0; i < 10; i += 1 ) update( dcState, { signal: 100 } );
            reset( dcState );

            // publishTo without update should return dcEstimate
            const msg = {};
            publishTo( dcState, msg );
            expect( msg.out ).to.be.closeTo( 50, 1e-10 );
        } );

        it( 'non-DC reset produces 0 on publishTo without update', function () {
            for ( let i = 0; i < 10; i += 1 ) update( state, { signal: 100 } );
            reset( state );
            const msg = {};
            publishTo( state, msg );
            expect( msg.out ).to.equal( 0 );
        } );

        it( 'returns true', function () {
            const result = reset( state );
            expect( result ).to.equal( true );
        } );
    } );

    describe( 'recompute()', function () {
        let state;

        beforeEach( function () {
            state = init( { ...BASE } );
        } );

        it( 'returns true', function () {
            const result = recompute( state );
            expect( result ).to.equal( true );
        } );

        it( 'preserves filter state', function () {
            update( state, { signal: 50 } );
            const z1Before = state.z1;
            const z2Before = state.z2;

            recompute( state );

            expect( state.z1 ).to.equal( z1Before );
            expect( state.z2 ).to.equal( z2Before );
        } );
    } );

    describe( 'introspection', function () {
        it( 'getSupportedStats returns stat list', function () {
            const stats = getSupportedStats();

            expect( stats ).to.include( 'filtered' );
        } );

        it( 'getStatDescriptions returns descriptions', function () {
            const descriptions = getStatDescriptions();

            expect( descriptions.filtered ).to.equal( 'Butterworth filtered signal' );
        } );

        it( 'getSupportedControlMethods returns control methods', function () {
            const methods = getSupportedControlMethods();

            expect( methods ).to.have.property( 'reset' );
            expect( methods ).to.have.property( 'enable' );
            expect( methods ).to.have.property( 'disable' );
        } );

        it( 'getNodeType returns Butterworth Filter', function () {
            expect( getNodeType() ).to.equal( 'Butterworth Filter' );
        } );

        it( 'getCapabilities returns description and features', function () {
            const caps = getCapabilities();

            expect( caps.description ).to.equal( 'High-performance 2nd-order Butterworth filter for real-time streaming' );
            expect( caps.features ).to.have.lengthOf( 4 );
        } );

        it( 'getDSLMetadata returns specSchema', function () {
            const metadata = getDSLMetadata();

            expect( metadata.specSchema.nodeType.type ).to.equal( 'string' );
            expect( metadata.specSchema.nodeType.required ).to.equal( true );
            expect( metadata.specSchema.sampleRateHz.type ).to.equal( 'number' );
            expect( metadata.specSchema.cutoffHz.type ).to.equal( 'numberOrFieldKeyed' );
        } );

        it( 'getDSLMetadata returns buildSpec function', function () {
            const metadata = getDSLMetadata();
            const spec = metadata.buildSpec(
                'bf', 'signal',
                { filtered: { storeAs: 'out' } },
                { sampleRateHz: 100, cutoffHz: 10 }
            );

            expect( spec.nodeType ).to.equal( 'Butterworth Filter' );
            expect( spec.name ).to.equal( 'bf' );
            expect( spec.from.x ).to.equal( 'signal' );
        } );

        it( 'getDesignInfo returns filter parameters', function () {
            const state = init( { ...BASE } );

            const info = getDesignInfo( state );

            expect( info.filterType ).to.equal( 'lowpass' );
            expect( info.actualCutoffHz ).to.equal( 10 );
            expect( info.sampleRateHz ).to.equal( 100 );
            expect( info.phaseDelayMs ).to.equal( 10 );
            expect( info.settlingTimeMs ).to.equal( 30 );
        } );

        it( 'getPerformance returns metrics', function () {
            const state = init( { ...BASE } );

            const perf = getPerformance( state );

            expect( perf.multipliesPerSample ).to.equal( 5 );
            expect( perf.addsPerSample ).to.equal( 4 );
            expect( perf.groupDelaySamples ).to.equal( 1 );
            expect( perf.settlingTimeSamples ).to.equal( 3 );
        } );

        it( 'describe returns human-readable string', function () {
            const state = init( { ...BASE } );

            const desc = describeFilter( state );

            expect( desc ).to.equal( 'lowpass filter: 10.0Hz @ 100Hz (settles in ~30ms, delay ~10.0ms)' );
        } );
    } );

    describe( 'DSL buildSpec()', function () {
        it( 'builds valid spec with minimal options', function () {
            const metadata = getDSLMetadata();
            const spec = metadata.buildSpec(
                'testFilter',
                'signal',
                { filtered: { storeAs: 'out' } },
                { sampleRateHz: 100, cutoffHz: 10 }
            );

            expect( spec.nodeType ).to.equal( 'Butterworth Filter' );
            expect( spec.name ).to.equal( 'testFilter' );
            expect( spec.from.x ).to.equal( 'signal' );
            expect( spec.sampleRateHz ).to.equal( 100 );
            expect( spec.cutoffHz ).to.equal( 10 );
        } );

        it( 'builds valid spec with filterType option', function () {
            const metadata = getDSLMetadata();
            const spec = metadata.buildSpec(
                'testFilter',
                'signal',
                { filtered: { storeAs: 'out' } },
                { sampleRateHz: 100, cutoffHz: 10, filterType: 'highpass' }
            );

            expect( spec.filterType ).to.equal( 'highpass' );
        } );

        it( 'produces spec that passes validation', function () {
            const metadata = getDSLMetadata();
            const spec = metadata.buildSpec(
                'validFilter',
                'sensor',
                { filtered: { storeAs: 'out' } },
                { sampleRateHz: 100, cutoffHz: 10 }
            );

            expect( () => init( spec ) ).to.not.throw();
            const validState = init( spec );
            expect( validState.filterType ).to.equal( 'lowpass' );
            expect( validState.config.cutoffHz ).to.equal( 10 );
            expect( validState.config.sampleRateHz ).to.equal( 100 );
            expect( validState.x ).to.equal( 'sensor' );
        } );
    } );

    describe( 'edge cases', function () {
        it( 'handles very low cutoff with acceptNumericalRisk', function () {
            const state = init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 1000,
                cutoffHz: 0.1,
                acceptNumericalRisk: true
            } );

            // Should initialize without throwing
            expect( state.config.cutoffHz ).to.equal( 0.1 );
        } );

        it( 'warns on very low cutoff without acceptNumericalRisk', function () {
            const warnSpy = sinon.spy( console, 'warn' );
            try {
                init( {
                    nodeType: 'Butterworth Filter',
                    name: 'test',
                    from: { x: 'signal' },
                    stats: { filtered: { storeAs: 'out' } },
                    sampleRateHz: 1000,
                    cutoffHz: 0.4   // normalizedCutoff = 0.4/500 = 0.0008 < 0.001
                } );
                expect( warnSpy.calledOnce ).to.equal( true );
                expect( warnSpy.firstCall.args[ 0 ] ).to.include( 'Very low cutoff' );
            } finally {
                warnSpy.restore();
            }
        } );

        it( 'handles higher cutoff with adequate oversampling', function () {
            // For stability, use adequate oversampling (10x or more)
            const state = init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 1000,
                cutoffHz: 100  // 10x oversampling maintains stability
            } );

            expect( state.config.cutoffHz ).to.equal( 100 );
        } );

        it( 'handles large sample rate', function () {
            const state = init( {
                nodeType: 'Butterworth Filter',
                name: 'test',
                from: { x: 'signal' },
                stats: { filtered: { storeAs: 'out' } },
                sampleRateHz: 48000,
                cutoffHz: 1000
            } );

            expect( state.config.sampleRateHz ).to.equal( 48000 );
        } );

        it( 'preserves coefficients across many samples', function () {
            const state = init( { ...BASE } );

            const b0Initial = state.b0;
            const a1Initial = state.a1;

            // Process many samples
            for ( let i = 0; i < 1000; i += 1 ) {
                update( state, { signal: Math.sin( i * 0.1 ) } );
            }

            // Coefficients should be unchanged
            expect( state.b0 ).to.equal( b0Initial );
            expect( state.a1 ).to.equal( a1Initial );
        } );

        it( 'handles zero input', function () {
            const state = init( { ...BASE } );

            // All zero input should produce zero output
            for ( let i = 0; i < 50; i += 1 ) {
                update( state, { signal: 0 } );
            }

            expect( state.output ).to.equal( 0 );
        } );

        it( 'handles negative values', function () {
            const state = init( { ...BASE } );

            // Feed negative step
            for ( let i = 0; i < 50; i += 1 ) {
                update( state, { signal: -100 } );
            }

            // Converges to -100 (see golden-truth-butterworth.py §5)
            expect( state.output ).to.be.closeTo( -1.00000000034327e+02, 1e-6 );
        } );
    } );

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused', function () {
            const state = init( { ...BASE } );

            update( state, { signal: 50 } );
            const outputBefore = state.output;

            state.pause = true;
            update( state, { signal: 200 } );

            expect( state.output ).to.equal( outputBefore );
        } );

        it( 'publishes when paused', function () {
            const state = init( { ...BASE, stats: { filtered: { storeAs: 'smoothed' } } } );

            update( state, { signal: 50 } );

            state.pause = true;
            const msg = {};
            publishTo( state, msg );

            expect( msg.smoothed ).to.equal( state.output );
        } );

        it( 'pause/unpause control methods exist', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );
    } );

    describe( 'enable control method', function () {
        it( 'clears disable flag', function () {
            const state = init( { ...BASE } );

            state.disable = true;
            const result = enable( state );

            expect( result ).to.equal( true );
            expect( state.disable ).to.equal( false );
        } );
    } );

    describe( 'full lifecycle', function () {
        it( 'cold-start -> warm -> reset -> warm-again cycle', function () {
            const state = init( { ...BASE, stats: { filtered: { storeAs: 'smoothed' } } } );

            expect( state.output ).to.equal( 0 ); // Cold start
            // Warm up (see golden-truth-butterworth.py §5)
            for ( let i = 0; i < 30; i += 1 ) update( state, { signal: 50 } );
            expect( state.output ).to.be.closeTo( 4.99998745875272e+01, 1e-8 );
            const msg1 = {};
            publishTo( state, msg1 );
            expect( msg1.smoothed ).to.be.closeTo( 4.99998745875272e+01, 1e-8 );
            // Reset and verify
            reset( state );
            expect( state.z1 ).to.equal( 0 );
            expect( state.output ).to.equal( 0 );
            // Warm again (see golden-truth-butterworth.py §5)
            for ( let i = 0; i < 30; i += 1 ) update( state, { signal: -25 } );
            expect( state.output ).to.be.closeTo( -2.49999372937636e+01, 1e-8 );
            const msg2 = {};
            publishTo( state, msg2 );
            expect( msg2.smoothed ).to.be.closeTo( -2.49999372937636e+01, 1e-8 );
        } );
    } );
} );

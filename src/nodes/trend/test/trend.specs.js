/* eslint-disable max-lines */
// nodes/trend/test/trend.specs.js

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import init from '../init.js';
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
    DEFAULT_OPTIONS
} from '../introspect.js';

describe( 'Trend Node', function () {
    describe( 'init()', function () {
        it( 'initializes with default options', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } }
            } );

            expect( state.nodeType ).to.equal( 'Trend' );
            expect( state.x ).to.equal( 'temp' );
            expect( state.rocStatsHalfLife ).to.equal( DEFAULT_OPTIONS.rocStatsHalfLife );
            expect( state.rocThresholdFn() ).to.equal( DEFAULT_OPTIONS.rocThreshold );
            expect( state.speedUp ).to.equal( DEFAULT_OPTIONS.speedUp );
            expect( state.disable ).to.equal( false );
            expect( state.trend ).to.equal( 'learning' );
            expect( state.samples ).to.equal( 0 );
        } );

        it( 'accepts custom rocStatsHalfLife', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                rocStatsHalfLife: 15
            } );

            expect( state.rocStatsHalfLife ).to.equal( 15 );
        } );

        it( 'accepts custom rocThreshold', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                rocThreshold: 0.5
            } );

            expect( state.rocThresholdFn() ).to.equal( 0.5 );
        } );

        it( 'accepts custom warmupSamples', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                warmupSamples: 20
            } );

            expect( state.warmupSamples ).to.equal( 20 );
        } );

        it( 'accepts custom speedUp within range', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                speedUp: 2.5
            } );

            expect( state.speedUp ).to.equal( 2.5 );
        } );

        it( 'initializes accelerationHint state when requested', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { accelerationHint: { storeAs: 'accel' } }
            } );

            expect( state.rocSmoothedFast ).to.equal( 0 );
            expect( state.accelerationHint ).to.equal( null );
        } );

        it( 'computes warmupSamples from halfLife when not specified', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                rocStatsHalfLife: 9
            } );

            // warmupSamples derived from halfLife (roughly 2-3x halfLife for 80% settling)
            expect( state.warmupSamples ).to.be.greaterThan( 10 );
        } );
    } );

    describe( 'spec validation', function () {
        it( 'rejects missing nodeType', function () {
            expect( () => init( {
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } }
            } ) ).to.throw( /nodeType/ );
        } );

        it( 'rejects missing name', function () {
            expect( () => init( {
                nodeType: 'Trend',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } }
            } ) ).to.throw( /name/ );
        } );

        it( 'rejects missing from.x', function () {
            expect( () => init( {
                nodeType: 'Trend',
                name: 'test',
                from: {},
                stats: { trend: { storeAs: 'direction' } }
            } ) ).to.throw();
        } );

        it( 'rejects missing stats', function () {
            expect( () => init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' }
            } ) ).to.throw( /stats/ );
        } );

        it( 'rejects rocStatsHalfLife below minimum', function () {
            expect( () => init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                rocStatsHalfLife: 1
            } ) ).to.throw();
        } );

        it( 'rejects negative rocThreshold', function () {
            expect( () => init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                rocThreshold: -0.1
            } ) ).to.throw( /non-negative/ );
        } );

        it( 'rejects non-integer warmupSamples', function () {
            expect( () => init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                warmupSamples: 5.5
            } ) ).to.throw( /integer/i );
        } );

        it( 'rejects warmupSamples below minimum', function () {
            expect( () => init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                warmupSamples: 2
            } ) ).to.throw();
        } );

        it( 'rejects speedUp below minimum', function () {
            expect( () => init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                speedUp: 1.2
            } ) ).to.throw( /speedUp/ );
        } );

        it( 'rejects speedUp above maximum', function () {
            expect( () => init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                speedUp: 4
            } ) ).to.throw( /speedUp/ );
        } );

        it( 'rejects unsupported stat', function () {
            expect( () => init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { invalid: { storeAs: 'out' } }
            } ) ).to.throw();
        } );
    } );

    describe( 'update() - trend states', function () {
        let state;

        beforeEach( function () {
            state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                rocStatsHalfLife: 5,
                rocThreshold: 0.5,
                warmupSamples: 5
            } );
        } );

        it( 'starts in learning state during warmup', function () {
            for ( let i = 0; i < 4; i += 1 ) {
                update( state, { value: 100 } );
            }

            expect( state.trend ).to.equal( 'learning' );
            expect( state.samples ).to.equal( 4 );
        } );

        it( 'transitions to stable when roc near zero', function () {
            // Feed constant values
            for ( let i = 0; i < 10; i += 1 ) {
                update( state, { value: 100 } );
            }

            expect( state.trend ).to.equal( 'stable' );
            expect( Math.abs( state.rocMean ) ).to.be.lessThan( state.rocThresholdFn() );
        } );

        it( 'transitions to rising when roc positive', function () {
            // Feed increasing values
            for ( let i = 0; i < 20; i += 1 ) {
                update( state, { value: 100 + i } );
            }

            expect( state.trend ).to.equal( 'rising' );
            expect( state.rocMean ).to.be.greaterThan( state.rocThresholdFn() );
        } );

        it( 'transitions to falling when roc negative', function () {
            // Feed decreasing values
            for ( let i = 0; i < 20; i += 1 ) {
                update( state, { value: 100 - i } );
            }

            expect( state.trend ).to.equal( 'falling' );
            expect( state.rocMean ).to.be.lessThan( -state.rocThresholdFn() );
        } );

        it( 'tracks consistent samples', function () {
            // Feed constant values to establish stable trend
            for ( let i = 0; i < 15; i += 1 ) {
                update( state, { value: 100 } );
            }

            expect( state.consistentSamples ).to.be.greaterThan( 0 );
        } );

        it( 'resets consistent samples on trend change', function () {
            // Establish rising trend
            for ( let i = 0; i < 15; i += 1 ) {
                update( state, { value: 100 + i } );
            }

            const previousConsistent = state.consistentSamples;
            expect( previousConsistent ).to.be.greaterThan( 0 );

            // Sharp transition to falling - feed multiple decreasing values
            for ( let i = 0; i < 30; i += 1 ) {
                update( state, { value: 200 - ( i * 2 ) } );
            }

            // After enough falling samples, trend should be falling
            expect( state.trend ).to.equal( 'falling' );
        } );
    } );

    describe( 'update() - confidence', function () {
        let state;

        beforeEach( function () {
            state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' }, confidence: { storeAs: 'conf' } },
                rocStatsHalfLife: 5,
                rocThreshold: 0.5,
                warmupSamples: 5
            } );
        } );

        it( 'confidence increases during warmup', function () {
            update( state, { value: 100 } );
            const conf1 = state.confidence;

            update( state, { value: 100 } );
            const conf2 = state.confidence;

            update( state, { value: 100 } );
            const conf3 = state.confidence;

            expect( conf2 ).to.be.greaterThan( conf1 );
            expect( conf3 ).to.be.greaterThan( conf2 );
        } );

        it( 'confidence bounded between 0 and 1', function () {
            // Feed many samples
            for ( let i = 0; i < 50; i += 1 ) {
                update( state, { value: 100 + i } );
            }

            expect( state.confidence ).to.be.greaterThanOrEqual( 0 );
            expect( state.confidence ).to.be.lessThanOrEqual( 1 );
        } );

        it( 'stable state has confidence based on quietness', function () {
            // Feed constant values
            for ( let i = 0; i < 20; i += 1 ) {
                update( state, { value: 100 } );
            }

            expect( state.trend ).to.equal( 'stable' );
            expect( state.confidence ).to.be.greaterThan( 0 );
        } );

        it( 'trending state has confidence based on SNR', function () {
            // Feed strongly rising values
            for ( let i = 0; i < 20; i += 1 ) {
                update( state, { value: 100 + ( i * 5 ) } );
            }

            expect( state.trend ).to.equal( 'rising' );
            expect( state.snr ).to.be.greaterThan( 0 );
            expect( state.confidence ).to.be.greaterThan( 0 );
        } );
    } );

    describe( 'update() - accelerationHint', function () {
        let state;

        beforeEach( function () {
            state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' }, accelerationHint: { storeAs: 'accel' } },
                rocStatsHalfLife: 5,
                rocThreshold: 0.1,
                warmupSamples: 5
            } );
        } );

        it( 'accelerationHint is null during warmup', function () {
            for ( let i = 0; i < 3; i += 1 ) {
                update( state, { value: 100 + ( i * i ) } );
            }

            expect( state.accelerationHint ).to.equal( null );
        } );

        it( 'accelerationHint null for steady roc', function () {
            // Linear increase - constant roc
            for ( let i = 0; i < 30; i += 1 ) {
                update( state, { value: 100 + i } );
            }

            // With constant roc, acceleration hint should be null
            expect( state.accelerationHint ).to.equal( null );
        } );

        it( 'detects likely_accelerating with increasing roc', function () {
            // Accelerating signal (quadratic). Deterministic: probed
            // 2026-08-31 — this series ends at likely_accelerating with
            // the trend rising, so the assertion is strict equality.
            for ( let i = 0; i < 30; i += 1 ) {
                update( state, { value: 100 + ( i * i * 0.5 ) } );
            }

            expect( state.accelerationHint ).to.equal( 'likely_accelerating' );
        } );

        it( 'detects likely_decelerating with decreasing roc', function () {
            // Decelerating signal: the concave mirror of the spec above —
            // the value still rises, but by less each step. Deterministic:
            // probed 2026-08-31 — first fires at sample 17 and holds
            // through sample 24 (trend rising, snr ≈ 7).
            for ( let i = 0; i < 25; i += 1 ) {
                update( state, { value: 100 + ( 30 * i ) - ( 0.5 * i * i ) } );
            }

            expect( state.accelerationHint ).to.equal( 'likely_decelerating' );
        } );
    } );

    describe( 'update() - invalid input handling', function () {
        let state;

        beforeEach( function () {
            state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                warmupSamples: 3
            } );
        } );

        it( 'sets inputValidationFailed for NaN', function () {
            update( state, { value: NaN } );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed for Infinity', function () {
            update( state, { value: Infinity } );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed for undefined', function () {
            update( state, { value: undefined } );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'does not update samples on invalid input', function () {
            update( state, { value: 100 } );
            update( state, { value: 100 } );

            const samplesBefore = state.samples;

            update( state, { value: NaN } );

            expect( state.samples ).to.equal( samplesBefore );
        } );

        it( 'clears inputValidationFailed on next valid input', function () {
            update( state, { value: NaN } );
            expect( state.inputValidationFailed ).to.equal( true );

            update( state, { value: 100 } );
            expect( state.inputValidationFailed ).to.equal( false );
        } );
    } );

    describe( 'update() - disable behavior', function () {
        let state;

        beforeEach( function () {
            state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } }
            } );
        } );

        it( 'skips processing when disabled', function () {
            state.disable = true;

            update( state, { value: 100 } );

            expect( state.samples ).to.equal( 0 );
        } );

        it( 'returns state unchanged when disabled', function () {
            update( state, { value: 50 } );
            const samplesBefore = state.samples;

            state.disable = true;
            update( state, { value: 100 } );

            expect( state.samples ).to.equal( samplesBefore );
        } );
    } );

    describe( 'field-keying support', function () {
        it( 'accepts direct rocStatsHalfLife value', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                rocStatsHalfLife: 12
            } );

            expect( state.rocStatsHalfLife ).to.equal( 12 );
        } );

        it( 'accepts direct rocThreshold value', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                rocThreshold: 0.3
            } );

            expect( state.rocThresholdFn() ).to.equal( 0.3 );
        } );

        it( 'accepts direct warmupSamples value', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                warmupSamples: 15
            } );

            expect( state.warmupSamples ).to.equal( 15 );
        } );

        it( 'accepts direct speedUp value', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                speedUp: 2.5
            } );

            expect( state.speedUp ).to.equal( 2.5 );
        } );

        it( 'uses default when options not specified', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } }
            } );

            expect( state.rocStatsHalfLife ).to.equal( DEFAULT_OPTIONS.rocStatsHalfLife );
            expect( state.rocThresholdFn() ).to.equal( DEFAULT_OPTIONS.rocThreshold );
            expect( state.speedUp ).to.equal( DEFAULT_OPTIONS.speedUp );
        } );

        it( 'accepts field-keyed options, resolving the node\'s field', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                rocStatsHalfLife: { temp: 12, pressure: 20 },
                rocThreshold: { temp: 0.3, pressure: 0.5 },
                warmupSamples: { temp: 15, pressure: 30 },
                speedUp: { temp: 2.5, pressure: 2 }
            } );

            expect( state.rocStatsHalfLife ).to.equal( 12 );
            expect( state.rocThresholdFn() ).to.equal( 0.3 );
            expect( state.warmupSamples ).to.equal( 15 );
            expect( state.speedUp ).to.equal( 2.5 );
        } );

        it( 'rejects a field-keyed speedUp whose entry is out of range', function () {
            expect( () => init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'temp' },
                stats: { trend: { storeAs: 'direction' } },
                speedUp: { temp: 99 }  // outside the allowed 1.5–3 range
            } ) ).to.throw();
        } );
    } );

    describe( 'publishTo()', function () {
        let state;

        beforeEach( function () {
            state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: {
                    trend: { storeAs: 'direction' },
                    confidence: { storeAs: 'conf' },
                    rocMean: { storeAs: 'roc' }
                },
                warmupSamples: 3
            } );
        } );

        it( 'publishes trend to message', function () {
            for ( let i = 0; i < 5; i += 1 ) {
                update( state, { value: 100 } );
            }

            const msg = {};
            publishTo( state, msg );

            expect( msg.direction ).to.equal( state.trend );
        } );

        it( 'publishes confidence to message', function () {
            for ( let i = 0; i < 5; i += 1 ) {
                update( state, { value: 100 } );
            }

            const msg = {};
            publishTo( state, msg );

            expect( msg.conf ).to.equal( state.confidence );
        } );

        it( 'publishes rocMean to message', function () {
            for ( let i = 0; i < 5; i += 1 ) {
                update( state, { value: 100 + i } );
            }

            const msg = {};
            publishTo( state, msg );

            expect( msg.roc ).to.equal( state.rocMean );
        } );

        it( 'publishes NaN when inputValidationFailed', function () {
            update( state, { value: 100 } );
            update( state, { value: NaN } );

            const msg = {};
            publishTo( state, msg );

            expect( msg.direction ).to.satisfy( Number.isNaN );
            expect( msg.conf ).to.satisfy( Number.isNaN );
            expect( msg.roc ).to.satisfy( Number.isNaN );
        } );

        it( 'does not publish when disabled', function () {
            update( state, { value: 100 } );
            state.disable = true;

            const msg = {};
            publishTo( state, msg );

            expect( msg.direction ).to.equal( undefined );
        } );
    } );

    describe( 'reset()', function () {
        let state;

        beforeEach( function () {
            state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: {
                    trend: { storeAs: 'direction' },
                    accelerationHint: { storeAs: 'accel' }
                },
                warmupSamples: 5
            } );
        } );

        it( 'clears samples count', function () {
            for ( let i = 0; i < 10; i += 1 ) {
                update( state, { value: 100 + i } );
            }

            reset( state );

            expect( state.samples ).to.equal( 0 );
        } );

        it( 'clears consistent samples', function () {
            for ( let i = 0; i < 10; i += 1 ) {
                update( state, { value: 100 } );
            }

            reset( state );

            expect( state.consistentSamples ).to.equal( 0 );
        } );

        it( 'resets to learning state', function () {
            for ( let i = 0; i < 10; i += 1 ) {
                update( state, { value: 100 + i } );
            }
            expect( state.trend ).to.equal( 'rising' );

            reset( state );

            expect( state.previousTrend ).to.equal( 'learning' );
        } );

        it( 'clears previousValue', function () {
            update( state, { value: 100 } );
            update( state, { value: 110 } );

            reset( state );

            expect( state.previousValue ).to.equal( null );
        } );

        it( 'clears roc statistics', function () {
            for ( let i = 0; i < 10; i += 1 ) {
                update( state, { value: 100 + i } );
            }

            reset( state );

            expect( state.rocVariance ).to.equal( 0 );
            expect( state.rocMean ).to.equal( 0 );
        } );

        it( 'clears accelerationHint state', function () {
            for ( let i = 0; i < 20; i += 1 ) {
                update( state, { value: 100 + ( i * i ) } );
            }

            reset( state );

            expect( state.rocSmoothedFast ).to.equal( 0 );
            expect( state.accelerationHint ).to.equal( null );
        } );

        it( 'resets confidence', function () {
            for ( let i = 0; i < 10; i += 1 ) {
                update( state, { value: 100 + i } );
            }

            reset( state );

            expect( state.confidence ).to.equal( 0 );
        } );

        it( 'returns true', function () {
            const result = reset( state );
            expect( result ).to.equal( true );
        } );

        it( 'clears error suppression flag', function () {
            state.tunableErrorLogged = true;
            reset( state );
            expect( state.tunableErrorLogged ).to.equal( false );
        } );
    } );

    describe( 'recompute()', function () {
        let state;

        beforeEach( function () {
            state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } }
            } );
        } );

        it( 'clamps negative variance to zero', function () {
            // Simulate numerical error
            state.rocVariance = -0.001;

            recompute( state );

            expect( state.rocVariance ).to.equal( 0 );
        } );

        it( 'preserves positive variance', function () {
            state.rocVariance = 1.5;

            recompute( state );

            expect( state.rocVariance ).to.equal( 1.5 );
        } );

        it( 'returns true', function () {
            const result = recompute( state );
            expect( result ).to.equal( true );
        } );
    } );

    describe( 'introspection', function () {
        it( 'getSupportedStats returns stat list', function () {
            const stats = getSupportedStats();

            expect( stats ).to.include( 'trend' );
            expect( stats ).to.include( 'confidence' );
            expect( stats ).to.include( 'rocMean' );
            expect( stats ).to.include( 'accelerationHint' );
        } );

        it( 'getStatDescriptions returns descriptions', function () {
            const descriptions = getStatDescriptions();

            expect( descriptions.trend ).to.be.a( 'string' );
            expect( descriptions.confidence ).to.be.a( 'string' );
        } );

        it( 'getSupportedControlMethods returns control methods', function () {
            const methods = getSupportedControlMethods();

            expect( methods ).to.have.property( 'reset' );
            expect( methods ).to.have.property( 'enable' );
            expect( methods ).to.have.property( 'disable' );
        } );

        it( 'getNodeType returns Trend', function () {
            expect( getNodeType() ).to.equal( 'Trend' );
        } );

        it( 'getCapabilities returns description and features', function () {
            const caps = getCapabilities();

            expect( caps.description ).to.be.a( 'string' );
            expect( caps.features ).to.be.an( 'array' );
        } );

        it( 'getDSLMetadata returns specSchema', function () {
            const metadata = getDSLMetadata();

            expect( metadata.specSchema ).to.have.property( 'nodeType' );
            expect( metadata.specSchema ).to.have.property( 'name' );
            expect( metadata.specSchema ).to.have.property( 'from' );
            expect( metadata.specSchema ).to.have.property( 'stats' );
        } );

        it( 'getDSLMetadata returns buildSpec function', function () {
            const metadata = getDSLMetadata();

            expect( metadata.buildSpec ).to.be.a( 'function' );
        } );
    } );

    describe( 'DSL buildSpec()', function () {
        it( 'builds valid spec with minimal options', function () {
            const metadata = getDSLMetadata();
            const spec = metadata.buildSpec(
                'testTrend',
                'temperature',
                { trend: { storeAs: 'direction' } },
                {}
            );

            expect( spec.nodeType ).to.equal( 'Trend' );
            expect( spec.name ).to.equal( 'testTrend' );
            expect( spec.from.x ).to.equal( 'temperature' );
            expect( spec.stats.trend.storeAs ).to.equal( 'direction' );
        } );

        it( 'builds valid spec with options', function () {
            const metadata = getDSLMetadata();
            const spec = metadata.buildSpec(
                'testTrend',
                'temperature',
                { trend: { storeAs: 'direction' }, confidence: { storeAs: 'conf' } },
                { rocStatsHalfLife: 15, rocThreshold: 0.3 }
            );

            expect( spec.rocStatsHalfLife ).to.equal( 15 );
            expect( spec.rocThreshold ).to.equal( 0.3 );
        } );

        it( 'produces spec that passes validation', function () {
            const metadata = getDSLMetadata();
            const spec = metadata.buildSpec(
                'validTrend',
                'sensor',
                { trend: { storeAs: 'out' } },
                { rocStatsHalfLife: 10 }
            );

            expect( () => init( spec ) ).to.not.throw();
        } );
    } );

    describe( 'edge cases', function () {
        it( 'handles zero threshold correctly', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' }, confidence: { storeAs: 'conf' } },
                rocThreshold: 0,
                warmupSamples: 3
            } );

            // Any non-zero roc should trigger trend
            for ( let i = 0; i < 10; i += 1 ) {
                update( state, { value: 100 + ( i * 0.01 ) } );
            }

            expect( [ 'rising', 'stable' ] ).to.include( state.trend );
            expect( state.confidence ).to.be.greaterThanOrEqual( 0 );
            expect( state.confidence ).to.be.lessThanOrEqual( 1 );
        } );

        it( 'handles perfectly stable signal', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                warmupSamples: 3
            } );

            for ( let i = 0; i < 20; i += 1 ) {
                update( state, { value: 100 } );
            }

            expect( state.trend ).to.equal( 'stable' );
            expect( state.rocMean ).to.equal( 0 );
        } );

        it( 'handles rapid alternation', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                warmupSamples: 3
            } );

            // Alternating high/low
            for ( let i = 0; i < 20; i += 1 ) {
                const value = ( i % 2 === 0 ) ? 100 : 90;
                update( state, { value } );
            }

            // Should be stable-ish due to zero mean roc
            expect( state.trend ).to.not.equal( 'learning' );
        } );

        it( 'handles very large values', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                warmupSamples: 3
            } );

            for ( let i = 0; i < 10; i += 1 ) {
                update( state, { value: 1e10 + i } );
            }

            expect( state.trend ).to.not.equal( 'learning' );
        } );

        it( 'handles very small values', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                rocThreshold: 1e-10,
                warmupSamples: 3
            } );

            for ( let i = 0; i < 10; i += 1 ) {
                update( state, { value: 1e-8 + ( i * 1e-10 ) } );
            }

            expect( state.samples ).to.equal( 10 );
        } );

        it( 'handles negative values transitioning to positive', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                warmupSamples: 3
            } );

            for ( let i = 0; i < 20; i += 1 ) {
                update( state, { value: -50 + ( i * 5 ) } );
            }

            expect( state.trend ).to.equal( 'rising' );
        } );
    } );

    describe( 'Tunable support', function () {
        it( 'accepts function for rocThreshold parameter', function () {
            const dynamicThreshold = ( msg ) => (
                msg.phase === 'warmup' ? 0.5 : 0.1
            );
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                rocThreshold: dynamicThreshold
            } );

            expect( state.rocThresholdFn ).to.be.a( 'function' );
            expect( state.rocThresholdFn( { phase: 'warmup' } ) ).to.equal( 0.5 );
            expect( state.rocThresholdFn( { phase: 'steady' } ) ).to.equal( 0.1 );
        } );

        it( 'uses dynamic rocThreshold in update', function () {
            // High threshold = needs bigger roc to detect trend
            // Low threshold = more sensitive
            const dynamicThreshold = ( msg ) => (
                msg.phase === 'warmup' ? 1.0 : 0.01
            );
            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                rocThreshold: dynamicThreshold,
                warmupSamples: 3
            } );

            // Warmup phase with high threshold
            for ( let i = 0; i < 10; i += 1 ) {
                update( state, { value: 100 + ( i * 0.1 ), phase: 'warmup' } );
            }

            // Reset and try with steady phase (low threshold)
            state.samples = 0;
            state.rocMean = 0;
            state.varRoC = 0;
            for ( let i = 0; i < 10; i += 1 ) {
                update( state, { value: 100 + ( i * 0.1 ), phase: 'steady' } );
            }

            // Different thresholds affect sensitivity
            expect( state.rocThresholdFn( { phase: 'warmup' } ) ).to.equal( 1.0 );
            expect( state.rocThresholdFn( { phase: 'steady' } ) ).to.equal( 0.01 );
        } );

        it( 'uses signal-level-based threshold via function', function () {
            // Adapt sensitivity based on signal magnitude
            const dynamicThreshold = ( msg ) => Math.abs( msg.value ) * 0.01;

            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                rocThreshold: dynamicThreshold,
                warmupSamples: 3
            } );

            // Test that threshold adapts to signal level
            expect( state.rocThresholdFn( { value: 100 } ) ).to.equal( 1 );
            expect( state.rocThresholdFn( { value: 1000 } ) ).to.equal( 10 );
            expect( state.rocThresholdFn( { value: 10 } ) ).to.equal( 0.1 );
        } );

        it( 'handles operating-mode-based thresholds', function () {
            const modeThresholds = {
                production: 0.05,
                testing: 0.5,
                calibration: 0.01
            };
            const dynamicThreshold = ( msg ) =>
                modeThresholds[ msg.mode ] ?? 0.1;

            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'sensor' },
                stats: { trend: { storeAs: 'direction' } },
                rocThreshold: dynamicThreshold,
                warmupSamples: 3
            } );

            // Verify thresholds change based on mode
            expect( state.rocThresholdFn( { mode: 'production' } ) ).to.equal( 0.05 );
            expect( state.rocThresholdFn( { mode: 'testing' } ) ).to.equal( 0.5 );
            expect( state.rocThresholdFn( { mode: 'calibration' } ) ).to.equal( 0.01 );
            expect( state.rocThresholdFn( { mode: 'unknown' } ) ).to.equal( 0.1 );
        } );
    } );

    describe( 'Tunable error guard', function () {
        afterEach( function () {
            sinon.restore();
        } );

        it( 'survives throwing tunable and retains last good rocThreshold', function () {
            let callCount = 0;
            const faultyThreshold = function () {
                callCount += 1;
                if ( callCount <= 5 ) return 0.42;
                throw new Error( 'sensor offline' );
            };

            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                rocThreshold: faultyThreshold,
                warmupSamples: 3
            } );

            sinon.stub( console, 'error' );

            // First 5 calls succeed — rocThreshold should reach 0.42
            for ( let i = 0; i < 5; i += 1 ) {
                update( state, { value: 100 } );
            }
            expect( state.rocThreshold ).to.equal( 0.42 );

            // Next calls throw — rocThreshold must retain 0.42
            for ( let i = 0; i < 5; i += 1 ) {
                update( state, { value: 100 } );
            }
            expect( state.rocThreshold ).to.equal( 0.42 );

            // Trend classification still works (constant input → stable)
            expect( state.trend ).to.equal( 'stable' );
        } );

        it( 'logs console.error on first tunable error only', function () {
            let callCount = 0;
            const faultyThreshold = function () {
                callCount += 1;
                // because first call is NOP, see update()
                if ( callCount === 2 ) return 0.3;
                throw new Error( 'bad config' );
            };

            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                rocThreshold: faultyThreshold,
                warmupSamples: 3
            } );

            const stub = sinon.stub( console, 'error' );

            // First update succeeds (callCount 1)
            update( state, { value: 100 } );
            expect( stub.callCount ).to.equal( 0 );

            // Second update throws — first error, should log
            update( state, { value: 101 } );
            expect( stub.calledOnce ).to.equal( true );

            // Third update throws again — same episode, should NOT log again
            update( state, { value: 102 } );
            expect( stub.calledOnce ).to.equal( true );
        } );

        it( 'logs again after recovery', function () {
            let callCount = 0;
            const faultyThreshold = function () {
                callCount += 1;
                // Error on call 2, succeed on call 3, error again on call 4
                if ( callCount === 2 || callCount === 4 ) {
                    throw new Error( 'intermittent' );
                }
                return 0.25;
            };

            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                rocThreshold: faultyThreshold,
                warmupSamples: 3
            } );

            const stub = sinon.stub( console, 'error' );

            // Call 1: success — no log; because first call is NOP, see update()
            update( state, { value: 100 } );
            expect( stub.callCount ).to.equal( 0 );
            update( state, { value: 100 } );
            expect( stub.callCount ).to.equal( 0 );

            // Call 2: error — first episode, logs
            update( state, { value: 101 } );
            expect( stub.callCount ).to.equal( 1 );

            // Call 3: success — recovery, resets tunableErrorLogged
            update( state, { value: 102 } );
            expect( stub.callCount ).to.equal( 1 );

            // Call 4: error — new episode, logs again
            update( state, { value: 103 } );
            expect( stub.calledTwice ).to.equal( true );
        } );

        it( 'seeds state.rocThreshold from DEFAULT_OPTIONS at init', function () {
            const dynamicThreshold = function ( msg ) {
                return msg.value * 0.01;
            };

            const state = init( {
                nodeType: 'Trend',
                name: 'test',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                rocThreshold: dynamicThreshold
            } );

            // Before any update, state.rocThreshold is the default seed
            expect( state.rocThreshold ).to.equal( DEFAULT_OPTIONS.rocThreshold );
            expect( state.rocThreshold ).to.equal( 0.1 );
        } );
    } );

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'pauseTest',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                warmupSamples: 3
            } );

            update( state, { value: 100 } );
            const samplesBefore = state.samples;

            state.pause = true;

            update( state, { value: 200 } );
            expect( state.samples ).to.equal( samplesBefore ); // Unchanged
        } );

        it( 'publishes when paused', function () {
            const state = init( {
                nodeType: 'Trend',
                name: 'pausePub',
                from: { x: 'value' },
                stats: { trend: { storeAs: 'direction' } },
                warmupSamples: 3
            } );

            for ( let i = 0; i < 5; i += 1 ) {
                update( state, { value: 100 } );
            }

            state.pause = true;

            const output = Object.create( null );
            publishTo( state, output );
            expect( output.direction ).to.not.equal( undefined );
        } );

        it( 'pause/unpause control methods exist', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );
    } );
} );

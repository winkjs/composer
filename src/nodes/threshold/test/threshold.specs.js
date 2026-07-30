/* eslint-disable no-unused-expressions */
/* eslint-disable max-lines */
/**
 * Comprehensive test suite for threshold node.
 * Tests all modes, hysteresis, edge cases, and validation.
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { describe, it, before, afterEach } from 'mocha';
import * as threshold from '../index.js';
import {
    getDSLMetadata,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities,
    getThresholdModes
} from '../introspect.js';

// Helper function to create test messages
const createMessage = function ( values ) {
    const msg = Object.create( null );
    Object.keys( values ).forEach( ( key ) => {
        msg[ key ] = values[ key ];
    } );
    return msg;
};

describe( 'Threshold Node', function () {
    describe( 'Above mode without hysteresis', function () {
        let spec, state;

        before( function () {
            spec = {
                nodeType: 'Threshold',
                name: 'tempHigh',
                from: { x: 'temperature' },
                mode: 'above',
                threshold: 70,
                hysteresis: 0,
                stats: {
                    active: { storeAs: 'isHigh' }
                }
            };
            state = threshold.init( spec );
        } );

        it( 'stays inactive below threshold', function () {
            threshold.update( state, createMessage( { temperature: 65 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temperature: 69.9 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temperature: -100 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temperature: -Infinity } ) );
            expect( state.active ).to.equal( false );
        } );

        it( 'activates at exactly threshold', function () {
            threshold.update( state, createMessage( { temperature: 70 } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'stays active above threshold', function () {
            threshold.update( state, createMessage( { temperature: 70.1 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { temperature: 100 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { temperature: Infinity } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'deactivates immediately below threshold', function () {
            threshold.update( state, createMessage( { temperature: 69.9 } ) );
            expect( state.active ).to.equal( false );
        } );

        it( 'toggles correctly at boundary', function () {
            threshold.update( state, createMessage( { temperature: 70 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { temperature: 69.9 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temperature: 70 } ) );
            expect( state.active ).to.equal( true );
        } );
    } );

    describe( 'Above mode with hysteresis', function () {
        let spec, state;

        before( function () {
            spec = {
                nodeType: 'Threshold',
                name: 'tempHyst',
                from: { x: 'temperature' },
                mode: 'above',
                threshold: 70,
                hysteresis: 5,
                stats: {
                    active: { storeAs: 'isHigh' }
                }
            };
            state = threshold.init( spec );
        } );

        it( 'requires threshold crossing for initial activation', function () {
            threshold.update( state, createMessage( { temperature: 60 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temperature: 65 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temperature: 69.9 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temperature: 70 } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'maintains active state in deadband', function () {
            threshold.update( state, createMessage( { temperature: 68 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { temperature: 66 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { temperature: 65 } ) );
            expect( state.active ).to.equal( true ); // At reset point, still active
        } );

        it( 'deactivates below reset point', function () {
            threshold.update( state, createMessage( { temperature: 64.9 } ) );
            expect( state.active ).to.equal( false );
        } );

        it( 'requires full threshold for reactivation', function () {
            threshold.update( state, createMessage( { temperature: 65 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temperature: 68 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temperature: 69.9 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temperature: 70 } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'handles first value in deadband correctly', function () {
            const freshSpec = { ...spec, name: 'deadbandTest' };
            const freshState = threshold.init( freshSpec );

            // First value at 67 (between 65 and 70)
            threshold.update( freshState, createMessage( { temperature: 67 } ) );
            expect( freshState.active ).to.equal( false ); // Defaults to inactive
        } );

        it( 'handles first value at threshold correctly', function () {
            const freshSpec = { ...spec, name: 'thresholdTest' };
            const freshState = threshold.init( freshSpec );

            threshold.update( freshState, createMessage( { temperature: 70 } ) );
            expect( freshState.active ).to.equal( true );
        } );
    } );

    describe( 'Below mode without hysteresis', function () {
        let spec, state;

        before( function () {
            spec = {
                nodeType: 'Threshold',
                name: 'tempLow',
                from: { x: 'temperature' },
                mode: 'below',
                threshold: 32,
                hysteresis: 0,
                stats: {
                    active: { storeAs: 'isCold' }
                }
            };
            state = threshold.init( spec );
        } );

        it( 'activates below threshold', function () {
            threshold.update( state, createMessage( { temperature: 31.9 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { temperature: 0 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { temperature: -273 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { temperature: -Infinity } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'activates at exactly threshold', function () {
            threshold.update( state, createMessage( { temperature: 32 } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'deactivates above threshold', function () {
            threshold.update( state, createMessage( { temperature: 32.1 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temperature: 100 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temperature: Infinity } ) );
            expect( state.active ).to.equal( false );
        } );
    } );

    describe( 'Below mode with hysteresis', function () {
        let spec, state;

        before( function () {
            spec = {
                nodeType: 'Threshold',
                name: 'freezing',
                from: { x: 'temp' },
                mode: 'below',
                threshold: 32,
                hysteresis: 5,
                stats: {
                    active: { storeAs: 'isFreezing' }
                }
            };
            state = threshold.init( spec );
        } );

        it( 'activates at threshold', function () {
            threshold.update( state, createMessage( { temp: 40 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temp: 32 } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'stays active in deadband', function () {
            threshold.update( state, createMessage( { temp: 35 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { temp: 37 } ) );
            expect( state.active ).to.equal( true ); // At reset point
        } );

        it( 'deactivates above reset point', function () {
            threshold.update( state, createMessage( { temp: 37.1 } ) );
            expect( state.active ).to.equal( false );
        } );

        it( 'requires threshold for reactivation', function () {
            threshold.update( state, createMessage( { temp: 37 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temp: 33 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temp: 32 } ) );
            expect( state.active ).to.equal( true );
        } );
    } );

    describe( 'Inside mode without hysteresis', function () {
        let spec, state;

        before( function () {
            spec = {
                nodeType: 'Threshold',
                name: 'comfort',
                from: { x: 'temp' },
                mode: 'inside',
                min: 68,
                max: 72,
                hysteresis: 0,
                stats: {
                    active: { storeAs: 'comfortable' }
                }
            };
            state = threshold.init( spec );
        } );

        it( 'deactivates below range', function () {
            threshold.update( state, createMessage( { temp: 67.9 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temp: 0 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temp: -Infinity } ) );
            expect( state.active ).to.equal( false );
        } );

        it( 'activates at min boundary', function () {
            threshold.update( state, createMessage( { temp: 68 } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'stays active inside range', function () {
            threshold.update( state, createMessage( { temp: 70 } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'activates at max boundary', function () {
            threshold.update( state, createMessage( { temp: 72 } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'deactivates above range', function () {
            threshold.update( state, createMessage( { temp: 72.1 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temp: 100 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { temp: Infinity } ) );
            expect( state.active ).to.equal( false );
        } );
    } );

    describe( 'Inside mode with hysteresis', function () {
        let spec, state;

        before( function () {
            spec = {
                nodeType: 'Threshold',
                name: 'zone',
                from: { x: 'value' },
                mode: 'inside',
                min: 20,
                max: 30,
                hysteresis: 2,
                stats: {
                    active: { storeAs: 'inZone' }
                }
            };
            state = threshold.init( spec );
        } );

        it( 'activates when entering range', function () {
            threshold.update( state, createMessage( { value: 15 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { value: 20 } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'stays active with expanded boundaries', function () {
            threshold.update( state, createMessage( { value: 18 } ) );
            expect( state.active ).to.equal( true ); // Min - hysteresis

            threshold.update( state, createMessage( { value: 32 } ) );
            expect( state.active ).to.equal( true ); // Max + hysteresis
        } );

        it( 'deactivates outside expanded range', function () {
            threshold.update( state, createMessage( { value: 17.9 } ) );
            expect( state.active ).to.equal( false );
        } );

        it( 'requires original range for reactivation', function () {
            threshold.update( state, createMessage( { value: 18 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { value: 20 } ) );
            expect( state.active ).to.equal( true );
        } );
    } );

    describe( 'Outside mode without hysteresis', function () {
        let spec, state;

        before( function () {
            spec = {
                nodeType: 'Threshold',
                name: 'alarm',
                from: { x: 'pressure' },
                mode: 'outside',
                min: 100,
                max: 200,
                hysteresis: 0,
                stats: {
                    active: { storeAs: 'alert' }
                }
            };
            state = threshold.init( spec );
        } );

        it( 'activates below range', function () {
            threshold.update( state, createMessage( { pressure: 99.9 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { pressure: 0 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { pressure: -Infinity } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'deactivates at min boundary', function () {
            threshold.update( state, createMessage( { pressure: 100 } ) );
            expect( state.active ).to.equal( false );
        } );

        it( 'stays inactive inside range', function () {
            threshold.update( state, createMessage( { pressure: 150 } ) );
            expect( state.active ).to.equal( false );
        } );

        it( 'deactivates at max boundary', function () {
            threshold.update( state, createMessage( { pressure: 200 } ) );
            expect( state.active ).to.equal( false );
        } );

        it( 'activates above range', function () {
            threshold.update( state, createMessage( { pressure: 200.1 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { pressure: 1000 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { pressure: Infinity } ) );
            expect( state.active ).to.equal( true );
        } );
    } );

    describe( 'Outside mode with hysteresis', function () {
        let spec, state;

        before( function () {
            spec = {
                nodeType: 'Threshold',
                name: 'range',
                from: { x: 'signal' },
                mode: 'outside',
                min: 10,
                max: 90,
                hysteresis: 5,
                stats: {
                    active: { storeAs: 'outOfRange' }
                }
            };
            state = threshold.init( spec );
        } );

        it( 'activates outside range', function () {
            threshold.update( state, createMessage( { signal: 50 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { signal: 9.9 } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'stays active in lower deadband', function () {
            threshold.update( state, createMessage( { signal: 12 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { signal: 15 } ) );
            expect( state.active ).to.equal( true ); // At reset point
        } );

        it( 'deactivates inside reset boundary', function () {
            threshold.update( state, createMessage( { signal: 15.1 } ) );
            expect( state.active ).to.equal( false );
        } );

        it( 'activates above max', function () {
            threshold.update( state, createMessage( { signal: 90.1 } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'stays active in upper deadband', function () {
            threshold.update( state, createMessage( { signal: 88 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { signal: 85 } ) );
            expect( state.active ).to.equal( true ); // At reset point
        } );

        it( 'deactivates inside upper reset boundary', function () {
            threshold.update( state, createMessage( { signal: 84.9 } ) );
            expect( state.active ).to.equal( false );
        } );
    } );

    describe( 'Invalid value handling', function () {
        let spec, state;

        before( function () {
            spec = {
                nodeType: 'Threshold',
                name: 'validator',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                stats: {
                    active: { storeAs: 'state' }
                }
            };
            state = threshold.init( spec );
        } );

        it( 'ignores NaN values', function () {
            threshold.update( state, createMessage( { value: 60 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { value: NaN } ) );
            expect( state.active ).to.equal( true ); // Unchanged
        } );

        it( 'ignores string values', function () {
            threshold.update( state, createMessage( { value: 40 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { value: 'invalid' } ) );
            expect( state.active ).to.equal( false ); // Unchanged
        } );

        it( 'ignores undefined values', function () {
            threshold.update( state, createMessage( { value: 55 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { value: undefined } ) );
            expect( state.active ).to.equal( true ); // Unchanged
        } );

        it( 'ignores null values', function () {
            threshold.update( state, createMessage( { value: 45 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { value: null } ) );
            expect( state.active ).to.equal( false ); // Unchanged
        } );

        it( 'ignores object values', function () {
            threshold.update( state, createMessage( { value: 60 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { value: { temp: 70 } } ) );
            expect( state.active ).to.equal( true ); // Unchanged
        } );

        it( 'ignores array values', function () {
            threshold.update( state, createMessage( { value: 30 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { value: [ 70 ] } ) );
            expect( state.active ).to.equal( false ); // Unchanged
        } );

        it( 'ignores boolean values', function () {
            threshold.update( state, createMessage( { value: 60 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { value: true } ) );
            expect( state.active ).to.equal( true ); // Unchanged
        } );

        it( 'processes valid values after invalid', function () {
            threshold.update( state, createMessage( { value: 30 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { value: 'invalid' } ) );
            threshold.update( state, createMessage( { value: NaN } ) );
            threshold.update( state, createMessage( { value: null } ) );

            threshold.update( state, createMessage( { value: 70 } ) );
            expect( state.active ).to.equal( true ); // Processes valid value
        } );
    } );

    describe( 'Trigger execution', function () {
        it( 'executes triggers on rising edge only', function () {
            let triggerCount = 0;
            const mockTarget = Object.create( null );
            mockTarget.reset = function () {
                triggerCount += 1;
            };

            const spec = {
                nodeType: 'Threshold',
                name: 'triggerTest',
                from: { x: 'value' },
                mode: 'above',
                threshold: 100,
                stats: {
                    active: { storeAs: 'high' }
                }
            };

            const state = threshold.init( spec );
            state.resolvedTriggers = [
                {
                    control: mockTarget.reset,
                    targets: [ mockTarget ]
                }
            ];

            // Start low
            threshold.update( state, createMessage( { value: 50 } ) );
            expect( triggerCount ).to.equal( 0 );

            // Rising edge - trigger
            threshold.update( state, createMessage( { value: 101 } ) );
            expect( triggerCount ).to.equal( 1 );

            // Stay high - no trigger
            threshold.update( state, createMessage( { value: 105 } ) );
            expect( triggerCount ).to.equal( 1 );

            // Falling edge - no trigger
            threshold.update( state, createMessage( { value: 50 } ) );
            expect( triggerCount ).to.equal( 1 );

            // Rising edge again - trigger
            threshold.update( state, createMessage( { value: 101 } ) );
            expect( triggerCount ).to.equal( 2 );
        } );

        it( 'executes multiple triggers', function () {
            let count1 = 0,
                count2 = 0;
            const target1 = { reset: function () {
                count1 += 1;
            } };
            const target2 = { reset: function () {
                count2 += 1;
            } };

            const spec = {
                nodeType: 'Threshold',
                name: 'multiTrigger',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                stats: {
                    active: { storeAs: 'high' }
                }
            };

            const state = threshold.init( spec );
            state.resolvedTriggers = [
                { control: target1.reset, targets: [ target1 ] },
                { control: target2.reset, targets: [ target2 ] }
            ];

            threshold.update( state, createMessage( { value: 30 } ) );
            threshold.update( state, createMessage( { value: 60 } ) );

            expect( count1 ).to.equal( 1 );
            expect( count2 ).to.equal( 1 );
        } );

        it( 'handles empty trigger list', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'noTriggers',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                stats: {
                    active: { storeAs: 'high' }
                }
            };

            const state = threshold.init( spec );
            state.resolvedTriggers = [];

            expect( () => {
                threshold.update( state, createMessage( { value: 30 } ) );
                threshold.update( state, createMessage( { value: 60 } ) );
            } ).to.not.throw();
        } );
    } );

    describe( 'Publishing', function () {
        it( 'publishes active state', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'publisher',
                from: { x: 'temp' },
                mode: 'above',
                threshold: 70,
                stats: {
                    active: { storeAs: 'isHot' }
                }
            };

            const state = threshold.init( spec );
            threshold.update( state, createMessage( { temp: 75 } ) );

            const output = Object.create( null );
            threshold.publishTo( state, output );

            expect( output.isHot ).to.equal( true );
        } );

        it( 'publishes false state', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'publisher',
                from: { x: 'temp' },
                mode: 'above',
                threshold: 70,
                stats: {
                    active: { storeAs: 'isHot' }
                }
            };

            const state = threshold.init( spec );
            threshold.update( state, createMessage( { temp: 65 } ) );

            const output = Object.create( null );
            threshold.publishTo( state, output );

            expect( output.isHot ).to.equal( false );
        } );

        it( 'uses custom storeAs field', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'custom',
                from: { x: 'pressure' },
                mode: 'outside',
                min: 10,
                max: 90,
                stats: {
                    active: { storeAs: 'pressureAlarm' }
                }
            };

            const state = threshold.init( spec );
            threshold.update( state, createMessage( { pressure: 95 } ) );

            const output = Object.create( null );
            threshold.publishTo( state, output );

            expect( output.pressureAlarm ).to.equal( true );
            expect( output.active ).to.be.undefined;
        } );
    } );

    describe( 'Reset functionality', function () {
        it( 'resets all state variables', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'resetTest',
                from: { x: 'signal' },
                mode: 'above',
                threshold: 50,
                stats: {
                    active: { storeAs: 'state' }
                }
            };

            const state = threshold.init( spec );

            // Set some state
            threshold.update( state, createMessage( { signal: 75 } ) );
            expect( state.active ).to.equal( true );
            expect( state.hasSeenValue ).to.equal( true );

            // Reset
            const result = threshold.reset( state );
            expect( result ).to.equal( true );
            expect( state.active ).to.equal( false );
            expect( state.wasActive ).to.equal( false );
            expect( state.hasSeenValue ).to.equal( false );
        } );

        it( 're-initializes correctly after reset', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'reinit',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                hysteresis: 5,
                stats: {
                    active: { storeAs: 'state' }
                }
            };

            const state = threshold.init( spec );

            threshold.update( state, createMessage( { value: 60 } ) );
            threshold.reset( state );

            // First value after reset in deadband
            threshold.update( state, createMessage( { value: 47 } ) );
            expect( state.active ).to.equal( false ); // Defaults to inactive
            expect( state.hasSeenValue ).to.equal( true );
        } );
    } );

    describe( 'Recompute', function () {
        it( 'returns true (no-op)', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'recompute',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                stats: {
                    active: { storeAs: 'state' }
                }
            };

            const state = threshold.init( spec );
            const result = threshold.recompute( state );
            expect( result ).to.equal( true );
        } );
    } );

    describe( 'Edge cases and boundaries', function () {
        it( 'handles zero threshold', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'zero',
                from: { x: 'value' },
                mode: 'above',
                threshold: 0,
                stats: {
                    active: { storeAs: 'state' }
                }
            };

            const state = threshold.init( spec );

            threshold.update( state, createMessage( { value: -1 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { value: 0 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { value: 1 } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'handles negative thresholds', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'negative',
                from: { x: 'value' },
                mode: 'below',
                threshold: -10,
                stats: {
                    active: { storeAs: 'state' }
                }
            };

            const state = threshold.init( spec );

            threshold.update( state, createMessage( { value: -5 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { value: -10 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { value: -15 } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'handles very small differences', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'precision',
                from: { x: 'value' },
                mode: 'above',
                threshold: 1.0,
                hysteresis: 0.0001,
                stats: {
                    active: { storeAs: 'state' }
                }
            };

            const state = threshold.init( spec );

            threshold.update( state, createMessage( { value: 0.9999 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { value: 1.0 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { value: 0.9999 } ) );
            expect( state.active ).to.equal( true ); // In deadband

            threshold.update( state, createMessage( { value: 0.9998 } ) );
            expect( state.active ).to.equal( false ); // Below reset
        } );

        it( 'handles very large numbers', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'large',
                from: { x: 'value' },
                mode: 'above',
                threshold: 1e10,
                stats: {
                    active: { storeAs: 'state' }
                }
            };

            const state = threshold.init( spec );

            threshold.update( state, createMessage( { value: 9e9 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { value: 1e10 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { value: 1.1e10 } ) );
            expect( state.active ).to.equal( true );
        } );

        it( 'rejects min equals max as invalid', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'point',
                from: { x: 'value' },
                mode: 'inside',
                min: 50,
                max: 50,  // Same as min - invalid!
                stats: {
                    active: { storeAs: 'state' }
                }
            };

            // This should throw an error
            expect( () => threshold.init( spec ) ).to.throw( 'Invalid parameters for mode' );
        } );

        it( 'accepts field-keyed min/max, resolving the node\'s field', function () {
            const state = threshold.init( {
                nodeType: 'Threshold',
                name: 'point',
                from: { x: 'value' },
                mode: 'inside',
                min: { value: 0, other: 100 },
                max: { value: 10, other: 200 },
                stats: { active: { storeAs: 'state' } }
            } );
            expect( state.minFn() ).to.equal( 0 );
            expect( state.maxFn() ).to.equal( 10 );
        } );

        it( 'rejects field-keyed min >= max for the node\'s field', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'point',
                from: { x: 'value' },
                mode: 'inside',
                min: { value: 10 },
                max: { value: 0 },  // min >= max for 'value' — invalid
                stats: { active: { storeAs: 'state' } }
            };
            expect( () => threshold.init( spec ) ).to.throw( 'Invalid parameters for mode' );
        } );

        it( 'handles very narrow ranges', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'narrow',
                from: { x: 'value' },
                mode: 'inside',
                min: 50,
                max: 50.001,  // Valid narrow range
                stats: {
                    active: { storeAs: 'state' }
                }
            };

            const state = threshold.init( spec );

            threshold.update( state, createMessage( { value: 49.999 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { value: 50 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { value: 50.001 } ) );
            expect( state.active ).to.equal( true );

            threshold.update( state, createMessage( { value: 50.002 } ) );
            expect( state.active ).to.equal( false );
        } );

    } );

    describe( 'Complex scenarios', function () {
        it( 'handles rapid oscillations', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'oscillate',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                hysteresis: 5,
                stats: {
                    active: { storeAs: 'state' }
                }
            };

            const state = threshold.init( spec );

            for ( let i = 0; i < 100; i += 1 ) {
                const value = 50 + ( 10 * Math.sin( i * 0.5 ) );
                threshold.update( state, createMessage( { value } ) );

                if ( value >= 50 && !state.wasActive ) {
                    expect( state.active ).to.equal( true );
                } else if ( value < 45 && state.wasActive ) {
                    expect( state.active ).to.equal( false );
                }
            }
        } );

        it( 'maintains state through long stable periods', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'stable',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                stats: {
                    active: { storeAs: 'state' }
                }
            };

            const state = threshold.init( spec );

            threshold.update( state, createMessage( { value: 60 } ) );
            expect( state.active ).to.equal( true );

            // Many updates at same value
            for ( let i = 0; i < 1000; i += 1 ) {
                threshold.update( state, createMessage( { value: 60 } ) );
                expect( state.active ).to.equal( true );
            }
        } );

        it( 'handles mode transitions correctly', function () {
            const specs = [
                {
                    nodeType: 'Threshold',
                    name: 'above',
                    from: { x: 'value' },
                    mode: 'above',
                    threshold: 50,
                    stats: { active: { storeAs: 'state' } }
                },
                {
                    nodeType: 'Threshold',
                    name: 'below',
                    from: { x: 'value' },
                    mode: 'below',
                    threshold: 50,
                    stats: { active: { storeAs: 'state' } }
                },
                {
                    nodeType: 'Threshold',
                    name: 'inside',
                    from: { x: 'value' },
                    mode: 'inside',
                    min: 40,
                    max: 60,
                    stats: { active: { storeAs: 'state' } }
                },
                {
                    nodeType: 'Threshold',
                    name: 'outside',
                    from: { x: 'value' },
                    mode: 'outside',
                    min: 40,
                    max: 60,
                    stats: { active: { storeAs: 'state' } }
                }
            ];

            const states = specs.map( ( spec ) => threshold.init( spec ) );
            const value = 50;

            states.forEach( ( state ) => {
                threshold.update( state, createMessage( { value } ) );
            } );

            expect( states[ 0 ].active ).to.equal( true );  // above: 50 >= 50
            expect( states[ 1 ].active ).to.equal( true );  // below: 50 <= 50
            expect( states[ 2 ].active ).to.equal( true );  // inside: 40 <= 50 <= 60
            expect( states[ 3 ].active ).to.equal( false ); // outside: !(50 < 40 || 50 > 60)
        } );
    } );

    describe( 'Spec validation', function () {
        it( 'rejects invalid nodeType', function () {
            const badSpec = {
                nodeType: 'INVALID',
                name: 'test',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid name', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: '123-invalid',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing from field', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                mode: 'above',
                threshold: 50,
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects from.x with spaces', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                from: { x: 'bad field' },
                mode: 'above',
                threshold: 50,
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing mode', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                from: { x: 'value' },
                threshold: 50,
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid mode', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                from: { x: 'value' },
                mode: 'sideways',
                threshold: 50,
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects above mode without threshold', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                from: { x: 'value' },
                mode: 'above',
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects above mode with min/max', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                min: 10,
                max: 90,
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects inside mode without min/max', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                from: { x: 'value' },
                mode: 'inside',
                threshold: 50,
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects inside mode with threshold', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                from: { x: 'value' },
                mode: 'inside',
                min: 10,
                max: 90,
                threshold: 50,
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects min >= max', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                from: { x: 'value' },
                mode: 'inside',
                min: 90,
                max: 10,
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects negative hysteresis', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                hysteresis: -5,
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects NaN threshold', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                from: { x: 'value' },
                mode: 'above',
                threshold: NaN,
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects Infinity hysteresis', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                hysteresis: Infinity,
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing stats', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects empty stats', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                stats: {}
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects unsupported stat', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                stats: {
                    activated: { storeAs: 'result' }
                }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid storeAs', function () {
            const badSpec = {
                nodeType: 'Threshold',
                name: 'test',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                stats: {
                    active: { storeAs: '123-invalid' }
                }
            };
            expect( () => threshold.init( badSpec ) ).to.throw();
        } );

        it( 'accepts valid specs for all modes', function () {
            const specs = [
                {
                    nodeType: 'Threshold',
                    name: 'aboveTest',
                    from: { x: 'value' },
                    mode: 'above',
                    threshold: 50,
                    hysteresis: 5,
                    stats: { active: { storeAs: 'result' } }
                },
                {
                    nodeType: 'Threshold',
                    name: 'belowTest',
                    from: { x: 'value' },
                    mode: 'below',
                    threshold: 50,
                    stats: { active: { storeAs: 'result' } }
                },
                {
                    nodeType: 'Threshold',
                    name: 'insideTest',
                    from: { x: 'value' },
                    mode: 'inside',
                    min: 10,
                    max: 90,
                    hysteresis: 2,
                    stats: { active: { storeAs: 'result' } }
                },
                {
                    nodeType: 'Threshold',
                    name: 'outsideTest',
                    from: { x: 'value' },
                    mode: 'outside',
                    min: 10,
                    max: 90,
                    stats: { active: { storeAs: 'result' } }
                }
            ];

            specs.forEach( ( spec ) => {
                expect( () => threshold.init( spec ) ).to.not.throw();
            } );
        } );
    } );

    describe( 'Introspect accessors', function () {
        it( 'returns expected node type', function () {
            expect( getNodeType() ).to.equal( 'Threshold' );
        } );

        it( 'getSupportedStats returns a copy', function () {
            const stats = getSupportedStats();
            expect( stats ).to.be.an( 'array' );
            expect( stats ).to.have.lengthOf( 1 );
            expect( stats ).to.include( 'active' );

            // Verify it's a copy
            stats.push( 'mutation' );
            const stats2 = getSupportedStats();
            expect( stats2 ).to.not.include( 'mutation' );
        } );

        it( 'getStatDescriptions returns descriptions', function () {
            const desc = getStatDescriptions();
            expect( desc ).to.be.an( 'object' );
            expect( desc ).to.have.property( 'active' ).that.is.a( 'string' );
        } );

        it( 'getSupportedControlMethods returns control methods', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.be.an( 'object' );
            expect( methods ).to.have.property( 'reset' ).that.is.a( 'string' );
            expect( methods ).to.have.property( 'enable' ).that.is.a( 'string' );
            expect( methods ).to.have.property( 'disable' ).that.is.a( 'string' );
        } );

        it( 'getThresholdModes returns modes', function () {
            const modes = getThresholdModes();
            expect( modes ).to.be.an( 'array' );
            expect( modes ).to.have.lengthOf( 4 );
            expect( modes ).to.include.members( [ 'above', 'below', 'inside', 'outside' ] );

            // Verify it's a copy
            modes.push( 'mutation' );
            const modes2 = getThresholdModes();
            expect( modes2 ).to.not.include( 'mutation' );
        } );

        it( 'getCapabilities returns capabilities', function () {
            const cap = getCapabilities();
            expect( cap ).to.be.an( 'object' );
            expect( cap ).to.have.property( 'description' ).that.is.a( 'string' );
            expect( cap ).to.have.property( 'features' ).that.is.an( 'array' );
        } );

        it( 'getDSLMetadata returns metadata', function () {
            const dsl = getDSLMetadata();
            expect( dsl ).to.be.an( 'object' );
            expect( dsl ).to.have.property( 'specSchema' );
            expect( dsl ).to.have.property( 'buildSpec' );
        } );
    } );

    describe( 'DSL buildSpec', function () {
        // buildSpec signature: ( name, x, stats, options )
        // stats format: { active: { storeAs: 'fieldName' } }

        it( 'builds basic above spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'high',
                'temperature',
                { active: { storeAs: 'is_high' } },
                { mode: 'above', threshold: 70 }
            );

            expect( spec.nodeType ).to.equal( 'Threshold' );
            expect( spec.name ).to.equal( 'high' );
            expect( spec.from ).to.deep.equal( { x: 'temperature' } );
            expect( spec.mode ).to.equal( 'above' );
            expect( spec.threshold ).to.equal( 70 );
            expect( spec.stats.active.storeAs ).to.equal( 'is_high' );
        } );

        it( 'builds below spec with hysteresis', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'low',
                'pressure',
                { active: { storeAs: 'is_low' } },
                { mode: 'below', threshold: 10, hysteresis: 2 }
            );

            expect( spec.mode ).to.equal( 'below' );
            expect( spec.threshold ).to.equal( 10 );
            expect( spec.hysteresis ).to.equal( 2 );
        } );

        it( 'builds inside spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'comfort',
                'temp',
                { active: { storeAs: 'in_range' } },
                { mode: 'inside', min: 68, max: 72 }
            );

            expect( spec.mode ).to.equal( 'inside' );
            expect( spec.min ).to.equal( 68 );
            expect( spec.max ).to.equal( 72 );
        } );

        it( 'builds outside spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'alarm',
                'value',
                { active: { storeAs: 'out_of_range' } },
                { mode: 'outside', min: 0, max: 100, hysteresis: 5 }
            );

            expect( spec.mode ).to.equal( 'outside' );
            expect( spec.min ).to.equal( 0 );
            expect( spec.max ).to.equal( 100 );
            expect( spec.hysteresis ).to.equal( 5 );
        } );

        it( 'passes through name as-is', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'myThreshold',
                'value',
                { active: { storeAs: 'flag' } },
                { mode: 'above', threshold: 50 }
            );

            expect( spec.name ).to.equal( 'myThreshold' );
        } );

        it( 'includes stats in built spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'high',
                'temperature',
                { active: { storeAs: 'temp_high' } },
                { mode: 'above', threshold: 70 }
            );

            expect( spec.stats ).to.deep.equal( { active: { storeAs: 'temp_high' } } );
        } );
    } );

    describe( 'MODE_HANDLERS coverage', function () {
        it( 'covers all branches in above handler', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'coverage',
                from: { x: 'value' },
                mode: 'above',
                threshold: 50,
                hysteresis: 5,
                stats: { active: { storeAs: 'state' } }
            };

            const state = threshold.init( spec );

            // Branch 1: inactive, below threshold
            threshold.update( state, createMessage( { value: 45 } ) );
            expect( state.active ).to.equal( false );

            // Branch 2: inactive, at threshold
            threshold.update( state, createMessage( { value: 50 } ) );
            expect( state.active ).to.equal( true );

            // Branch 3: active, in deadband
            threshold.update( state, createMessage( { value: 47 } ) );
            expect( state.active ).to.equal( true );

            // Branch 4: active, below reset
            threshold.update( state, createMessage( { value: 44 } ) );
            expect( state.active ).to.equal( false );
        } );

        it( 'covers all branches in below handler', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'coverage',
                from: { x: 'value' },
                mode: 'below',
                threshold: 50,
                hysteresis: 5,
                stats: { active: { storeAs: 'state' } }
            };

            const state = threshold.init( spec );

            // Branch 1: inactive, above threshold
            threshold.update( state, createMessage( { value: 55 } ) );
            expect( state.active ).to.equal( false );

            // Branch 2: inactive, at threshold
            threshold.update( state, createMessage( { value: 50 } ) );
            expect( state.active ).to.equal( true );

            // Branch 3: active, in deadband
            threshold.update( state, createMessage( { value: 53 } ) );
            expect( state.active ).to.equal( true );

            // Branch 4: active, above reset
            threshold.update( state, createMessage( { value: 56 } ) );
            expect( state.active ).to.equal( false );
        } );

        it( 'covers all branches in inside handler', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'coverage',
                from: { x: 'value' },
                mode: 'inside',
                min: 20,
                max: 80,
                hysteresis: 5,
                stats: { active: { storeAs: 'state' } }
            };

            const state = threshold.init( spec );

            // Branch 1: inactive, enter range
            threshold.update( state, createMessage( { value: 10 } ) );
            expect( state.active ).to.equal( false );

            threshold.update( state, createMessage( { value: 20 } ) );
            expect( state.active ).to.equal( true );

            // Branch 2: active, at expanded boundary
            threshold.update( state, createMessage( { value: 15 } ) );
            expect( state.active ).to.equal( true );

            // Branch 3: active, outside expanded range
            threshold.update( state, createMessage( { value: 14 } ) );
            expect( state.active ).to.equal( false );
        } );

        it( 'covers all branches in outside handler', function () {
            const spec = {
                nodeType: 'Threshold',
                name: 'coverage',
                from: { x: 'value' },
                mode: 'outside',
                min: 20,
                max: 80,
                hysteresis: 5,
                stats: { active: { storeAs: 'state' } }
            };

            const state = threshold.init( spec );

            // Branch 1: inactive, inside range
            threshold.update( state, createMessage( { value: 50 } ) );
            expect( state.active ).to.equal( false );

            // Branch 2: inactive, go outside
            threshold.update( state, createMessage( { value: 19 } ) );
            expect( state.active ).to.equal( true );

            // Branch 3: active, in deadband
            threshold.update( state, createMessage( { value: 24 } ) );
            expect( state.active ).to.equal( true );

            // Branch 4: active, inside reset boundary
            threshold.update( state, createMessage( { value: 26 } ) );
            expect( state.active ).to.equal( false );
        } );
    } );

    describe( 'Disable functionality', function () {
    it( 'skips update when disabled', function () {
        const spec = {
            nodeType: 'Threshold',
            name: 'disableTest',
            from: { x: 'value' },
            mode: 'above',
            threshold: 50,
            stats: {
                active: { storeAs: 'state' }
            }
        };

        const state = threshold.init( spec );

        // Set initial state
        threshold.update( state, createMessage( { value: 60 } ) );
        expect( state.active ).to.equal( true );

        // Disable the node
        state.disable = true;

        // Try to update - should return immediately
        const result = threshold.update( state, createMessage( { value: 30 } ) );
        expect( result ).to.equal( state );
        expect( state.active ).to.equal( true ); // Unchanged

        // Re-enable
        state.disable = false;

        // Now update works
        threshold.update( state, createMessage( { value: 30 } ) );
        expect( state.active ).to.equal( false );
    } );

    it( 'skips publishing when disabled', function () {
        const spec = {
            nodeType: 'Threshold',
            name: 'publishDisableTest',
            from: { x: 'value' },
            mode: 'above',
            threshold: 50,
            stats: {
                active: { storeAs: 'isHigh' }
            }
        };

        const state = threshold.init( spec );
        threshold.update( state, createMessage( { value: 75 } ) );

        // Disable the node
        state.disable = true;

        const output = Object.create( null );
        threshold.publishTo( state, output );

        // Should not publish anything when disabled
        expect( output.isHigh ).to.be.undefined;

        // Re-enable and test publishing works
        state.disable = false;
        threshold.publishTo( state, output );
        expect( output.isHigh ).to.equal( true );
    } );

    it( 'handles enable/disable during operation', function () {
        const spec = {
            nodeType: 'Threshold',
            name: 'toggleTest',
            from: { x: 'value' },
            mode: 'above',
            threshold: 50,
            stats: {
                active: { storeAs: 'state' }
            }
        };

        const state = threshold.init( spec );

        // Process some values
        threshold.update( state, createMessage( { value: 30 } ) );
        expect( state.active ).to.equal( false );

        threshold.update( state, createMessage( { value: 60 } ) );
        expect( state.active ).to.equal( true );

        // Disable mid-operation
        state.disable = true;

        // These should be ignored
        threshold.update( state, createMessage( { value: 10 } ) );
        threshold.update( state, createMessage( { value: 100 } ) );
        threshold.update( state, createMessage( { value: 25 } ) );

        // State should be unchanged
        expect( state.active ).to.equal( true );

        // Re-enable
        state.disable = false;

        // Process continues normally
        threshold.update( state, createMessage( { value: 25 } ) );
        expect( state.active ).to.equal( false );
    } );
} );

describe( 'Field-keying support', function () {
    it( 'accepts direct threshold value', function () {
        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'test',
            from: { x: 'temp' },
            mode: 'above',
            threshold: 50,
            stats: { active: { storeAs: 'isHot' } }
        } );

        expect( state.thresholdFn() ).to.equal( 50 );
    } );

    it( 'accepts direct hysteresis value', function () {
        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'test',
            from: { x: 'temp' },
            mode: 'above',
            threshold: 50,
            hysteresis: 5,
            stats: { active: { storeAs: 'isHot' } }
        } );

        expect( state.hysteresisFn() ).to.equal( 5 );
    } );

    it( 'uses default hysteresis when not specified', function () {
        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'test',
            from: { x: 'temp' },
            mode: 'above',
            threshold: 50,
            stats: { active: { storeAs: 'isHot' } }
        } );

        expect( state.hysteresisFn() ).to.equal( 0 );  // DEFAULT_OPTIONS.hysteresis
    } );

    it( 'accepts direct min and max values in inside mode', function () {
        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'test',
            from: { x: 'temp' },
            mode: 'inside',
            min: 20,
            max: 80,
            stats: { active: { storeAs: 'inRange' } }
        } );

        expect( state.minFn() ).to.equal( 20 );
        expect( state.maxFn() ).to.equal( 80 );
    } );

    it( 'accepts a field-keyed threshold and hysteresis, resolving the node\'s field', function () {
        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'test',
            from: { x: 'temp' },
            mode: 'above',
            threshold: { temp: 50, pressure: 120 },
            hysteresis: { temp: 5, pressure: 10 },
            stats: { active: { storeAs: 'isHot' } }
        } );

        expect( state.thresholdFn() ).to.equal( 50 );
        expect( state.hysteresisFn() ).to.equal( 5 );
    } );
} );

describe( 'Tunable support', function () {
    it( 'accepts function for threshold parameter', function () {
        const dynamicThreshold = ( msg ) => msg.baseline + 10;
        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'test',
            from: { x: 'temp' },
            mode: 'above',
            threshold: dynamicThreshold,
            stats: { active: { storeAs: 'isHot' } }
        } );

        expect( state.thresholdFn ).to.be.a( 'function' );
        expect( state.thresholdFn( { baseline: 50 } ) ).to.equal( 60 );
        expect( state.thresholdFn( { baseline: 70 } ) ).to.equal( 80 );
    } );

    it( 'accepts function for hysteresis parameter', function () {
        const dynamicHysteresis = ( msg ) => msg.noiseLevel * 2;
        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'test',
            from: { x: 'temp' },
            mode: 'above',
            threshold: 50,
            hysteresis: dynamicHysteresis,
            stats: { active: { storeAs: 'isHot' } }
        } );

        expect( state.hysteresisFn ).to.be.a( 'function' );
        expect( state.hysteresisFn( { noiseLevel: 2 } ) ).to.equal( 4 );
        expect( state.hysteresisFn( { noiseLevel: 5 } ) ).to.equal( 10 );
    } );

    it( 'accepts functions for min and max in inside mode', function () {
        const dynamicMin = ( msg ) => msg.operatingMin;
        const dynamicMax = ( msg ) => msg.operatingMax;
        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'test',
            from: { x: 'temp' },
            mode: 'inside',
            min: dynamicMin,
            max: dynamicMax,
            stats: { active: { storeAs: 'inRange' } }
        } );

        expect( state.minFn( { operatingMin: 20 } ) ).to.equal( 20 );
        expect( state.maxFn( { operatingMax: 80 } ) ).to.equal( 80 );
        expect( state.minFn( { operatingMin: 30 } ) ).to.equal( 30 );
        expect( state.maxFn( { operatingMax: 70 } ) ).to.equal( 70 );
    } );

    it( 'uses dynamic threshold in update', function () {
        const dynamicThreshold = ( msg ) => msg.baseline + 10;
        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'test',
            from: { x: 'temp' },
            mode: 'above',
            threshold: dynamicThreshold,
            stats: { active: { storeAs: 'isHot' } }
        } );

        // With baseline=50, threshold=60
        threshold.update( state, { temp: 55, baseline: 50 } );
        expect( state.active ).to.equal( false );

        threshold.update( state, { temp: 65, baseline: 50 } );
        expect( state.active ).to.equal( true );

        // With baseline=70, threshold=80
        threshold.update( state, { temp: 75, baseline: 70 } );
        expect( state.active ).to.equal( false );

        threshold.update( state, { temp: 85, baseline: 70 } );
        expect( state.active ).to.equal( true );
    } );

    it( 'uses dynamic hysteresis in update for debouncing', function () {
        const dynamicHysteresis = ( msg ) => msg.noiseLevel * 2;
        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'test',
            from: { x: 'temp' },
            mode: 'above',
            threshold: 50,
            hysteresis: dynamicHysteresis,
            stats: { active: { storeAs: 'isHot' } }
        } );

        // Cross above threshold
        threshold.update( state, { temp: 55, noiseLevel: 5 } );
        expect( state.active ).to.equal( true );

        // With noiseLevel=5, hysteresis=10, must go below 50-10=40 to deactivate
        threshold.update( state, { temp: 45, noiseLevel: 5 } );
        expect( state.active ).to.equal( true );

        threshold.update( state, { temp: 38, noiseLevel: 5 } );
        expect( state.active ).to.equal( false );
    } );

    it( 'uses shift-based thresholds via function', function () {
        // Simulate shift-based threshold lookup
        const shiftThresholds = {
            day: 35,
            night: 25
        };
        const dynamicThreshold = ( msg ) => shiftThresholds[ msg.shift ] ?? 30;

        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'test',
            from: { x: 'temp' },
            mode: 'above',
            threshold: dynamicThreshold,
            stats: { active: { storeAs: 'isHot' } }
        } );

        // Day shift: threshold=35
        threshold.update( state, { temp: 30, shift: 'day' } );
        expect( state.active ).to.equal( false );

        threshold.update( state, { temp: 36, shift: 'day' } );
        expect( state.active ).to.equal( true );

        // Night shift: threshold=25
        threshold.update( state, { temp: 30, shift: 'night' } );
        expect( state.active ).to.equal( true );

        threshold.update( state, { temp: 20, shift: 'night' } );
        expect( state.active ).to.equal( false );
    } );
} );

describe( 'Tunable error guard', function () {
    afterEach( function () {
        sinon.restore();
    } );

    it( 'survives throwing tunable and retains last good threshold value', function () {
        let callCount = 0;
        const throwAfter3 = function ( msg ) {
            callCount += 1;
            if ( callCount > 3 ) {
                throw new Error( 'tunable boom' );
            }
            return msg.baseline;
        };

        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'guardRetain',
            from: { x: 'temp' },
            mode: 'above',
            threshold: throwAfter3,
            stats: { active: { storeAs: 'isHot' } }
        } );

        // Suppress console.error noise in test output
        sinon.stub( console, 'error' );

        // First 3 calls succeed — threshold resolves from msg.baseline
        threshold.update( state, createMessage( { temp: 80, baseline: 70 } ) );
        expect( state.threshold ).to.equal( 70 );
        expect( state.active ).to.equal( true );

        threshold.update( state, createMessage( { temp: 55, baseline: 60 } ) );
        expect( state.threshold ).to.equal( 60 );
        expect( state.active ).to.equal( false );

        threshold.update( state, createMessage( { temp: 65, baseline: 60 } ) );
        expect( state.threshold ).to.equal( 60 );
        expect( state.active ).to.equal( true );

        // 4th call throws — state.threshold retains last good value (60)
        threshold.update( state, createMessage( { temp: 55, baseline: 999 } ) );
        expect( state.threshold ).to.equal( 60 );
        // Node continues processing with stale threshold: 55 < 60 → inactive
        expect( state.active ).to.equal( false );

        // 5th call also throws — still retains 60
        threshold.update( state, createMessage( { temp: 65, baseline: 999 } ) );
        expect( state.threshold ).to.equal( 60 );
        // 65 >= 60 → active
        expect( state.active ).to.equal( true );
    } );

    it( 'logs console.error on first tunable error only (suppresses subsequent)', function () {
        const stub = sinon.stub( console, 'error' );
        const alwaysThrows = function () {
            throw new Error( 'bad tunable' );
        };

        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'guardLog',
            from: { x: 'temp' },
            mode: 'above',
            threshold: alwaysThrows,
            stats: { active: { storeAs: 'isHot' } }
        } );

        // First message — logs error
        threshold.update( state, createMessage( { temp: 80 } ) );
        expect( stub.calledOnce ).to.equal( true );
        expect( stub.firstCall.args[ 0 ] ).to.include( 'tunable threw' );

        // Second message — suppressed
        threshold.update( state, createMessage( { temp: 90 } ) );
        expect( stub.calledOnce ).to.equal( true );

        // Third message — still suppressed
        threshold.update( state, createMessage( { temp: 95 } ) );
        expect( stub.calledOnce ).to.equal( true );
    } );

    it( 'logs again after recovery', function () {
        const stub = sinon.stub( console, 'error' );
        let callCount = 0;
        const errorRecoverError = function ( msg ) {
            callCount += 1;
            // Call 1: throw, Call 2: succeed, Call 3: throw
            if ( callCount === 1 || callCount >= 3 ) {
                throw new Error( 'intermittent' );
            }
            return msg.baseline;
        };

        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'guardRecovery',
            from: { x: 'temp' },
            mode: 'above',
            threshold: errorRecoverError,
            stats: { active: { storeAs: 'isHot' } }
        } );

        // Call 1: error — logs (first episode)
        threshold.update( state, createMessage( { temp: 80, baseline: 70 } ) );
        expect( stub.calledOnce ).to.equal( true );
        expect( state.tunableErrorLogged ).to.equal( true );

        // Call 2: success — recovery clears flag
        threshold.update( state, createMessage( { temp: 80, baseline: 70 } ) );
        expect( state.tunableErrorLogged ).to.equal( false );

        // Call 3: error again — logs (second episode)
        threshold.update( state, createMessage( { temp: 80, baseline: 70 } ) );
        expect( stub.calledTwice ).to.equal( true );
        expect( state.tunableErrorLogged ).to.equal( true );
    } );

    it( 'retains last good min/max for inside mode when tunable throws', function () {
        const stub = sinon.stub( console, 'error' );
        let callCount = 0;
        const dynamicMin = function ( msg ) {
            callCount += 1;
            if ( callCount > 2 ) {
                throw new Error( 'min boom' );
            }
            return msg.lo;
        };
        const dynamicMax = function ( msg ) {
            // max also throws when min throws (same callCount gate)
            if ( callCount > 2 ) {
                throw new Error( 'max boom' );
            }
            return msg.hi;
        };

        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'guardInside',
            from: { x: 'temp' },
            mode: 'inside',
            min: dynamicMin,
            max: dynamicMax,
            stats: { active: { storeAs: 'inRange' } }
        } );

        // First 2 calls succeed — min/max resolve
        threshold.update( state, createMessage( { temp: 50, lo: 20, hi: 80 } ) );
        expect( state.min ).to.equal( 20 );
        expect( state.max ).to.equal( 80 );
        expect( state.active ).to.equal( true );

        threshold.update( state, createMessage( { temp: 35, lo: 30, hi: 70 } ) );
        expect( state.min ).to.equal( 30 );
        expect( state.max ).to.equal( 70 );
        expect( state.active ).to.equal( true );

        // 3rd call throws — min retains 30, max retains 70
        threshold.update( state, createMessage( { temp: 50, lo: 999, hi: 999 } ) );
        expect( state.min ).to.equal( 30 );
        expect( state.max ).to.equal( 70 );
        // 50 is within [30, 70] → still active
        expect( state.active ).to.equal( true );

        expect( stub.calledOnce ).to.equal( true );

        // 4th call also throws — still retains [30, 70], suppressed log
        threshold.update( state, createMessage( { temp: 75, lo: 999, hi: 999 } ) );
        expect( state.min ).to.equal( 30 );
        expect( state.max ).to.equal( 70 );
        // 75 > 70 → outside range → inactive
        expect( state.active ).to.equal( false );

        expect( stub.calledOnce ).to.equal( true );
    } );

    it( 'seeds state fields at init — threshold is undefined before first resolve', function () {
        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'guardSeed',
            from: { x: 'temp' },
            mode: 'above',
            threshold: ( msg ) => msg.baseline,
            stats: { active: { storeAs: 'isHot' } }
        } );

        // Before any update, threshold is undefined (seeded by init)
        expect( state.threshold ).to.equal( undefined );
        expect( state.active ).to.equal( false );
        expect( state.tunableErrorLogged ).to.equal( false );
    } );
} );

describe( 'reset()', function () {
    it( 'clears error suppression flag', function () {
        const state = threshold.init( {
            nodeType: 'Threshold',
            name: 'test',
            from: { x: 'value' },
            mode: 'above',
            threshold: 80,
            stats: { active: { storeAs: 'isHot' } }
        } );

        state.tunableErrorLogged = true;
        threshold.reset( state );
        expect( state.tunableErrorLogged ).to.equal( false );
    } );
} );

describe( 'Pause/Unpause control', function () {
    it( 'skips update when paused', function () {
        const spec = {
            nodeType: 'Threshold',
            name: 'pauseTest',
            from: { x: 'value' },
            mode: 'above',
            threshold: 50,
            stats: { active: { storeAs: 'state' } }
        };
        const state = threshold.init( spec );

        threshold.update( state, createMessage( { value: 60 } ) );
        expect( state.active ).to.equal( true );

        state.pause = true;

        threshold.update( state, createMessage( { value: 30 } ) );
        expect( state.active ).to.equal( true ); // Unchanged
    } );

    it( 'publishes when paused', function () {
        const spec = {
            nodeType: 'Threshold',
            name: 'pausePub',
            from: { x: 'value' },
            mode: 'above',
            threshold: 50,
            stats: { active: { storeAs: 'isHigh' } }
        };
        const state = threshold.init( spec );

        threshold.update( state, createMessage( { value: 60 } ) );

        state.pause = true;

        const output = Object.create( null );
        threshold.publishTo( state, output );
        expect( output.isHigh ).to.not.equal( undefined );
    } );

    it( 'pause/unpause control methods exist', function () {
        const methods = getSupportedControlMethods();
        expect( methods ).to.have.property( 'pause' );
        expect( methods ).to.have.property( 'unpause' );
    } );
} );
} );

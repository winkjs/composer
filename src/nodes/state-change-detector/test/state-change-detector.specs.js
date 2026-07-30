/* eslint-disable max-lines */
// nodes/state-change-detector/test.js

import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import * as stateChangeDetector from '../index.js';
import {
    getDSLMetadata,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities
} from '../introspect.js';
import { validateCategoricalFields } from '../helpers.js';

const createMessage = function ( values ) {
    const msg = Object.create( null );
    Object.keys( values ).forEach( ( key ) => {
        msg[ key ] = values[ key ];
    } );
    return msg;
};

describe( 'State Change Detector', function () {
    describe( 'Basic functionality - Single field', function () {
        it( 'initializes on first message', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'healthMonitor',
                from: { x: [ 'health' ] },
                debounce: 3,
                stats: {
                    dwellTime: { storeAs: 'healthDwell' }
                }
            };

            const state = stateChangeDetector.init( spec );
            const msg1 = createMessage( { health: 'good' } );

            stateChangeDetector.update( state, msg1 );

            expect( state.prevValues.health ).to.equal( 'good' );
            expect( state.samplesInState ).to.equal( 1 );
            expect( state.debounceCount ).to.equal( 0 );
            expect( state.dwellTime ).to.equal( null );
            expect( state.dwellSamples ).to.equal( null );
        } );

        it( 'detects change after debounce samples', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'healthMonitor',
                from: { x: [ 'health' ] },
                debounce: 3,
                stats: {
                    dwellTime: { storeAs: 'healthDwell' },
                    dwellSamples: { storeAs: 'healthSamples' }
                }
            };

            const state = stateChangeDetector.init( spec );

            // Initialize
            stateChangeDetector.update( state, createMessage( { health: 'good' } ) );
            expect( state.dwellTime ).to.equal( null );

            // Stable for a while
            stateChangeDetector.update( state, createMessage( { health: 'good' } ) );
            stateChangeDetector.update( state, createMessage( { health: 'good' } ) );
            expect( state.samplesInState ).to.equal( 3 );
            expect( state.dwellTime ).to.equal( null );

            // Change detected
            stateChangeDetector.update( state, createMessage( { health: 'degraded' } ) );
            expect( state.debounceCount ).to.equal( 1 );
            expect( state.dwellTime ).to.equal( null );

            stateChangeDetector.update( state, createMessage( { health: 'degraded' } ) );
            expect( state.debounceCount ).to.equal( 2 );
            expect( state.dwellTime ).to.equal( null );

            stateChangeDetector.update( state, createMessage( { health: 'degraded' } ) );
            expect( state.debounceCount ).to.equal( 0 ); // Reset after confirmation
            expect( state.dwellTime ).to.not.equal( null ); // Has value on transition
            expect( state.dwellSamples ).to.equal( 3 );
            expect( state.prevValues.health ).to.equal( 'degraded' );
            expect( state.samplesInState ).to.equal( 1 ); // Reset after confirmation
        } );

        it( 'dwellTime and dwellSamples are null except during transition', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'nullTest',
                from: { x: [ 'state' ] },
                debounce: 2,
                stats: {
                    dwellTime: { storeAs: 'dwell' },
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = stateChangeDetector.init( spec );

            // First message
            stateChangeDetector.update( state, createMessage( { state: 'A' } ) );
            expect( state.dwellTime ).to.equal( null );
            expect( state.dwellSamples ).to.equal( null );

            // Stable messages
            stateChangeDetector.update( state, createMessage( { state: 'A' } ) );
            expect( state.dwellTime ).to.equal( null );
            expect( state.dwellSamples ).to.equal( null );

            // Start transition
            stateChangeDetector.update( state, createMessage( { state: 'B' } ) );
            expect( state.dwellTime ).to.equal( null ); // Still null during debounce

            // Confirm transition
            stateChangeDetector.update( state, createMessage( { state: 'B' } ) );
            expect( state.dwellTime ).to.not.equal( null ); // Has value!
            expect( state.dwellSamples ).to.not.equal( null ); // Has value!

            // Next message after transition
            stateChangeDetector.update( state, createMessage( { state: 'B' } ) );
            expect( state.dwellTime ).to.equal( null ); // Back to null
            expect( state.dwellSamples ).to.equal( null ); // Back to null
        } );

        it( 'rejects brief single-sample spike', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'spikeTest',
                from: { x: [ 'status' ] },
                debounce: 3,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = stateChangeDetector.init( spec );

            stateChangeDetector.update( state, createMessage( { status: 'running' } ) );
            stateChangeDetector.update( state, createMessage( { status: 'running' } ) );

            // Spike
            stateChangeDetector.update( state, createMessage( { status: 'fault' } ) );
            expect( state.debounceCount ).to.equal( 1 );

            // Return to normal
            stateChangeDetector.update( state, createMessage( { status: 'running' } ) );
            expect( state.debounceCount ).to.equal( 0 ); // Reset
            expect( state.dwellTime ).to.equal( null ); // No transition
            expect( state.prevValues.status ).to.equal( 'running' ); // Still in original state
        } );

        it( 'calculates correct dwell time with message timestamp', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'dwellTest',
                from: { x: [ 'mode' ] },
                debounce: 2,
                timestampField: 'timestamp',
                stats: {
                    dwellTime: { storeAs: 'modeDwell' },
                    dwellSamples: { storeAs: 'modeSamples' }
                }
            };

            const state = stateChangeDetector.init( spec );

            stateChangeDetector.update( state, createMessage( { mode: 'idle', timestamp: 1000 } ) );
            stateChangeDetector.update( state, createMessage( { mode: 'idle', timestamp: 2000 } ) );
            stateChangeDetector.update( state, createMessage( { mode: 'idle', timestamp: 3000 } ) );

            // Change
            stateChangeDetector.update( state, createMessage( { mode: 'active', timestamp: 4000 } ) );
            expect( state.dwellTime ).to.equal( null ); // Still debouncing

            stateChangeDetector.update( state, createMessage( { mode: 'active', timestamp: 5000 } ) );

            expect( state.dwellTime ).to.equal( 4000 ); // 5000 - 1000 = 4000ms in 'idle'
            expect( state.dwellSamples ).to.equal( 3 );
        } );

        it( 'uses Date.now() when timestampField not provided', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'dateNowTest',
                from: { x: [ 'state' ] },
                debounce: 1,
                stats: {
                    dwellTime: { storeAs: 'stateDwell' }
                }
            };

            const state = stateChangeDetector.init( spec );
            const before1 = Date.now();

            stateChangeDetector.update( state, createMessage( { state: 'A' } ) );
            stateChangeDetector.update( state, createMessage( { state: 'B' } ) );

            const after = Date.now();

            expect( state.dwellTime ).to.be.at.least( 0 );
            expect( state.dwellTime ).to.be.at.most( after - before1 );
        } );

        it( 'counts samples correctly', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'sampleTest',
                from: { x: [ 'value' ] },
                debounce: 2,
                stats: {
                    dwellSamples: { storeAs: 'valueSamples' }
                }
            };

            const state = stateChangeDetector.init( spec );

            stateChangeDetector.update( state, createMessage( { value: 'A' } ) );
            expect( state.samplesInState ).to.equal( 1 );

            stateChangeDetector.update( state, createMessage( { value: 'A' } ) );
            expect( state.samplesInState ).to.equal( 2 );

            stateChangeDetector.update( state, createMessage( { value: 'A' } ) );
            expect( state.samplesInState ).to.equal( 3 );

            // Change
            stateChangeDetector.update( state, createMessage( { value: 'B' } ) );
            expect( state.samplesInState ).to.equal( 3 ); // Not incremented during debounce

            stateChangeDetector.update( state, createMessage( { value: 'B' } ) );
            expect( state.dwellSamples ).to.equal( 3 ); // Samples in previous state 'A'

            const msg = Object.create( null );
            stateChangeDetector.publishTo( state, msg );
            expect( msg.valueSamples ).to.equal( 3 );

            expect( state.samplesInState ).to.equal( 1 ); // Reset after confirmation
        } );
    } );

    describe( 'Multi-field with changeMode="any"', function () {
        it( 'detects when any single field changes', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'multiAny',
                from: { x: [ 'health', 'trend' ] },
                debounce: 2,
                changeMode: 'any',
                stats: {
                    dwellTime: { storeAs: 'regimeDwell' }
                }
            };

            const state = stateChangeDetector.init( spec );

            stateChangeDetector.update( state, createMessage( { health: 'good', trend: 'rising' } ) );

            // Only health changes
            stateChangeDetector.update( state, createMessage( { health: 'degraded', trend: 'rising' } ) );
            expect( state.debounceCount ).to.equal( 1 );
            expect( state.dwellTime ).to.equal( null );

            stateChangeDetector.update( state, createMessage( { health: 'degraded', trend: 'rising' } ) );
            expect( state.dwellTime ).to.not.equal( null ); // Transition confirmed
            expect( state.prevValues.health ).to.equal( 'degraded' );
            expect( state.prevValues.trend ).to.equal( 'rising' );
        } );

        it( 'handles fields changing at different times', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'multiStagger',
                from: { x: [ 'field1', 'field2' ] },
                debounce: 3,
                changeMode: 'any',
                stats: {
                    dwellTime: { storeAs: 'anyDwell' }
                }
            };

            const state = stateChangeDetector.init( spec );

            stateChangeDetector.update( state, createMessage( { field1: 'A', field2: 'X' } ) );

            // field1 changes first
            stateChangeDetector.update( state, createMessage( { field1: 'B', field2: 'X' } ) );
            expect( state.debounceCount ).to.equal( 1 );

            // field2 changes during field1's debounce
            stateChangeDetector.update( state, createMessage( { field1: 'B', field2: 'Y' } ) );
            expect( state.debounceCount ).to.equal( 2 ); // Continues counting

            stateChangeDetector.update( state, createMessage( { field1: 'B', field2: 'Y' } ) );
            expect( state.dwellTime ).to.not.equal( null ); // Confirmed
            expect( state.prevValues.field1 ).to.equal( 'B' );
            expect( state.prevValues.field2 ).to.equal( 'Y' );
        } );

        it( 'resets debounce when any field returns to original', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'multiReset',
                from: { x: [ 'a', 'b' ] },
                debounce: 3,
                changeMode: 'any',
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = stateChangeDetector.init( spec );

            stateChangeDetector.update( state, createMessage( { a: '1', b: '1' } ) );

            // Both change
            stateChangeDetector.update( state, createMessage( { a: '2', b: '2' } ) );
            expect( state.debounceCount ).to.equal( 1 );

            // Return to original
            stateChangeDetector.update( state, createMessage( { a: '1', b: '1' } ) );
            expect( state.debounceCount ).to.equal( 0 ); // Reset
            expect( state.dwellTime ).to.equal( null ); // No transition
        } );
    } );

    describe( 'Multi-field with changeMode="all"', function () {
        it( 'requires all fields to change before detecting', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'multiAll',
                from: { x: [ 'phase', 'quality', 'speed' ] },
                debounce: 2,
                changeMode: 'all',
                stats: {
                    dwellTime: { storeAs: 'allDwell' }
                }
            };

            const state = stateChangeDetector.init( spec );

            stateChangeDetector.update( state, createMessage( { phase: 'A', quality: 'good', speed: 'fast' } ) );

            // Only one field changes
            stateChangeDetector.update( state, createMessage( { phase: 'B', quality: 'good', speed: 'fast' } ) );
            expect( state.debounceCount ).to.equal( 0 ); // No change detected in 'all' mode

            // Two fields change
            stateChangeDetector.update( state, createMessage( { phase: 'B', quality: 'poor', speed: 'fast' } ) );
            expect( state.debounceCount ).to.equal( 0 ); // Still not all

            // All three change
            stateChangeDetector.update( state, createMessage( { phase: 'B', quality: 'poor', speed: 'slow' } ) );
            expect( state.debounceCount ).to.equal( 1 ); // Now detecting

            stateChangeDetector.update( state, createMessage( { phase: 'B', quality: 'poor', speed: 'slow' } ) );
            expect( state.dwellTime ).to.not.equal( null ); // Confirmed
        } );

        it( 'does not trigger when only some fields change', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'partialChange',
                from: { x: [ 'x', 'y', 'z' ] },
                debounce: 3,
                changeMode: 'all',
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = stateChangeDetector.init( spec );

            stateChangeDetector.update( state, createMessage( { x: '1', y: '1', z: '1' } ) );
            stateChangeDetector.update( state, createMessage( { x: '1', y: '1', z: '1' } ) );

            // Only x and y change
            for ( let i = 0; i < 5; i += 1 ) {
                stateChangeDetector.update( state, createMessage( { x: '2', y: '2', z: '1' } ) );
            }

            expect( state.dwellTime ).to.equal( null ); // No transition
            expect( state.prevValues.x ).to.equal( '1' ); // Still original
        } );

        it( 'confirms when all fields stabilize in new state', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'allStabilize',
                from: { x: [ 'a', 'b' ] },
                debounce: 2,
                changeMode: 'all',
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = stateChangeDetector.init( spec );

            stateChangeDetector.update( state, createMessage( { a: 'X', b: 'X' } ) );

            // Both change together
            stateChangeDetector.update( state, createMessage( { a: 'Y', b: 'Y' } ) );
            expect( state.debounceCount ).to.equal( 1 );

            stateChangeDetector.update( state, createMessage( { a: 'Y', b: 'Y' } ) );
            expect( state.dwellTime ).to.not.equal( null ); // Confirmed
        } );
    } );

    describe( 'Validation - Non-categorical values', function () {
        let spec;

        before( function () {
            spec = {
                nodeType: 'State Change Detector',
                name: 'validationTest',
                from: { x: [ 'field' ] },
                debounce: 1,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };
        } );

        it( 'sets inputValidationFailed on undefined value', function () {
            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { field: 'init' } ) );
            expect( state.inputValidationFailed ).to.equal( false );

            const result = stateChangeDetector.update( state, createMessage( { field: undefined } ) );
            expect( result ).to.equal( state );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on null value', function () {
            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { field: 'init' } ) );

            const result = stateChangeDetector.update( state, createMessage( { field: null } ) );
            expect( result ).to.equal( state );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on object value', function () {
            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { field: 'init' } ) );

            const result = stateChangeDetector.update( state, createMessage( { field: { status: 'ok' } } ) );
            expect( result ).to.equal( state );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on array value', function () {
            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { field: 'init' } ) );

            const result = stateChangeDetector.update( state, createMessage( { field: [ 1, 2, 3 ] } ) );
            expect( result ).to.equal( state );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on function value', function () {
            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { field: 'init' } ) );

            const result = stateChangeDetector.update( state, createMessage( { field: function () { /* noop */ } } ) );
            expect( result ).to.equal( state );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on missing field', function () {
            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { field: 'init' } ) );

            const result = stateChangeDetector.update( state, createMessage( { other: 'value' } ) );
            expect( result ).to.equal( state );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'accepts string values', function () {
            const state = stateChangeDetector.init( spec );
            const result = stateChangeDetector.update( state, createMessage( { field: 'text' } ) );
            expect( result ).to.equal( state );
            expect( state.prevValues.field ).to.equal( 'text' );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'accepts number values', function () {
            const state = stateChangeDetector.init( spec );
            const result = stateChangeDetector.update( state, createMessage( { field: 42 } ) );
            expect( result ).to.equal( state );
            expect( state.prevValues.field ).to.equal( 42 );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'accepts boolean values', function () {
            const state = stateChangeDetector.init( spec );
            const result = stateChangeDetector.update( state, createMessage( { field: true } ) );
            expect( result ).to.equal( state );
            expect( state.prevValues.field ).to.equal( true );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'publishes NaN when inputValidationFailed is true', function () {
            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { field: 'init' } ) );
            stateChangeDetector.update( state, createMessage( { field: null } ) ); // Triggers validation failure

            const msg = Object.create( null );
            stateChangeDetector.publishTo( state, msg );
            expect( Number.isNaN( msg.dwell ) ).to.equal( true );
        } );

        it( 'recovers from inputValidationFailed on valid input', function () {
            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { field: 'init' } ) );
            stateChangeDetector.update( state, createMessage( { field: null } ) );
            expect( state.inputValidationFailed ).to.equal( true );

            // Valid message should recover
            stateChangeDetector.update( state, createMessage( { field: 'valid' } ) );
            expect( state.inputValidationFailed ).to.equal( false );
        } );
    } );

    describe( 'Edge cases', function () {
        it( 'handles boundary oscillation (categorize flicker)', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'oscillation',
                from: { x: [ 'category' ] },
                debounce: 3,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = stateChangeDetector.init( spec );

            stateChangeDetector.update( state, createMessage( { category: 'medium' } ) );

            // Oscillate around boundary
            const sequence = [ 'high', 'medium', 'high', 'medium', 'high', 'medium' ];
            sequence.forEach( ( cat ) => {
                stateChangeDetector.update( state, createMessage( { category: cat } ) );
            } );

            // Should never confirm due to oscillation
            expect( state.dwellTime ).to.equal( null );
            expect( state.prevValues.category ).to.equal( 'medium' );
        } );

        it( 'handles rapid state sequence (A→B→C)', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'rapid',
                from: { x: [ 'state' ] },
                debounce: 2,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = stateChangeDetector.init( spec );

            stateChangeDetector.update( state, createMessage( { state: 'A' } ) );

            // Quick transitions
            stateChangeDetector.update( state, createMessage( { state: 'B' } ) ); // debounce=1
            stateChangeDetector.update( state, createMessage( { state: 'C' } ) ); // debounce=2, confirmed!

            // Check immediately after transition
            expect( state.dwellTime ).to.not.equal( null );
            expect( state.prevValues.state ).to.equal( 'C' );

            // Next message resets dwellTime
            stateChangeDetector.update( state, createMessage( { state: 'C' } ) );
            expect( state.dwellTime ).to.equal( null );
        } );

        it( 'handles all fields changing simultaneously', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'simultaneous',
                from: { x: [ 'a', 'b', 'c' ] },
                debounce: 2,
                changeMode: 'any',
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = stateChangeDetector.init( spec );

            stateChangeDetector.update( state, createMessage( { a: '1', b: '1', c: '1' } ) );

            // All change at once
            stateChangeDetector.update( state, createMessage( { a: '2', b: '2', c: '2' } ) );
            expect( state.debounceCount ).to.equal( 1 );

            stateChangeDetector.update( state, createMessage( { a: '2', b: '2', c: '2' } ) );
            expect( state.dwellTime ).to.not.equal( null );
        } );

        it( 'handles debounce=1 (immediate confirmation)', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'immediate',
                from: { x: [ 'value' ] },
                debounce: 1,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = stateChangeDetector.init( spec );

            stateChangeDetector.update( state, createMessage( { value: 'A' } ) );
            stateChangeDetector.update( state, createMessage( { value: 'B' } ) );

            expect( state.dwellTime ).to.not.equal( null );
            expect( state.prevValues.value ).to.equal( 'B' );
        } );

        it( 'handles multiple consecutive transitions', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'multiTransition',
                from: { x: [ 'state' ] },
                debounce: 1,
                timestampField: 'ts',
                stats: {
                    dwellTime: { storeAs: 'dwell' },
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = stateChangeDetector.init( spec );

            // First state
            stateChangeDetector.update( state, createMessage( { state: 'A', ts: 1000 } ) );
            stateChangeDetector.update( state, createMessage( { state: 'A', ts: 2000 } ) );

            // Transition to B
            stateChangeDetector.update( state, createMessage( { state: 'B', ts: 3000 } ) );
            expect( state.dwellTime ).to.equal( 2000 );
            expect( state.dwellSamples ).to.equal( 2 );

            // Stable in B
            stateChangeDetector.update( state, createMessage( { state: 'B', ts: 4000 } ) );
            expect( state.dwellTime ).to.equal( null ); // Back to null

            stateChangeDetector.update( state, createMessage( { state: 'B', ts: 5000 } ) );
            stateChangeDetector.update( state, createMessage( { state: 'B', ts: 6000 } ) );

            // Transition to C
            stateChangeDetector.update( state, createMessage( { state: 'C', ts: 7000 } ) );
            expect( state.dwellTime ).to.equal( 4000 ); // 7000 - 3000
            expect( state.dwellSamples ).to.equal( 4 );
        } );
    } );

    describe( 'Stats publishing', function () {
        it( 'publishes null dwellTime when no transition', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'publishTest',
                from: { x: [ 'state' ] },
                debounce: 2,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { state: 'A' } ) );

            const msg = Object.create( null );
            stateChangeDetector.publishTo( state, msg );

            expect( msg.dwell ).to.equal( null );
        } );

        it( 'publishes dwellTime value on transition', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'dwellPublish',
                from: { x: [ 'state' ] },
                debounce: 1,
                timestampField: 'ts',
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { state: 'A', ts: 1000 } ) );
            stateChangeDetector.update( state, createMessage( { state: 'B', ts: 5000 } ) );

            const msg = Object.create( null );
            stateChangeDetector.publishTo( state, msg );
            expect( msg.dwell ).to.equal( 4000 ); // 5000 - 1000
        } );

        it( 'publishes null after transition message', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'publishTest2',
                from: { x: [ 'state' ] },
                debounce: 1,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { state: 'A' } ) );
            stateChangeDetector.update( state, createMessage( { state: 'B' } ) );

            const msg1 = Object.create( null );
            stateChangeDetector.publishTo( state, msg1 );
            expect( msg1.dwell ).to.not.equal( null );

            // Next message
            stateChangeDetector.update( state, createMessage( { state: 'B' } ) );
            const msg2 = Object.create( null );
            stateChangeDetector.publishTo( state, msg2 );
            expect( msg2.dwell ).to.equal( null );
        } );

        it( 'publishes dwellSamples correctly', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'samplesPublish',
                from: { x: [ 'state' ] },
                debounce: 2,
                stats: {
                    dwellSamples: { storeAs: 'count' }
                }
            };

            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { state: 'A' } ) );
            stateChangeDetector.update( state, createMessage( { state: 'A' } ) );
            stateChangeDetector.update( state, createMessage( { state: 'A' } ) );

            const msg1 = Object.create( null );
            stateChangeDetector.publishTo( state, msg1 );
            expect( msg1.count ).to.equal( null ); // No change yet

            stateChangeDetector.update( state, createMessage( { state: 'B' } ) );
            stateChangeDetector.update( state, createMessage( { state: 'B' } ) );

            const msg2 = Object.create( null );
            stateChangeDetector.publishTo( state, msg2 );
            expect( msg2.count ).to.equal( 3 ); // Samples in state 'A'
        } );

        it( 'handles optional stats (only dwellTime requested)', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'optionalStats',
                from: { x: [ 'state' ] },
                debounce: 1,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                    // No dwellSamples
                }
            };

            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { state: 'A' } ) );
            stateChangeDetector.update( state, createMessage( { state: 'B' } ) );

            const msg = Object.create( null );
            stateChangeDetector.publishTo( state, msg );

            expect( msg.dwell ).to.not.equal( null );
            expect( msg.dwellSamples ).to.equal( undefined );
        } );

        it( 'handles optional stats (only dwellSamples requested)', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'optionalStats2',
                from: { x: [ 'state' ] },
                debounce: 1,
                stats: {
                    dwellSamples: { storeAs: 'samples' }
                    // No dwellTime
                }
            };

            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { state: 'A' } ) );
            stateChangeDetector.update( state, createMessage( { state: 'B' } ) );

            const msg = Object.create( null );
            stateChangeDetector.publishTo( state, msg );

            expect( msg.samples ).to.not.equal( null );
            expect( msg.dwellTime ).to.equal( undefined );
        } );

        it( 'publishes both stats when both requested', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'bothStats',
                from: { x: [ 'state' ] },
                debounce: 1,
                timestampField: 'ts',
                stats: {
                    dwellTime: { storeAs: 'dwell' },
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { state: 'A', ts: 1000 } ) );
            stateChangeDetector.update( state, createMessage( { state: 'A', ts: 2000 } ) );
            stateChangeDetector.update( state, createMessage( { state: 'B', ts: 3000 } ) );

            const msg = Object.create( null );
            stateChangeDetector.publishTo( state, msg );

            expect( msg.dwell ).to.equal( 2000 );
            expect( msg.samples ).to.equal( 2 );
        } );
    } );

    describe( 'Spec validation', function () {
        it( 'rejects invalid nodeType', function () {
            const badSpec = {
                nodeType: 'INVALID',
                name: 'test',
                from: { x: [ 'field' ] },
                stats: { dwellTime: { storeAs: 'result' } }
            };
            expect( () => stateChangeDetector.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid name', function () {
            const badSpec = {
                nodeType: 'State Change Detector',
                name: '123-invalid',
                from: { x: [ 'field' ] },
                stats: { dwellTime: { storeAs: 'result' } }
            };
            expect( () => stateChangeDetector.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing from.x', function () {
            const badSpec = {
                nodeType: 'State Change Detector',
                name: 'test',
                from: { },
                stats: { dwellTime: { storeAs: 'result' } }
            };
            expect( () => stateChangeDetector.init( badSpec ) ).to.throw();
        } );

        it( 'rejects empty from.x array', function () {
            const badSpec = {
                nodeType: 'State Change Detector',
                name: 'test',
                from: { x: [ ] },
                stats: { dwellTime: { storeAs: 'result' } }
            };
            expect( () => stateChangeDetector.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid debounce (zero)', function () {
            const badSpec = {
                nodeType: 'State Change Detector',
                name: 'test',
                from: { x: [ 'field' ] },
                debounce: 0,
                stats: { dwellTime: { storeAs: 'result' } }
            };
            expect( () => stateChangeDetector.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid debounce (negative)', function () {
            const badSpec = {
                nodeType: 'State Change Detector',
                name: 'test',
                from: { x: [ 'field' ] },
                debounce: -1,
                stats: { dwellTime: { storeAs: 'result' } }
            };
            expect( () => stateChangeDetector.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid changeMode', function () {
            const badSpec = {
                nodeType: 'State Change Detector',
                name: 'test',
                from: { x: [ 'field' ] },
                changeMode: 'invalid',
                stats: { dwellTime: { storeAs: 'result' } }
            };
            expect( () => stateChangeDetector.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid timestampField', function () {
            const badSpec = {
                nodeType: 'State Change Detector',
                name: 'test',
                from: { x: [ 'field' ] },
                timestampField: 'invalid-name',
                stats: { dwellTime: { storeAs: 'result' } }
            };
            expect( () => stateChangeDetector.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid storeAs', function () {
            const badSpec = {
                nodeType: 'State Change Detector',
                name: 'test',
                from: { x: [ 'field' ] },
                stats: { dwellTime: { storeAs: 'invalid-store' } }
            };
            expect( () => stateChangeDetector.init( badSpec ) ).to.throw();
        } );

        it( 'rejects unsupported stat name', function () {
            const badSpec = {
                nodeType: 'State Change Detector',
                name: 'test',
                from: { x: [ 'field' ] },
                stats: { unsupported: { storeAs: 'result' } }
            };
            expect( () => stateChangeDetector.init( badSpec ) ).to.throw();
        } );

        it( 'rejects field name with spaces', function () {
            const badSpec = {
                nodeType: 'State Change Detector',
                name: 'test',
                from: { x: [ 'field name' ] },
                stats: { dwellTime: { storeAs: 'result' } }
            };
            expect( () => stateChangeDetector.init( badSpec ) ).to.throw();
        } );

        it( 'accepts valid spec with all options', function () {
            const goodSpec = {
                nodeType: 'State Change Detector',
                name: 'validTest',
                from: { x: [ 'field1', 'field2' ] },
                debounce: 5,
                changeMode: 'all',
                timestampField: 'ts',
                stats: {
                    dwellTime: { storeAs: 'dwell' },
                    dwellSamples: { storeAs: 'samples' }
                }
            };
            expect( () => stateChangeDetector.init( goodSpec ) ).to.not.throw();
        } );
    } );

    describe( 'Reset', function () {
        it( 'resets all state properly', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'resetTest',
                from: { x: [ 'a', 'b' ] },
                debounce: 2,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = stateChangeDetector.init( spec );

            stateChangeDetector.update( state, createMessage( { a: '1', b: '1' } ) );
            stateChangeDetector.update( state, createMessage( { a: '2', b: '2' } ) );
            stateChangeDetector.update( state, createMessage( { a: '2', b: '2' } ) );

            expect( state.dwellTime ).to.not.equal( null );
            expect( state.prevValues.a ).to.equal( '2' );

            stateChangeDetector.reset( state );

            expect( state.prevValues.a ).to.equal( null );
            expect( state.prevValues.b ).to.equal( null );
            expect( state.debounceCount ).to.equal( 0 );
            expect( state.stateStartTime ).to.equal( null );
            expect( state.samplesInState ).to.equal( 0 );
            expect( state.dwellTime ).to.equal( null );
            expect( state.dwellSamples ).to.equal( null );
        } );

        it( 're-initializes cleanly after reset', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'reinit',
                from: { x: [ 'state' ] },
                debounce: 1,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = stateChangeDetector.init( spec );

            stateChangeDetector.update( state, createMessage( { state: 'A' } ) );
            stateChangeDetector.update( state, createMessage( { state: 'B' } ) );
            expect( state.prevValues.state ).to.equal( 'B' );

            stateChangeDetector.reset( state );

            stateChangeDetector.update( state, createMessage( { state: 'C' } ) );
            expect( state.prevValues.state ).to.equal( 'C' );
            expect( state.samplesInState ).to.equal( 1 );
            expect( state.dwellTime ).to.equal( null );
        } );

        it( 'reset clears inputValidationFailed implicitly via null stats', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'resetValidation',
                from: { x: [ 'field' ] },
                debounce: 1,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = stateChangeDetector.init( spec );
            stateChangeDetector.update( state, createMessage( { field: 'init' } ) );
            stateChangeDetector.update( state, createMessage( { field: null } ) );
            expect( state.inputValidationFailed ).to.equal( true );

            stateChangeDetector.reset( state );
            expect( state.dwellTime ).to.equal( null );

            // After reset, valid message should work normally
            stateChangeDetector.update( state, createMessage( { field: 'valid' } ) );
            expect( state.inputValidationFailed ).to.equal( false );
        } );
    } );

    describe( 'Recompute', function () {
        it( 'returns true (no-op)', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'recompute',
                from: { x: [ 'field' ] },
                stats: { dwellTime: { storeAs: 'dwell' } }
            };

            const state = stateChangeDetector.init( spec );
            const result = stateChangeDetector.recompute( state );
            expect( result ).to.equal( true );
        } );
    } );

    describe( 'Helper: validateCategoricalFields', function () {
        it( 'returns true for valid categorical fields', function () {
            const msg = createMessage( { a: 'text', b: 42, c: true } );
            const result = validateCategoricalFields( msg, [ 'a', 'b', 'c' ], 3 );
            expect( result ).to.equal( true );
        } );

        it( 'returns false for missing field', function () {
            const msg = createMessage( { a: 'text', b: 42 } );
            const result = validateCategoricalFields( msg, [ 'a', 'b', 'c' ], 3 );
            expect( result ).to.equal( false );
        } );

        it( 'returns false for undefined value', function () {
            const msg = createMessage( { a: 'text', b: undefined } );
            const result = validateCategoricalFields( msg, [ 'a', 'b' ], 2 );
            expect( result ).to.equal( false );
        } );

        it( 'returns false for null value', function () {
            const msg = createMessage( { a: 'text', b: null } );
            const result = validateCategoricalFields( msg, [ 'a', 'b' ], 2 );
            expect( result ).to.equal( false );
        } );

        it( 'returns false for object value', function () {
            const msg = createMessage( { a: 'text', b: { key: 'value' } } );
            const result = validateCategoricalFields( msg, [ 'a', 'b' ], 2 );
            expect( result ).to.equal( false );
        } );

        it( 'returns false for array value', function () {
            const msg = createMessage( { a: 'text', b: [ 1, 2, 3 ] } );
            const result = validateCategoricalFields( msg, [ 'a', 'b' ], 2 );
            expect( result ).to.equal( false );
        } );

        it( 'accepts string values', function () {
            const msg = createMessage( { field: 'text' } );
            const result = validateCategoricalFields( msg, [ 'field' ], 1 );
            expect( result ).to.equal( true );
        } );

        it( 'accepts number values', function () {
            const msg = createMessage( { field: 123 } );
            const result = validateCategoricalFields( msg, [ 'field' ], 1 );
            expect( result ).to.equal( true );
        } );

        it( 'accepts boolean values', function () {
            const msg = createMessage( { field: false } );
            const result = validateCategoricalFields( msg, [ 'field' ], 1 );
            expect( result ).to.equal( true );
        } );

        it( 'validates all fields before returning true', function () {
            const msg = createMessage( { a: 'ok', b: 'ok', c: { invalid: true } } );
            const result = validateCategoricalFields( msg, [ 'a', 'b', 'c' ], 3 );
            expect( result ).to.equal( false );
        } );

        it( 'short-circuits on first invalid field', function () {
            const msg = createMessage( { a: null, b: 'text', c: 'text' } );
            const result = validateCategoricalFields( msg, [ 'a', 'b', 'c' ], 3 );
            expect( result ).to.equal( false );
        } );
    } );

    describe( 'Introspect accessors', function () {
        it( 'returns expected node type', function () {
            expect( getNodeType() ).to.equal( 'State Change Detector' );
        } );

        it( 'getSupportedStats returns a copy and includes expected stats', function () {
            const stats = getSupportedStats();
            expect( stats ).to.be.an( 'array' );
            expect( stats ).to.have.lengthOf( 2 );
            expect( stats ).to.include.members( [ 'dwellTime', 'dwellSamples' ] );

            // Verify it's a copy
            stats.push( '___mutation___' );
            const stats2 = getSupportedStats();
            expect( stats2 ).to.not.include( '___mutation___' );
        } );

        it( 'getStatDescriptions returns a copy with descriptions', function () {
            const desc1 = getStatDescriptions();
            expect( desc1 ).to.be.an( 'object' );
            expect( desc1 ).to.have.property( 'dwellTime' ).that.is.a( 'string' );
            expect( desc1 ).to.have.property( 'dwellSamples' ).that.is.a( 'string' );

            // Verify it's a copy
            desc1.dwellTime = '__mutated__';
            const desc2 = getStatDescriptions();
            expect( desc2.dwellTime ).to.not.equal( '__mutated__' );
        } );

        it( 'getSupportedControlMethods returns reset/enable/disable', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'reset' );
            expect( methods ).to.have.property( 'enable' );
            expect( methods ).to.have.property( 'disable' );
        } );

        it( 'getCapabilities returns a copy with description and features', function () {
            const cap1 = getCapabilities();
            expect( cap1 ).to.be.an( 'object' );
            expect( cap1 ).to.have.property( 'description' ).that.is.a( 'string' );
            expect( cap1 ).to.have.property( 'features' ).that.is.an( 'array' );

            // Verify it's a copy
            cap1.features.push( '___mutation___' );
            const cap2 = getCapabilities();
            expect( cap2.features ).to.not.include( '___mutation___' );
        } );

        it( 'getDSLMetadata returns metadata with expected structure', function () {
            const dsl = getDSLMetadata();
            expect( dsl ).to.be.an( 'object' );
            expect( dsl ).to.have.property( 'specSchema' );
            expect( dsl ).to.have.property( 'buildSpec' );
        } );

        it( 'getDSLMetadata.buildSpec creates valid spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'scdNode',
                [ 'health', 'status' ],
                { dwellTime: { storeAs: 'dwell' }, dwellSamples: { storeAs: 'count' } },
                { debounce: 5, changeMode: 'all' }
            );
            expect( spec.nodeType ).to.equal( 'State Change Detector' );
            expect( spec.name ).to.equal( 'scdNode' );
            expect( spec.from.x ).to.deep.equal( [ 'health', 'status' ] );
            expect( spec.stats.dwellTime.storeAs ).to.equal( 'dwell' );
            expect( spec.stats.dwellSamples.storeAs ).to.equal( 'count' );
            expect( spec.debounce ).to.equal( 5 );
            expect( spec.changeMode ).to.equal( 'all' );
        } );

        it( 'getDSLMetadata.buildSpec creates minimal spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'minNode',
                [ 'sensor' ],
                { dwellSamples: { storeAs: 'samples' } },
                {}
            );
            expect( spec.nodeType ).to.equal( 'State Change Detector' );
            expect( spec.name ).to.equal( 'minNode' );
            expect( spec.from.x ).to.deep.equal( [ 'sensor' ] );
        } );
    } );

    describe( 'Disable functionality', function () {
        it( 'skips update when disabled', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'disableTest',
                from: { x: [ 'health' ] },
                debounce: 1,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };
            const state = stateChangeDetector.init( spec );

            // First message initializes prevValues
            stateChangeDetector.update( state, createMessage( { health: 'good' } ) );
            expect( state.prevValues.health ).to.equal( 'good' );

            // Disable the node
            state.disable = true;

            // Send a changed message — should be ignored
            stateChangeDetector.update( state, createMessage( { health: 'bad' } ) );
            expect( state.prevValues.health ).to.equal( 'good' ); // Unchanged
        } );

        it( 'does not publish when disabled', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'disablePub',
                from: { x: [ 'health' ] },
                debounce: 1,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };
            const state = stateChangeDetector.init( spec );

            // First message initializes state
            stateChangeDetector.update( state, createMessage( { health: 'good' } ) );

            // Disable the node
            state.disable = true;

            const output = Object.create( null );
            stateChangeDetector.publishTo( state, output );
            expect( output.dwell ).to.equal( undefined );
        } );
    } );

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'pauseTest',
                from: { x: [ 'health' ] },
                debounce: 1,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };
            const state = stateChangeDetector.init( spec );

            // First message initializes prevValues
            stateChangeDetector.update( state, createMessage( { health: 'good' } ) );
            expect( state.prevValues.health ).to.equal( 'good' );

            // Pause the node
            state.pause = true;

            // Send a changed message — should be ignored
            stateChangeDetector.update( state, createMessage( { health: 'bad' } ) );
            expect( state.prevValues.health ).to.equal( 'good' ); // Unchanged
        } );

        it( 'publishes when paused', function () {
            const spec = {
                nodeType: 'State Change Detector',
                name: 'pausePub',
                from: { x: [ 'health' ] },
                debounce: 1,
                stats: {
                    dwellSamples: { storeAs: 'samples' }
                }
            };
            const state = stateChangeDetector.init( spec );

            // First message initializes state
            stateChangeDetector.update( state, createMessage( { health: 'good' } ) );

            // Pause the node
            state.pause = true;

            const output = Object.create( null );
            stateChangeDetector.publishTo( state, output );
            expect( output.samples ).to.not.equal( undefined );
        } );

        it( 'pause/unpause control methods exist', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );
    } );
} );

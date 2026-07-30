/* eslint-disable max-lines */
// nodes/dwell-time-tracker/test.js

import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import sinon from 'sinon';
import * as dwellTimeTracker from '../index.js';
import {
    getDSLMetadata,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities
} from '../introspect.js';

const createMessage = function ( values ) {
    const msg = Object.create( null );
    Object.keys( values ).forEach( ( key ) => {
        msg[ key ] = values[ key ];
    } );
    return msg;
};

describe( 'Dwell Time Tracker', function () {
    describe( 'Basic functionality', function () {
        it( 'initializes on first message without edge detection', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.active,
                stats: {
                    active: { storeAs: 'isActive' },
                    dwellTime: { storeAs: 'dwell' },
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { active: true } ) );

            expect( state.active ).to.equal( true );
            expect( state.wasActive ).to.equal( false );
            expect( state.hasSeenFirstValue ).to.equal( true );
            expect( state.dwellTime ).to.equal( null ); // No edge on first message
            expect( state.dwellSamples ).to.equal( null );
            expect( state.sampleCount ).to.equal( 1 );
        } );

        it( 'detects rising edge (false → true)', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                timestampField: 'ts',
                stats: {
                    active: { storeAs: 'active' },
                    dwellTime: { storeAs: 'dwell' },
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            dwellTimeTracker.update( state, createMessage( { value: false, ts: 1000 } ) );
            dwellTimeTracker.update( state, createMessage( { value: false, ts: 2000 } ) );
            dwellTimeTracker.update( state, createMessage( { value: false, ts: 3000 } ) );

            // Rising edge
            dwellTimeTracker.update( state, createMessage( { value: true, ts: 4000 } ) );

            expect( state.active ).to.equal( true );
            expect( state.dwellTime ).to.equal( 3000 ); // 4000 - 1000
            expect( state.dwellSamples ).to.equal( 3 );
        } );

        it( 'detects falling edge (true → false)', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                timestampField: 'ts',
                stats: {
                    active: { storeAs: 'active' },
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            dwellTimeTracker.update( state, createMessage( { value: true, ts: 1000 } ) );
            dwellTimeTracker.update( state, createMessage( { value: true, ts: 2000 } ) );

            // Falling edge
            dwellTimeTracker.update( state, createMessage( { value: false, ts: 3000 } ) );

            expect( state.active ).to.equal( false );
            expect( state.dwellTime ).to.equal( 2000 ); // 3000 - 1000
        } );

        it( 'keeps dwellTime/dwellSamples null when no transition', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' },
                    dwellTime: { storeAs: 'dwell' },
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.dwellTime ).to.equal( null );

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.dwellTime ).to.equal( null );

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.dwellTime ).to.equal( null );
            expect( state.dwellSamples ).to.equal( null );
        } );

        it( 'uses Date.now() when timestampField not provided', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            const before1 = Date.now();

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            const after = Date.now();

            expect( state.dwellTime ).to.be.at.least( 0 );
            expect( state.dwellTime ).to.be.at.most( after - before1 );
        } );
    } );

    describe( 'Sample counting', function () {
        it( 'counts samples correctly in each state', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' },
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            // First state
            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            expect( state.sampleCount ).to.equal( 1 );

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            expect( state.sampleCount ).to.equal( 2 );

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            expect( state.sampleCount ).to.equal( 3 );

            // Transition
            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.dwellSamples ).to.equal( 3 ); // Previous state count
            expect( state.sampleCount ).to.equal( 1 ); // Reset for new state

            // New state
            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.sampleCount ).to.equal( 2 );
        } );

        it( 'resets sample count on each transition', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.sampleCount ).to.equal( 1 );

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.sampleCount ).to.equal( 4 );

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            expect( state.dwellSamples ).to.equal( 4 );
            expect( state.sampleCount ).to.equal( 1 );
        } );

        it( 'counts samples even without duration tracking', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' } // Only active, no duration stats
                }
            };

            const state = dwellTimeTracker.init( spec );
            expect( state.needsDurationTracking ).to.equal( false );

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            expect( state.sampleCount ).to.equal( 1 );

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            expect( state.sampleCount ).to.equal( 2 );

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.sampleCount ).to.equal( 1 ); // Reset on transition

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.sampleCount ).to.equal( 2 );
        } );
    } );

    describe( 'Edge detection pattern', function () {
        it( 'dwellTime !== null detects edges', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            expect( state.dwellTime ).to.equal( null ); // First message

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            expect( state.dwellTime ).to.equal( null ); // No change

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.dwellTime ).to.not.equal( null ); // Edge!

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.dwellTime ).to.equal( null ); // No change
        } );

        it( 'dwellSamples !== null detects edges', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.dwellSamples ).to.equal( null );

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            expect( state.dwellSamples ).to.not.equal( null ); // Edge!

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            expect( state.dwellSamples ).to.equal( null );
        } );
    } );

    describe( 'Timestamp handling', function () {
        it( 'calculates correct dwell time with message timestamps', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.active,
                timestampField: 'ts',
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            dwellTimeTracker.update( state, createMessage( { active: false, ts: 1000 } ) );
            dwellTimeTracker.update( state, createMessage( { active: false, ts: 2000 } ) );
            dwellTimeTracker.update( state, createMessage( { active: false, ts: 3000 } ) );
            dwellTimeTracker.update( state, createMessage( { active: true, ts: 7000 } ) );

            expect( state.dwellTime ).to.equal( 6000 ); // 7000 - 1000
        } );

        it( 'handles negative time differences (clock skew)', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                timestampField: 'ts',
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            dwellTimeTracker.update( state, createMessage( { value: false, ts: 5000 } ) );
            dwellTimeTracker.update( state, createMessage( { value: true, ts: 3000 } ) ); // Clock went backwards!

            expect( state.dwellTime ).to.equal( 0 ); // Clamped to 0
        } );

        it( 'sets inputValidationFailed on NaN timestamp', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                timestampField: 'ts',
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            dwellTimeTracker.update( state, createMessage( { value: false, ts: 1000 } ) );
            dwellTimeTracker.update( state, createMessage( { value: true, ts: NaN } ) );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on Infinity timestamp', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                timestampField: 'ts',
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            dwellTimeTracker.update( state, createMessage( { value: false, ts: 1000 } ) );
            dwellTimeTracker.update( state, createMessage( { value: true, ts: Infinity } ) );

            expect( state.inputValidationFailed ).to.equal( true );
        } );
    } );

    describe( 'Predicate validation', function () {
        let spec;

        before( function () {
            spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' }
                }
            };
        } );

        it( 'accepts valid boolean true', function () {
            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            expect( state.active ).to.equal( true );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'accepts valid boolean false', function () {
            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: false } ) );

            expect( state.active ).to.equal( false );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'sets inputValidationFailed on string return', function () {
            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: 'true' } ) );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on number return', function () {
            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: 1 } ) );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on undefined return', function () {
            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: undefined } ) );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on null return', function () {
            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: null } ) );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on object return', function () {
            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: { status: true } } ) );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on array return', function () {
            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: [ true ] } ) );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed when predicate throws', function () {
            const failingSpec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( _msg ) => {
                    throw new Error( 'Predicate error' );
                },
                stats: {
                    active: { storeAs: 'active' }
                }
            };

            const state = dwellTimeTracker.init( failingSpec );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'logs predicate error to console', function () {
            const stub = sinon.stub( console, 'error' );

            const failingSpec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( _msg ) => {
                    throw new Error( 'Predicate error' );
                },
                stats: {
                    active: { storeAs: 'active' }
                }
            };

            const state = dwellTimeTracker.init( failingSpec );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            expect( stub.calledOnce ).to.equal( true );
            expect( stub.firstCall.args[ 0 ] ).to.include( 'predicate threw exception' );

            stub.restore();
        } );

        it( 'suppresses log on repeated predicate exceptions', function () {
            const stub = sinon.stub( console, 'error' );

            const failingSpec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( _msg ) => {
                    throw new Error( 'Predicate error' );
                },
                stats: {
                    active: { storeAs: 'active' }
                }
            };

            const state = dwellTimeTracker.init( failingSpec );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            expect( stub.calledOnce ).to.equal( true );

            stub.restore();
        } );

        it( 'logs again after predicate recovery', function () {
            const stub = sinon.stub( console, 'error' );

            let shouldThrow = true;
            const intermittentSpec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( _msg ) => {
                    if ( shouldThrow ) {
                        throw new Error( 'intermittent error' );
                    }
                    return true;
                },
                stats: {
                    active: { storeAs: 'active' }
                }
            };

            const state = dwellTimeTracker.init( intermittentSpec );

            // First error — logs
            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( stub.calledOnce ).to.equal( true );

            // Recovery
            shouldThrow = false;
            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            // Second error — logs again (new episode)
            shouldThrow = true;
            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( stub.calledTwice ).to.equal( true );

            stub.restore();
        } );

        it( 'recovers from inputValidationFailed on valid input', function () {
            const state = dwellTimeTracker.init( spec );

            dwellTimeTracker.update( state, createMessage( { value: 'invalid' } ) );
            expect( state.inputValidationFailed ).to.equal( true );

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.inputValidationFailed ).to.equal( false );
        } );
    } );

    describe( 'Triggers', function () {
        it( 'executes triggers on rising edge', function () {
            let triggerCount = 0;
            const mockTarget = Object.create( null );
            mockTarget.reset = function () {
                triggerCount += 1;
            };

            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            state.resolvedTriggers = [
                {
                    control: mockTarget.reset,
                    targets: [ mockTarget ]
                }
            ];

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            expect( triggerCount ).to.equal( 0 );

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( triggerCount ).to.equal( 1 ); // Triggered!
        } );

        it( 'executes triggers on falling edge', function () {
            let triggerCount = 0;
            const mockTarget = Object.create( null );
            mockTarget.reset = function () {
                triggerCount += 1;
            };

            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            state.resolvedTriggers = [
                {
                    control: mockTarget.reset,
                    targets: [ mockTarget ]
                }
            ];

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( triggerCount ).to.equal( 0 );

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            expect( triggerCount ).to.equal( 1 ); // Triggered!
        } );

        it( 'does not execute triggers when state unchanged', function () {
            let triggerCount = 0;
            const mockTarget = Object.create( null );
            mockTarget.reset = function () {
                triggerCount += 1;
            };

            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            state.resolvedTriggers = [
                {
                    control: mockTarget.reset,
                    targets: [ mockTarget ]
                }
            ];

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            expect( triggerCount ).to.equal( 0 ); // Never triggered
        } );

        it( 'does not execute triggers on first message', function () {
            let triggerCount = 0;
            const mockTarget = Object.create( null );
            mockTarget.reset = function () {
                triggerCount += 1;
            };

            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            state.resolvedTriggers = [
                {
                    control: mockTarget.reset,
                    targets: [ mockTarget ]
                }
            ];

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( triggerCount ).to.equal( 0 ); // Not triggered on first message
        } );

        it( 'executes triggers even without duration tracking', function () {
            let triggerCount = 0;
            const mockTarget = Object.create( null );
            mockTarget.reset = function () {
                triggerCount += 1;
            };

            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' } // No duration stats
                }
            };

            const state = dwellTimeTracker.init( spec );
            expect( state.needsDurationTracking ).to.equal( false );

            state.resolvedTriggers = [
                {
                    control: mockTarget.reset,
                    targets: [ mockTarget ]
                }
            ];

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            expect( triggerCount ).to.equal( 1 ); // Triggered even without duration tracking
        } );
    } );

    describe( 'Stats publishing', function () {
        it( 'publishes active stat', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'isActive' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            const msg = Object.create( null );
            dwellTimeTracker.publishTo( state, msg );

            expect( msg.isActive ).to.equal( true );
        } );

        it( 'publishes null dwellTime when no transition', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            const msg = Object.create( null );
            dwellTimeTracker.publishTo( state, msg );

            expect( msg.dwell ).to.equal( null );
        } );

        it( 'publishes numeric dwellTime on transition', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                timestampField: 'ts',
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: false, ts: 1000 } ) );
            dwellTimeTracker.update( state, createMessage( { value: true, ts: 3000 } ) );

            const msg = Object.create( null );
            dwellTimeTracker.publishTo( state, msg );

            expect( msg.dwell ).to.equal( 2000 );
        } );

        it( 'publishes null dwellSamples when no transition', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            const msg = Object.create( null );
            dwellTimeTracker.publishTo( state, msg );

            expect( msg.samples ).to.equal( null );
        } );

        it( 'publishes numeric dwellSamples on transition', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            const msg = Object.create( null );
            dwellTimeTracker.publishTo( state, msg );

            expect( msg.samples ).to.equal( 3 );
        } );

        it( 'handles optional stats (only active requested)', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            const msg = Object.create( null );
            dwellTimeTracker.publishTo( state, msg );

            expect( msg.active ).to.equal( true );
            expect( msg.dwellTime ).to.equal( undefined );
            expect( msg.dwellSamples ).to.equal( undefined );
        } );

        it( 'handles optional stats (only dwellTime requested)', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            const msg = Object.create( null );
            dwellTimeTracker.publishTo( state, msg );

            expect( msg.dwell ).to.not.equal( null );
            expect( msg.active ).to.equal( undefined );
            expect( msg.dwellSamples ).to.equal( undefined );
        } );

        it( 'publishes all stats when all requested', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                timestampField: 'ts',
                stats: {
                    active: { storeAs: 'active' },
                    dwellTime: { storeAs: 'dwell' },
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: false, ts: 1000 } ) );
            dwellTimeTracker.update( state, createMessage( { value: false, ts: 2000 } ) );
            dwellTimeTracker.update( state, createMessage( { value: true, ts: 3000 } ) );

            const msg = Object.create( null );
            dwellTimeTracker.publishTo( state, msg );

            expect( msg.active ).to.equal( true );
            expect( msg.dwell ).to.equal( 2000 );
            expect( msg.samples ).to.equal( 2 );
        } );

        it( 'publishes NaN when inputValidationFailed is true', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' },
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: 'invalid' } ) );

            const msg = Object.create( null );
            dwellTimeTracker.publishTo( state, msg );

            expect( Number.isNaN( msg.active ) ).to.equal( true );
            expect( Number.isNaN( msg.dwell ) ).to.equal( true );
        } );
    } );

    describe( 'Edge cases', function () {
        it( 'handles multiple consecutive transitions', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                timestampField: 'ts',
                stats: {
                    active: { storeAs: 'active' },
                    dwellTime: { storeAs: 'dwell' },
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            // First state
            dwellTimeTracker.update( state, createMessage( { value: false, ts: 1000 } ) );
            dwellTimeTracker.update( state, createMessage( { value: false, ts: 2000 } ) );

            // Transition 1
            dwellTimeTracker.update( state, createMessage( { value: true, ts: 3000 } ) );
            expect( state.dwellTime ).to.equal( 2000 );
            expect( state.dwellSamples ).to.equal( 2 );

            dwellTimeTracker.update( state, createMessage( { value: true, ts: 4000 } ) );
            expect( state.dwellTime ).to.equal( null ); // Reset

            // Transition 2
            dwellTimeTracker.update( state, createMessage( { value: false, ts: 5000 } ) );
            expect( state.dwellTime ).to.equal( 2000 ); // 5000 - 3000
            expect( state.dwellSamples ).to.equal( 2 );

            // Transition 3
            dwellTimeTracker.update( state, createMessage( { value: true, ts: 6000 } ) );
            expect( state.dwellTime ).to.equal( 1000 ); // 6000 - 5000
            expect( state.dwellSamples ).to.equal( 1 );
        } );

        it( 'handles long stable periods', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            for ( let i = 0; i < 1000; i += 1 ) {
                dwellTimeTracker.update( state, createMessage( { value: true } ) );
            }

            expect( state.sampleCount ).to.equal( 1001 );

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            expect( state.dwellSamples ).to.equal( 1001 );
        } );

        it( 'handles rapid transitions', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.dwellSamples ).to.equal( 1 );

            dwellTimeTracker.update( state, createMessage( { value: false } ) );
            expect( state.dwellSamples ).to.equal( 1 );

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.dwellSamples ).to.equal( 1 );
        } );

        it( 'handles alternating states', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' },
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            for ( let i = 0; i < 10; i += 1 ) {
                dwellTimeTracker.update( state, createMessage( { value: ( i % 2 === 0 ) } ) );

                if ( i > 0 ) {
                    expect( state.dwellSamples ).to.equal( 1 );
                }
            }
        } );
    } );

    describe( 'Reset', function () {
        it( 'resets all state properly', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' },
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            dwellTimeTracker.update( state, createMessage( { value: false } ) );

            expect( state.hasSeenFirstValue ).to.equal( true );
            expect( state.active ).to.equal( false );

            dwellTimeTracker.reset( state );

            expect( state.active ).to.equal( false );
            expect( state.wasActive ).to.equal( false );
            expect( state.hasSeenFirstValue ).to.equal( false );
            expect( state.stateEnteredAt ).to.equal( null );
            expect( state.dwellTime ).to.equal( null );
            expect( state.dwellSamples ).to.equal( null );
            expect( state.sampleCount ).to.equal( 0 );
        } );

        it( 're-initializes cleanly after reset', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' }
                }
            };

            const state = dwellTimeTracker.init( spec );

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            dwellTimeTracker.update( state, createMessage( { value: false } ) );

            dwellTimeTracker.reset( state );

            dwellTimeTracker.update( state, createMessage( { value: true } ) );
            expect( state.active ).to.equal( true );
            expect( state.hasSeenFirstValue ).to.equal( true );
            expect( state.sampleCount ).to.equal( 1 );
            expect( state.dwellTime ).to.equal( null ); // No edge on first message after reset
        } );
    } );

    describe( 'Recompute', function () {
        it( 'returns true (no-op)', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            const result = dwellTimeTracker.recompute( state );
            expect( result ).to.equal( true );
        } );
    } );

    describe( 'Duration tracking optimization', function () {
        it( 'sets needsDurationTracking false when only active stat requested', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            expect( state.needsDurationTracking ).to.equal( false );
        } );

        it( 'sets needsDurationTracking true when dwellTime requested', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    dwellTime: { storeAs: 'dwell' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            expect( state.needsDurationTracking ).to.equal( true );
        } );

        it( 'sets needsDurationTracking true when dwellSamples requested', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    dwellSamples: { storeAs: 'samples' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            expect( state.needsDurationTracking ).to.equal( true );
        } );

        it( 'does not track stateEnteredAt when needsDurationTracking is false', function () {
            const spec = {
                nodeType: 'Dwell Time Tracker',
                name: 'tracker',
                predicate: ( msg ) => msg.value,
                stats: {
                    active: { storeAs: 'active' }
                }
            };

            const state = dwellTimeTracker.init( spec );
            dwellTimeTracker.update( state, createMessage( { value: true } ) );

            expect( state.stateEnteredAt ).to.equal( null );
        } );
    } );

    describe( 'Spec validation', function () {
        it( 'rejects invalid nodeType', function () {
            const badSpec = {
                nodeType: 'INVALID',
                name: 'test',
                predicate: ( msg ) => msg.value,
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => dwellTimeTracker.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid name', function () {
            const badSpec = {
                nodeType: 'Dwell Time Tracker',
                name: '123-invalid',
                predicate: ( msg ) => msg.value,
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => dwellTimeTracker.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing predicate', function () {
            const badSpec = {
                nodeType: 'Dwell Time Tracker',
                name: 'test',
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => dwellTimeTracker.init( badSpec ) ).to.throw();
        } );

        it( 'rejects non-function predicate', function () {
            const badSpec = {
                nodeType: 'Dwell Time Tracker',
                name: 'test',
                predicate: 'not a function',
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => dwellTimeTracker.init( badSpec ) ).to.throw();
        } );

        it( 'rejects predicate with wrong arity', function () {
            const badSpec = {
                nodeType: 'Dwell Time Tracker',
                name: 'test',
                predicate: ( msg, extra ) => msg.value, // eslint-disable-line no-unused-vars
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => dwellTimeTracker.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid timestampField with spaces', function () {
            const badSpec = {
                nodeType: 'Dwell Time Tracker',
                name: 'test',
                predicate: ( msg ) => msg.value,
                timestampField: 'time stamp',
                stats: { active: { storeAs: 'result' } }
            };
            expect( () => dwellTimeTracker.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing stats', function () {
            const badSpec = {
                nodeType: 'Dwell Time Tracker',
                name: 'test',
                predicate: ( msg ) => msg.value
            };
            expect( () => dwellTimeTracker.init( badSpec ) ).to.throw();
        } );

        it( 'rejects empty stats object', function () {
            const badSpec = {
                nodeType: 'Dwell Time Tracker',
                name: 'test',
                predicate: ( msg ) => msg.value,
                stats: { }
            };
            expect( () => dwellTimeTracker.init( badSpec ) ).to.throw();
        } );

        it( 'rejects unsupported stat name', function () {
            const badSpec = {
                nodeType: 'Dwell Time Tracker',
                name: 'test',
                predicate: ( msg ) => msg.value,
                stats: { unsupported: { storeAs: 'result' } }
            };
            expect( () => dwellTimeTracker.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid storeAs', function () {
            const badSpec = {
                nodeType: 'Dwell Time Tracker',
                name: 'test',
                predicate: ( msg ) => msg.value,
                stats: { active: { storeAs: 'invalid-store' } }
            };
            expect( () => dwellTimeTracker.init( badSpec ) ).to.throw();
        } );

        it( 'accepts valid spec with all options', function () {
            const goodSpec = {
                nodeType: 'Dwell Time Tracker',
                name: 'validTest',
                predicate: ( msg ) => msg.value > 10,
                timestampField: 'ts',
                stats: {
                    active: { storeAs: 'active' },
                    dwellTime: { storeAs: 'dwell' },
                    dwellSamples: { storeAs: 'samples' }
                }
            };
            expect( () => dwellTimeTracker.init( goodSpec ) ).to.not.throw();
        } );
    } );

    describe( 'Introspect accessors', function () {
        it( 'returns expected node type', function () {
            expect( getNodeType() ).to.equal( 'Dwell Time Tracker' );
        } );

        it( 'getSupportedStats returns a copy and includes expected stats', function () {
            const stats = getSupportedStats();
            expect( stats ).to.be.an( 'array' );
            expect( stats ).to.have.lengthOf( 4 ); // ← Changed from 3 to 4
            expect( stats ).to.include.members( [ 'active', 'dwellTime', 'dwellSamples', 'dutyCycle' ] ); // ← Added dutyCycle

            // Verify it's a copy
            stats.push( '___mutation___' );
            const stats2 = getSupportedStats();
            expect( stats2 ).to.not.include( '___mutation___' );
        } );

        it( 'getStatDescriptions returns a copy with descriptions', function () {
            const desc1 = getStatDescriptions();
            expect( desc1 ).to.be.an( 'object' );
            expect( desc1 ).to.have.property( 'active' ).that.is.a( 'string' );
            expect( desc1 ).to.have.property( 'dwellTime' ).that.is.a( 'string' );
            expect( desc1 ).to.have.property( 'dwellSamples' ).that.is.a( 'string' );
            expect( desc1 ).to.have.property( 'dutyCycle' ).that.is.a( 'string' ); // ← ADD THIS

            // Verify it's a copy
            desc1.active = '__mutated__';
            const desc2 = getStatDescriptions();
            expect( desc2.active ).to.not.equal( '__mutated__' );
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
    } );

    describe( 'DSL buildSpec function', function () {
        // buildSpec signature: ( name, predicate, stats, options )

        it( 'builds valid spec with predicate function', function () {
            const dsl = getDSLMetadata();
            const predicate = ( msg ) => msg.value > 10;
            const builtSpec = dsl.buildSpec(
                'myTracker',
                predicate,
                { dwellTime: { storeAs: 'dwell_ms' } },
                { timestampField: 'ts' }
            );

            expect( builtSpec ).to.have.property( 'nodeType', 'Dwell Time Tracker' );
            expect( builtSpec ).to.have.property( 'name', 'myTracker' );
            expect( builtSpec.predicate ).to.equal( predicate );
            expect( builtSpec.stats.dwellTime.storeAs ).to.equal( 'dwell_ms' );
            expect( builtSpec.timestampField ).to.equal( 'ts' );
        } );

        it( 'builds spec with multiple stats', function () {
            const dsl = getDSLMetadata();
            const predicate = ( msg ) => msg.active;
            const builtSpec = dsl.buildSpec(
                'tracker',
                predicate,
                {
                    dwellTime: { storeAs: 'dur' },
                    dutyCycle: { storeAs: 'dc' }
                },
                {}
            );

            expect( builtSpec.stats ).to.have.property( 'dwellTime' );
            expect( builtSpec.stats ).to.have.property( 'dutyCycle' );
            expect( builtSpec.stats.dwellTime.storeAs ).to.equal( 'dur' );
            expect( builtSpec.stats.dutyCycle.storeAs ).to.equal( 'dc' );
        } );

        it( 'spreads options into spec', function () {
            const dsl = getDSLMetadata();
            const builtSpec = dsl.buildSpec(
                'pressureTracker',
                ( msg ) => msg.pressure > 100,
                { dwellTime: { storeAs: 'high_pressure_dur' } },
                { timestampField: 'timestamp', someOption: 'value' }
            );

            expect( builtSpec.timestampField ).to.equal( 'timestamp' );
            expect( builtSpec.someOption ).to.equal( 'value' );
        } );
    } );
} );

describe( 'Duty Cycle', function () {
    it( 'requires complete cycle before computing duty cycle', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        // First state
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 1000 } ) );
        expect( state.dutyCycle ).to.equal( null );

        // First transition (have false time only)
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 4000 } ) );
        expect( state.dutyCycle ).to.equal( null ); // Still incomplete

        // Second transition (now have both - complete cycle!)
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 10000 } ) );
        expect( +state.dutyCycle.toFixed( 3 ) ).to.equal( 0.667 );
    } );

    it( 'computes correct duty cycle for 50% duty', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        dwellTimeTracker.update( state, createMessage( { value: false, ts: 0 } ) );
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 100 } ) );
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 200 } ) );

        expect( state.dutyCycle ).to.equal( 0.5 ); // 100/200
    } );

    it( 'computes correct duty cycle for 75% duty', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        dwellTimeTracker.update( state, createMessage( { value: true, ts: 0 } ) );
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 3000 } ) );
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 4000 } ) );

        expect( state.dutyCycle ).to.equal( 0.75 ); // 3000/4000
    } );

    it( 'computes correct duty cycle for 25% duty', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        dwellTimeTracker.update( state, createMessage( { value: true, ts: 0 } ) );
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 1000 } ) );
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 4000 } ) );

        expect( state.dutyCycle ).to.equal( 0.25 ); // 1000/4000
    } );

    it( 'handles multiple consecutive cycles', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        // Cycle 1: true(3s) + false(2s) = 60% duty
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 0 } ) );
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 3000 } ) );
        expect( state.dutyCycle ).to.equal( null ); // Incomplete

        dwellTimeTracker.update( state, createMessage( { value: true, ts: 5000 } ) );
        expect( state.dutyCycle ).to.equal( 0.6 ); // 3000/5000

        // Stable period
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 6000 } ) );
        expect( state.dutyCycle ).to.equal( null ); // Cleared after publishing

        // Cycle 2: true(2s) + false(1s) = 66.67% duty
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 7000 } ) );
        expect( state.dutyCycle ).to.equal( null ); // Incomplete

        dwellTimeTracker.update( state, createMessage( { value: true, ts: 8000 } ) );
        expect( state.dutyCycle ).to.be.closeTo( 0.6667, 0.0001 ); // 2000/3000

        // Cycle 3: true(4s) + false(1s) = 80% duty
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 12000 } ) );
        expect( state.dutyCycle ).to.equal( null );

        dwellTimeTracker.update( state, createMessage( { value: true, ts: 13000 } ) );
        expect( state.dutyCycle ).to.equal( 0.8 ); // 4000/5000
    } );

    it( 'keeps dutyCycle null for incomplete cycles', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        // Start in false
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 0 } ) );
        expect( state.dutyCycle ).to.equal( null );

        // Stay in false
        for ( let i = 1; i < 10; i += 1 ) {
            dwellTimeTracker.update( state, createMessage( { value: false, ts: i * 1000 } ) );
            expect( state.dutyCycle ).to.equal( null );
        }

        // Transition to true
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 10000 } ) );
        expect( state.dutyCycle ).to.equal( null ); // Still incomplete

        // Stay in true
        for ( let i = 11; i < 20; i += 1 ) {
            dwellTimeTracker.update( state, createMessage( { value: true, ts: i * 1000 } ) );
            expect( state.dutyCycle ).to.equal( null );
        }
    } );

    it( 'handles rapid alternating states', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        // Rapid transitions with 1ms periods
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 0 } ) );
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 1 } ) );
        expect( state.dutyCycle ).to.equal( null );

        dwellTimeTracker.update( state, createMessage( { value: true, ts: 2 } ) );
        expect( state.dutyCycle ).to.equal( 0.5 ); // 1ms on, 1ms off

        dwellTimeTracker.update( state, createMessage( { value: false, ts: 3 } ) );
        expect( state.dutyCycle ).to.equal( null );

        dwellTimeTracker.update( state, createMessage( { value: true, ts: 4 } ) );
        expect( state.dutyCycle ).to.equal( 0.5 ); // 1ms on, 1ms off
    } );

    it( 'publishes null dutyCycle when incomplete', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        dwellTimeTracker.update( state, createMessage( { value: false, ts: 0 } ) );
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 1000 } ) );

        const msg = Object.create( null );
        dwellTimeTracker.publishTo( state, msg );

        expect( msg.dc ).to.equal( null );
    } );

    it( 'publishes numeric dutyCycle on cycle completion', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        dwellTimeTracker.update( state, createMessage( { value: true, ts: 0 } ) );
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 3000 } ) );
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 5000 } ) );

        const msg = Object.create( null );
        dwellTimeTracker.publishTo( state, msg );

        expect( msg.dc ).to.equal( 0.6 );
    } );

    it( 'clears dutyCycle after publishing cycle', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        // Complete first cycle
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 0 } ) );
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 3000 } ) );
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 5000 } ) );

        const msg1 = Object.create( null );
        dwellTimeTracker.publishTo( state, msg1 );
        expect( msg1.dc ).to.equal( 0.6 );

        // Next message should have null
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 6000 } ) );

        const msg2 = Object.create( null );
        dwellTimeTracker.publishTo( state, msg2 );
        expect( msg2.dc ).to.equal( null );
    } );

    it( 'resets duty cycle tracker on reset', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        // Build up partial cycle
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 0 } ) );
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 3000 } ) );

        expect( state.dutyCycleTracker.true ).to.equal( 3000 );
        expect( state.dutyCycleTracker.false ).to.equal( null );

        dwellTimeTracker.reset( state );

        expect( state.dutyCycleTracker.true ).to.equal( null );
        expect( state.dutyCycleTracker.false ).to.equal( null );
        expect( state.dutyCycle ).to.equal( null );
    } );

    it( 'sets needsDurationTracking true when dutyCycle requested', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );
        expect( state.needsDurationTracking ).to.equal( true );
    } );

    it( 'handles dutyCycle with other stats', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                active: { storeAs: 'active' },
                dwellTime: { storeAs: 'dwell' },
                dwellSamples: { storeAs: 'samples' },
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        dwellTimeTracker.update( state, createMessage( { value: true, ts: 0 } ) );
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 1000 } ) );
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 3000 } ) );
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 5000 } ) );

        const msg = Object.create( null );
        dwellTimeTracker.publishTo( state, msg );

        expect( msg.active ).to.equal( true );
        expect( msg.dwell ).to.equal( 2000 ); // Previous state (false) duration
        expect( msg.samples ).to.equal( 1 ); // Previous state sample count
        expect( msg.dc ).to.equal( 0.6 ); // 3000/5000
    } );

    it( 'handles starting with false state', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        // Start false, transition to true, then false again
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 0 } ) );
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 2000 } ) );
        expect( state.dutyCycle ).to.equal( null );

        dwellTimeTracker.update( state, createMessage( { value: false, ts: 5000 } ) );
        expect( state.dutyCycle ).to.equal( 0.6 ); // 3000/5000
    } );

    it( 'handles extreme duty cycles (near 0%)', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        // Very short true period
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 0 } ) );
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 10 } ) );
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 10000 } ) );

        expect( state.dutyCycle ).to.be.closeTo( 0.001, 0.0001 ); // 10/10000
    } );

    it( 'handles extreme duty cycles (near 100%)', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        // Very short false period
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 0 } ) );
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 9990 } ) );
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 10000 } ) );

        expect( state.dutyCycle ).to.be.closeTo( 0.999, 0.0001 ); // 9990/10000
    } );

    it( 'publishes NaN for dutyCycle when inputValidationFailed', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );
        dwellTimeTracker.update( state, createMessage( { value: 'invalid' } ) );

        const msg = Object.create( null );
        dwellTimeTracker.publishTo( state, msg );

        expect( Number.isNaN( msg.dc ) ).to.equal( true );
    } );

    it( 'returns NaN dutyCycle when both half-cycles have zero duration', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'tracker',
            predicate: ( msg ) => msg.value,
            timestampField: 'ts',
            stats: {
                dutyCycle: { storeAs: 'dc' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        // All three transitions at the same timestamp — both dwell times are 0
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 5000 } ) );
        dwellTimeTracker.update( state, createMessage( { value: false, ts: 5000 } ) );
        dwellTimeTracker.update( state, createMessage( { value: true, ts: 5000 } ) );

        // Duty cycle should be NaN (0/0 is invalid), not a number
        expect( Number.isNaN( state.dutyCycle ) ).to.equal( true );

        // Verify it publishes as NaN too
        const msg = Object.create( null );
        dwellTimeTracker.publishTo( state, msg );
        expect( Number.isNaN( msg.dc ) ).to.equal( true );
    } );
} );

describe( 'reset()', function () {
    it( 'clears error suppression flag', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'test',
            predicate: ( _msg ) => true,
            stats: { active: { storeAs: 'isActive' } }
        };

        const state = dwellTimeTracker.init( spec );
        state.predicateErrorLogged = true;
        dwellTimeTracker.reset( state );
        expect( state.predicateErrorLogged ).to.equal( false );
    } );
} );

describe( 'Pause/Unpause control', function () {
    it( 'skips update when paused', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'pauseTest',
            predicate: ( msg ) => msg.active,
            stats: {
                active: { storeAs: 'isActive' },
                dwellSamples: { storeAs: 'samples' }
            }
        };

        const state = dwellTimeTracker.init( spec );
        dwellTimeTracker.update( state, createMessage( { active: true } ) );
        const sampleCountBefore = state.sampleCount;

        state.pause = true;
        dwellTimeTracker.update( state, createMessage( { active: false } ) );

        expect( state.sampleCount ).to.equal( sampleCountBefore );
    } );

    it( 'publishes when paused', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'pausePub',
            predicate: ( msg ) => msg.active,
            stats: {
                active: { storeAs: 'isActive' }
            }
        };

        const state = dwellTimeTracker.init( spec );
        dwellTimeTracker.update( state, createMessage( { active: true } ) );

        state.pause = true;
        const msg = Object.create( null );
        dwellTimeTracker.publishTo( state, msg );

        expect( msg.isActive ).to.not.equal( undefined );
    } );

    it( 'pause/unpause control methods exist', function () {
        const methods = getSupportedControlMethods();
        expect( methods ).to.have.property( 'pause' );
        expect( methods ).to.have.property( 'unpause' );
    } );
} );

describe( 'Disable functionality', function () {
    it( 'skips update when disabled', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'disableTest',
            predicate: ( msg ) => msg.active,
            stats: {
                active: { storeAs: 'isActive' },
                dwellSamples: { storeAs: 'samples' }
            }
        };

        const state = dwellTimeTracker.init( spec );
        dwellTimeTracker.update( state, createMessage( { active: true } ) );
        expect( state.active ).to.equal( true );

        // Disable and attempt to change state
        state.disable = true;
        dwellTimeTracker.update( state, createMessage( { active: false } ) );
        expect( state.active ).to.equal( true );

        // Re-enable and verify processing resumes
        state.disable = false;
        dwellTimeTracker.update( state, createMessage( { active: false } ) );
        expect( state.active ).to.equal( false );
    } );

    it( 'does not publish when disabled', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'disablePub',
            predicate: ( msg ) => msg.active,
            stats: {
                active: { storeAs: 'isActive' }
            }
        };

        const state = dwellTimeTracker.init( spec );
        dwellTimeTracker.update( state, createMessage( { active: true } ) );

        // Disabled: publishTo should not write to msg
        state.disable = true;
        const msg1 = Object.create( null );
        dwellTimeTracker.publishTo( state, msg1 );
        expect( msg1.isActive ).to.equal( undefined );

        // Re-enabled: publishTo should write to msg
        state.disable = false;
        const msg2 = Object.create( null );
        dwellTimeTracker.publishTo( state, msg2 );
        expect( msg2.isActive ).to.equal( true );
    } );

    it( 'handles enable/disable toggle during operation', function () {
        const spec = {
            nodeType: 'Dwell Time Tracker',
            name: 'toggleTest',
            predicate: ( msg ) => msg.active,
            stats: {
                active: { storeAs: 'isActive' }
            }
        };

        const state = dwellTimeTracker.init( spec );

        // Process normally
        dwellTimeTracker.update( state, createMessage( { active: true } ) );
        dwellTimeTracker.update( state, createMessage( { active: false } ) );
        expect( state.active ).to.equal( false );

        // Disable: multiple updates ignored
        state.disable = true;
        dwellTimeTracker.update( state, createMessage( { active: true } ) );
        dwellTimeTracker.update( state, createMessage( { active: false } ) );
        dwellTimeTracker.update( state, createMessage( { active: true } ) );
        expect( state.active ).to.equal( false );

        // Re-enable: processing resumes
        state.disable = false;
        dwellTimeTracker.update( state, createMessage( { active: true } ) );
        expect( state.active ).to.equal( true );
    } );
} );

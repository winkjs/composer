/* eslint-disable no-unused-expressions */
/**
 * Comprehensive test suite for median3 node.
 * Tests 3-point median filter for noise reduction.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import * as median3 from '../index.js';
import {
    getDSLMetadata,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities,
    DEFAULT_OPTIONS
} from '../introspect.js';

// Helper function to create test messages
const createMessage = function ( values ) {
    const msg = Object.create( null );
    Object.keys( values ).forEach( ( key ) => {
        msg[ key ] = values[ key ];
    } );
    return msg;
};

describe( 'Median3 Node', function () {
    describe( 'Basic functionality', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Median3',
                name: 'filter',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'filtered' } }
            };
            state = median3.init( spec );
        } );

        it( 'returns first value as median with single sample', function () {
            median3.update( state, createMessage( { value: 10 } ) );
            expect( state.median3 ).to.equal( 10 );
        } );

        it( 'computes average with 2 samples', function () {
            median3.update( state, createMessage( { value: 10 } ) );
            median3.update( state, createMessage( { value: 20 } ) );
            expect( state.median3 ).to.equal( 15 ); // (10 + 20) / 2
        } );

        it( 'computes median with 3 samples', function () {
            median3.update( state, createMessage( { value: 10 } ) );
            median3.update( state, createMessage( { value: 30 } ) );
            median3.update( state, createMessage( { value: 20 } ) );
            expect( state.median3 ).to.equal( 20 ); // median of [10, 30, 20]
        } );

        it( 'computes median correctly for ascending sequence', function () {
            median3.update( state, createMessage( { value: 1 } ) );
            median3.update( state, createMessage( { value: 2 } ) );
            median3.update( state, createMessage( { value: 3 } ) );
            expect( state.median3 ).to.equal( 2 );
        } );

        it( 'computes median correctly for descending sequence', function () {
            median3.update( state, createMessage( { value: 30 } ) );
            median3.update( state, createMessage( { value: 20 } ) );
            median3.update( state, createMessage( { value: 10 } ) );
            expect( state.median3 ).to.equal( 20 );
        } );

        it( 'handles all same values', function () {
            median3.update( state, createMessage( { value: 5 } ) );
            median3.update( state, createMessage( { value: 5 } ) );
            median3.update( state, createMessage( { value: 5 } ) );
            expect( state.median3 ).to.equal( 5 );
        } );
    } );

    describe( 'Spike removal', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Median3',
                name: 'despike',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'clean' } }
            };
            state = median3.init( spec );
        } );

        it( 'removes positive spike', function () {
            median3.update( state, createMessage( { value: 10 } ) );
            median3.update( state, createMessage( { value: 100 } ) ); // spike
            median3.update( state, createMessage( { value: 12 } ) );
            expect( state.median3 ).to.equal( 12 ); // spike removed
        } );

        it( 'removes negative spike', function () {
            median3.update( state, createMessage( { value: 50 } ) );
            median3.update( state, createMessage( { value: -100 } ) ); // spike
            median3.update( state, createMessage( { value: 52 } ) );
            expect( state.median3 ).to.equal( 50 ); // spike removed
        } );

        it( 'removes spike regardless of position in buffer', function () {
            // First pattern: spike at position 0
            median3.update( state, createMessage( { value: 1000 } ) ); // spike
            median3.update( state, createMessage( { value: 10 } ) );
            median3.update( state, createMessage( { value: 12 } ) );
            expect( state.median3 ).to.equal( 12 );

            // Continue - now spike will rotate through
            median3.update( state, createMessage( { value: 14 } ) );
            expect( state.median3 ).to.equal( 12 ); // median of [10, 12, 14]
        } );

        it( 'handles consecutive spikes', function () {
            // Buffer state after each value:
            // [10]: single value -> 10
            // [10, 100]: two values -> (10+100)/2 = 55
            // [10, 100, 12]: median of [10, 100, 12] = 12
            // [100, 12, 200]: median of [100, 12, 200] = 100
            // [12, 200, 14]: median of [12, 200, 14] = 14
            const values = [ 10, 100, 12, 200, 14 ];
            const expected = [ 10, 55, 12, 100, 14 ];

            values.forEach( ( v, i ) => {
                median3.update( state, createMessage( { value: v } ) );
                expect( state.median3 ).to.be.closeTo( expected[ i ], 0.5 );
            } );
        } );
    } );

    describe( 'Rolling window behavior', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Median3',
                name: 'rolling',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'med' } }
            };
            state = median3.init( spec );
        } );

        it( 'slides window correctly', function () {
            // Fill initial window
            median3.update( state, createMessage( { value: 10 } ) );
            median3.update( state, createMessage( { value: 20 } ) );
            median3.update( state, createMessage( { value: 30 } ) );
            expect( state.median3 ).to.equal( 20 );

            // Slide window
            median3.update( state, createMessage( { value: 40 } ) );
            expect( state.median3 ).to.equal( 30 ); // median of [20, 30, 40]

            median3.update( state, createMessage( { value: 50 } ) );
            expect( state.median3 ).to.equal( 40 ); // median of [30, 40, 50]
        } );

        it( 'handles long sequence', function () {
            const values = [];
            for ( let i = 0; i < 100; i += 1 ) {
                values.push( i );
            }

            values.forEach( ( v, i ) => {
                median3.update( state, createMessage( { value: v } ) );
                if ( i >= 2 ) {
                    expect( state.median3 ).to.equal( i - 1 ); // middle value
                }
            } );
        } );
    } );

    describe( 'Invalid input handling', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Median3',
                name: 'validator',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            state = median3.init( spec );
        } );

        it( 'sets inputValidationFailed on NaN', function () {
            median3.update( state, createMessage( { value: NaN } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on Infinity', function () {
            median3.update( state, createMessage( { value: Infinity } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on -Infinity', function () {
            median3.update( state, createMessage( { value: -Infinity } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on undefined', function () {
            median3.update( state, createMessage( { value: undefined } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on null', function () {
            median3.update( state, createMessage( { value: null } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on string', function () {
            median3.update( state, createMessage( { value: 'invalid' } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'recovers from invalid input', function () {
            median3.update( state, createMessage( { value: NaN } ) );
            expect( state.inputValidationFailed ).to.equal( true );

            median3.update( state, createMessage( { value: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( false );
        } );
    } );

    describe( 'Publishing', function () {
        it( 'publishes median3 to configured storeAs field', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'pub',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'myMedian' } }
            };
            const state = median3.init( spec );

            median3.update( state, createMessage( { value: 10 } ) );
            median3.update( state, createMessage( { value: 30 } ) );
            median3.update( state, createMessage( { value: 20 } ) );

            const output = Object.create( null );
            median3.publishTo( state, output );
            expect( output.myMedian ).to.equal( 20 );
        } );

        it( 'publishes NaN when inputValidationFailed', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'nanPub',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            const state = median3.init( spec );

            median3.update( state, createMessage( { value: NaN } ) );

            const output = Object.create( null );
            median3.publishTo( state, output );
            expect( Number.isNaN( output.out ) ).to.equal( true );
        } );

        it( 'publishes init value when called before any update', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'earlyPub',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            const state = median3.init( spec );

            const output = Object.create( null );
            median3.publishTo( state, output );
            expect( output.out ).to.equal( 0 );
        } );

        it( 'NaN propagation chain: update with NaN then publishTo outputs NaN', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'nanChain',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            const state = median3.init( spec );

            // Feed valid values first
            median3.update( state, createMessage( { value: 10 } ) );
            median3.update( state, createMessage( { value: 20 } ) );

            // Now feed NaN
            median3.update( state, createMessage( { value: NaN } ) );
            expect( state.inputValidationFailed ).to.equal( true );

            // Publish — output must be NaN, not the stale median
            const output = Object.create( null );
            median3.publishTo( state, output );
            expect( output.out ).to.satisfy( Number.isNaN );
        } );

        it( 'does not publish when disabled', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'disabledPub',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            const state = median3.init( spec );

            median3.update( state, createMessage( { value: 10 } ) );
            state.disable = true;

            const output = Object.create( null );
            median3.publishTo( state, output );
            expect( output.out ).to.be.undefined;
        } );
    } );

    describe( 'Disable functionality', function () {
        it( 'skips update when disabled', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'disableTest',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            const state = median3.init( spec );

            median3.update( state, createMessage( { value: 10 } ) );
            median3.update( state, createMessage( { value: 20 } ) );
            median3.update( state, createMessage( { value: 30 } ) );
            expect( state.median3 ).to.equal( 20 );

            state.disable = true;

            median3.update( state, createMessage( { value: 100 } ) );
            expect( state.median3 ).to.equal( 20 ); // Unchanged

            state.disable = false;
            median3.update( state, createMessage( { value: 40 } ) );
            // Buffer still has old values since update was skipped
        } );

        it( 'disable() and enable() toggle the disable flag', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'ctrlDisable',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            const state = median3.init( spec );
            expect( state.disable ).to.equal( false );

            median3.disable( state );
            expect( state.disable ).to.equal( true );

            median3.enable( state );
            expect( state.disable ).to.equal( false );
        } );
    } );

    describe( 'Reset and Recompute', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Median3',
                name: 'resetTest',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            state = median3.init( spec );
        } );

        it( 'reset returns true', function () {
            expect( median3.reset( state ) ).to.equal( true );
        } );

        it( 'reset clears ring buffer and median value', function () {
            median3.update( state, createMessage( { value: 10 } ) );
            median3.update( state, createMessage( { value: 20 } ) );
            median3.update( state, createMessage( { value: 30 } ) );
            expect( state.median3 ).to.equal( 20 );
            expect( state.ring.used ).to.equal( 3 );

            median3.reset( state );

            expect( state.median3 ).to.equal( 0 );
            expect( state.ring.used ).to.equal( 0 );
            expect( state.ring.head ).to.equal( 0 );
        } );

        it( 'reset enables cold-start recovery', function () {
            // Warm up
            median3.update( state, createMessage( { value: 10 } ) );
            median3.update( state, createMessage( { value: 20 } ) );
            median3.update( state, createMessage( { value: 30 } ) );

            // Reset
            median3.reset( state );

            // Feed single value — should behave as cold start
            median3.update( state, createMessage( { value: 99 } ) );
            expect( state.median3 ).to.equal( 99 );
            expect( state.ring.used ).to.equal( 1 );

            // Feed second value — should average
            median3.update( state, createMessage( { value: 101 } ) );
            expect( state.median3 ).to.equal( 100 );
        } );

        it( 'reset is idempotent', function () {
            median3.update( state, createMessage( { value: 10 } ) );
            median3.reset( state );
            median3.reset( state );
            expect( state.median3 ).to.equal( 0 );
            expect( state.ring.used ).to.equal( 0 );
        } );

        it( 'recompute returns true', function () {
            expect( median3.recompute( state ) ).to.equal( true );
        } );

        it( 'recompute does not corrupt state', function () {
            median3.update( state, createMessage( { value: 10 } ) );
            median3.update( state, createMessage( { value: 30 } ) );
            median3.update( state, createMessage( { value: 20 } ) );
            const medianBefore = state.median3;
            const usedBefore = state.ring.used;

            median3.recompute( state );

            expect( state.median3 ).to.equal( medianBefore );
            expect( state.ring.used ).to.equal( usedBefore );
        } );
    } );

    describe( 'Edge cases', function () {
        it( 'handles negative values', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'negative',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            const state = median3.init( spec );

            median3.update( state, createMessage( { value: -30 } ) );
            median3.update( state, createMessage( { value: -10 } ) );
            median3.update( state, createMessage( { value: -20 } ) );
            expect( state.median3 ).to.equal( -20 );
        } );

        it( 'handles mixed positive and negative', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'mixed',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            const state = median3.init( spec );

            median3.update( state, createMessage( { value: -10 } ) );
            median3.update( state, createMessage( { value: 0 } ) );
            median3.update( state, createMessage( { value: 10 } ) );
            expect( state.median3 ).to.equal( 0 );
        } );

        it( 'handles very small values', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'tiny',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            const state = median3.init( spec );

            median3.update( state, createMessage( { value: 1e-10 } ) );
            median3.update( state, createMessage( { value: 2e-10 } ) );
            median3.update( state, createMessage( { value: 3e-10 } ) );
            expect( state.median3 ).to.equal( 2e-10 );
        } );

        it( 'handles very large values', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'large',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            const state = median3.init( spec );

            median3.update( state, createMessage( { value: 1e15 } ) );
            median3.update( state, createMessage( { value: 2e15 } ) );
            median3.update( state, createMessage( { value: 3e15 } ) );
            expect( state.median3 ).to.equal( 2e15 );
        } );

        it( 'handles zero', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'zero',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            const state = median3.init( spec );

            median3.update( state, createMessage( { value: -5 } ) );
            median3.update( state, createMessage( { value: 0 } ) );
            median3.update( state, createMessage( { value: 5 } ) );
            expect( state.median3 ).to.equal( 0 );
        } );

        it( 'handles two equal values', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'twoEqual',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            const state = median3.init( spec );

            median3.update( state, createMessage( { value: 10 } ) );
            median3.update( state, createMessage( { value: 10 } ) );
            median3.update( state, createMessage( { value: 20 } ) );
            expect( state.median3 ).to.equal( 10 );
        } );
    } );

    describe( 'Spec validation', function () {
        it( 'rejects invalid nodeType', function () {
            const badSpec = {
                nodeType: 'INVALID',
                name: 'test',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            expect( () => median3.init( badSpec ) ).to.throw( /nodeType/ );
        } );

        it( 'rejects invalid name', function () {
            const badSpec = {
                nodeType: 'Median3',
                name: '123-invalid',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            expect( () => median3.init( badSpec ) ).to.throw( /identifier/ );
        } );

        it( 'rejects missing from.x', function () {
            const badSpec = {
                nodeType: 'Median3',
                name: 'test',
                from: {},
                stats: { median3: { storeAs: 'out' } }
            };
            expect( () => median3.init( badSpec ) ).to.throw( /Required field missing/ );
        } );

        it( 'rejects from.x with spaces', function () {
            const badSpec = {
                nodeType: 'Median3',
                name: 'test',
                from: { x: 'bad field' },
                stats: { median3: { storeAs: 'out' } }
            };
            expect( () => median3.init( badSpec ) ).to.throw( /spaces/ );
        } );

        it( 'rejects missing stats', function () {
            const badSpec = {
                nodeType: 'Median3',
                name: 'test',
                from: { x: 'value' }
            };
            expect( () => median3.init( badSpec ) ).to.throw( /Required field missing/ );
        } );

        it( 'rejects unsupported stat', function () {
            const badSpec = {
                nodeType: 'Median3',
                name: 'test',
                from: { x: 'value' },
                stats: { mean: { storeAs: 'out' } }
            };
            expect( () => median3.init( badSpec ) ).to.throw( /Invalid property name/ );
        } );

        it( 'rejects invalid storeAs', function () {
            const badSpec = {
                nodeType: 'Median3',
                name: 'test',
                from: { x: 'value' },
                stats: { median3: { storeAs: '123-invalid' } }
            };
            expect( () => median3.init( badSpec ) ).to.throw( /identifier/ );
        } );

        it( 'accepts valid spec and returns correct state shape', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'valid',
                from: { x: 'sensor' },
                stats: { median3: { storeAs: 'filtered' } }
            };
            const state = median3.init( spec );
            expect( state.x ).to.equal( 'sensor' );
            expect( state.median3 ).to.equal( 0 );
            expect( state.disable ).to.equal( false );
            expect( state.pause ).to.equal( false );
            expect( state.inputValidationFailed ).to.equal( false );
            expect( state.ring ).to.be.an( 'object' );
            expect( state.ring.used ).to.equal( 0 );
            expect( state.nodeType ).to.equal( 'Median3' );
        } );
    } );

    describe( 'Introspect accessors', function () {
        it( 'returns expected node type', function () {
            expect( getNodeType() ).to.equal( 'Median3' );
        } );

        it( 'getSupportedStats returns a copy', function () {
            const stats = getSupportedStats();
            expect( stats ).to.be.an( 'array' );
            expect( stats ).to.include( 'median3' );

            stats.push( 'mutation' );
            const stats2 = getSupportedStats();
            expect( stats2 ).to.not.include( 'mutation' );
        } );

        it( 'getStatDescriptions returns descriptions', function () {
            const desc = getStatDescriptions();
            expect( desc.median3 ).to.equal( 'Fast median filter over last 3 values' );
        } );

        it( 'getSupportedControlMethods returns all control methods', function () {
            const methods = getSupportedControlMethods();
            expect( Object.keys( methods ).sort() ).to.deep.equal(
                [ 'disable', 'enable', 'pause', 'reset', 'unpause' ]
            );
        } );

        it( 'getCapabilities returns capabilities', function () {
            const cap = getCapabilities();
            expect( cap.description ).to.equal( 'Computes the median of the last 3 values for noise reduction' );
            expect( cap.features ).to.be.an( 'array' ).with.length.greaterThan( 0 );
        } );

        it( 'getCapabilities returns a defensive copy', function () {
            const cap1 = getCapabilities();
            cap1.features.push( 'mutation' );
            const cap2 = getCapabilities();
            expect( cap2.features ).to.not.include( 'mutation' );
        } );

        it( 'getDSLMetadata returns metadata with schema and builder', function () {
            const dsl = getDSLMetadata();
            expect( dsl ).to.have.property( 'specSchema' ).that.is.an( 'object' );
            expect( dsl ).to.have.property( 'buildSpec' ).that.is.a( 'function' );
            expect( dsl ).to.have.property( 'crossFieldValidators' ).that.is.an( 'array' );
        } );

        it( 'DEFAULT_OPTIONS is an empty object', function () {
            expect( DEFAULT_OPTIONS ).to.deep.equal( {} );
        } );
    } );

    describe( 'DSL buildSpec', function () {
        it( 'builds basic spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'filter',
                'temperature',
                { median3: { storeAs: 'filtered' } },
                {}
            );

            expect( spec.nodeType ).to.equal( 'Median3' );
            expect( spec.name ).to.equal( 'filter' );
            expect( spec.from ).to.deep.equal( { x: 'temperature' } );
            expect( spec.stats.median3.storeAs ).to.equal( 'filtered' );
        } );
    } );

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'pauseSkip',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            const state = median3.init( spec );

            median3.update( state, createMessage( { value: 10 } ) );
            median3.update( state, createMessage( { value: 30 } ) );
            median3.update( state, createMessage( { value: 20 } ) );
            const medianBefore = state.median3;

            state.pause = true;

            median3.update( state, createMessage( { value: 100 } ) );
            expect( state.median3 ).to.equal( medianBefore );
        } );

        it( 'publishes when paused', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'pausePub',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            const state = median3.init( spec );

            median3.update( state, createMessage( { value: 10 } ) );
            median3.update( state, createMessage( { value: 30 } ) );
            median3.update( state, createMessage( { value: 20 } ) );

            state.pause = true;

            const output = Object.create( null );
            median3.publishTo( state, output );
            expect( 'out' in output ).to.equal( true );
            expect( output.out ).to.equal( 20 );
        } );

        it( 'pause() and unpause() toggle the pause flag', function () {
            const spec = {
                nodeType: 'Median3',
                name: 'ctrlPause',
                from: { x: 'value' },
                stats: { median3: { storeAs: 'out' } }
            };
            const state = median3.init( spec );
            expect( state.pause ).to.equal( false );

            median3.pause( state );
            expect( state.pause ).to.equal( true );

            median3.unpause( state );
            expect( state.pause ).to.equal( false );
        } );
    } );
} );

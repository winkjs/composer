/* eslint-disable no-unused-expressions */
/**
 * Comprehensive test suite for diff node.
 * Tests two-field difference computation (x - y).
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import * as diff from '../index.js';
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

describe( 'Diff Node', function () {
    describe( 'Basic functionality', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Diff',
                name: 'spread',
                from: { x: 'high', y: 'low' },
                stats: { diff: { storeAs: 'spread' } }
            };
            state = diff.init( spec );
        } );

        it( 'computes positive difference', function () {
            diff.update( state, createMessage( { high: 100, low: 80 } ) );
            expect( state.diff ).to.equal( 20 );
        } );

        it( 'computes negative difference', function () {
            diff.update( state, createMessage( { high: 50, low: 75 } ) );
            expect( state.diff ).to.equal( -25 );
        } );

        it( 'computes zero difference', function () {
            diff.update( state, createMessage( { high: 42, low: 42 } ) );
            expect( state.diff ).to.equal( 0 );
        } );

        it( 'handles sequence of values', function () {
            const testCases = [
                { high: 100, low: 90, expected: 10 },
                { high: 50, low: 60, expected: -10 },
                { high: 75, low: 75, expected: 0 },
                { high: 200, low: 100, expected: 100 }
            ];

            testCases.forEach( ( tc ) => {
                diff.update( state, createMessage( { high: tc.high, low: tc.low } ) );
                expect( state.diff ).to.equal( tc.expected );
            } );
        } );
    } );

    describe( 'Absolute mode', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Diff',
                name: 'absSpread',
                from: { x: 'a', y: 'b' },
                absolute: true,
                stats: { diff: { storeAs: 'gap' } }
            };
            state = diff.init( spec );
        } );

        it( 'returns positive for x > y', function () {
            diff.update( state, createMessage( { a: 100, b: 80 } ) );
            expect( state.diff ).to.equal( 20 );
        } );

        it( 'returns positive for x < y', function () {
            diff.update( state, createMessage( { a: 50, b: 75 } ) );
            expect( state.diff ).to.equal( 25 ); // |50 - 75| = 25
        } );

        it( 'returns zero for equal values', function () {
            diff.update( state, createMessage( { a: 42, b: 42 } ) );
            expect( state.diff ).to.equal( 0 );
        } );

        it( 'handles mixed positive and negative', function () {
            diff.update( state, createMessage( { a: -10, b: 10 } ) );
            expect( state.diff ).to.equal( 20 ); // |-10 - 10| = 20
        } );
    } );

    describe( 'Invalid input handling', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Diff',
                name: 'validator',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            state = diff.init( spec );
        } );

        it( 'sets inputValidationFailed on NaN in x', function () {
            diff.update( state, createMessage( { a: NaN, b: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on NaN in y', function () {
            diff.update( state, createMessage( { a: 10, b: NaN } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on Infinity in x', function () {
            diff.update( state, createMessage( { a: Infinity, b: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on Infinity in y', function () {
            diff.update( state, createMessage( { a: 10, b: -Infinity } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on undefined in x', function () {
            diff.update( state, createMessage( { a: undefined, b: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on null in y', function () {
            diff.update( state, createMessage( { a: 10, b: null } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on string in x', function () {
            diff.update( state, createMessage( { a: 'bad', b: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on missing x field', function () {
            diff.update( state, createMessage( { b: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on missing y field', function () {
            diff.update( state, createMessage( { a: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'recovers from invalid input', function () {
            diff.update( state, createMessage( { a: NaN, b: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( true );

            diff.update( state, createMessage( { a: 20, b: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( false );
            expect( state.diff ).to.equal( 10 );
        } );
    } );

    describe( 'Publishing', function () {
        it( 'publishes diff to configured storeAs field', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'pub',
                from: { x: 'high', y: 'low' },
                stats: { diff: { storeAs: 'mySpread' } }
            };
            const state = diff.init( spec );

            diff.update( state, createMessage( { high: 100, low: 60 } ) );

            const output = Object.create( null );
            diff.publishTo( state, output );
            expect( output.mySpread ).to.equal( 40 );
        } );

        it( 'publishes NaN when inputValidationFailed', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'nanPub',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            const state = diff.init( spec );

            diff.update( state, createMessage( { a: NaN, b: 10 } ) );

            const output = Object.create( null );
            diff.publishTo( state, output );
            expect( Number.isNaN( output.out ) ).to.equal( true );
        } );

        it( 'publishes zero before first update', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'coldStart',
                from: { x: 'high', y: 'low' },
                stats: { diff: { storeAs: 'mySpread' } }
            };
            const state = diff.init( spec );
            const output = Object.create( null );
            diff.publishTo( state, output );
            expect( output.mySpread ).to.equal( 0 );
        } );

        it( 'does not publish when disabled', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'disabledPub',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            const state = diff.init( spec );

            diff.update( state, createMessage( { a: 50, b: 30 } ) );
            diff.disable( state );

            const output = Object.create( null );
            diff.publishTo( state, output );
            expect( output.out ).to.be.undefined;
        } );
    } );

    describe( 'Disable functionality', function () {
        it( 'skips update when disabled', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'disableTest',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            const state = diff.init( spec );

            diff.update( state, createMessage( { a: 100, b: 60 } ) );
            expect( state.diff ).to.equal( 40 );

            diff.disable( state );

            diff.update( state, createMessage( { a: 200, b: 50 } ) );
            expect( state.diff ).to.equal( 40 ); // Unchanged

            diff.enable( state );
            diff.update( state, createMessage( { a: 30, b: 10 } ) );
            expect( state.diff ).to.equal( 20 );
        } );

        it( 'disable() and enable() toggle the disable flag', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'toggleTest',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            const state = diff.init( spec );
            expect( state.disable ).to.equal( false );

            diff.disable( state );
            expect( state.disable ).to.equal( true );

            diff.enable( state );
            expect( state.disable ).to.equal( false );
        } );
    } );

    describe( 'Reset and Recompute', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Diff',
                name: 'resetTest',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            state = diff.init( spec );
        } );

        it( 'reset returns true and clears diff', function () {
            diff.update( state, createMessage( { a: 100, b: 60 } ) );
            expect( state.diff ).to.equal( 40 );

            expect( diff.reset( state ) ).to.equal( true );
            expect( state.diff ).to.equal( 0 );
        } );

        it( 'produces correct results after reset', function () {
            diff.update( state, createMessage( { a: 100, b: 60 } ) );
            expect( state.diff ).to.equal( 40 );

            diff.reset( state );
            expect( state.diff ).to.equal( 0 );

            diff.update( state, createMessage( { a: 30, b: 10 } ) );
            expect( state.diff ).to.equal( 20 );
        } );

        it( 'recompute returns true', function () {
            expect( diff.recompute( state ) ).to.equal( true );
        } );
    } );

    describe( 'Edge cases', function () {
        it( 'handles very small differences', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'tiny',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            const state = diff.init( spec );

            diff.update( state, createMessage( { a: 1.0000001, b: 1.0000000 } ) );
            expect( state.diff ).to.be.closeTo( 1e-7, 1e-12 );
        } );

        it( 'handles very large values', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'large',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            const state = diff.init( spec );

            diff.update( state, createMessage( { a: 2e15, b: 1e15 } ) );
            expect( state.diff ).to.equal( 1e15 );
        } );

        it( 'handles negative values', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'negative',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            const state = diff.init( spec );

            diff.update( state, createMessage( { a: -10, b: -30 } ) );
            expect( state.diff ).to.equal( 20 ); // -10 - (-30) = 20
        } );

        it( 'handles zero values', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'zero',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            const state = diff.init( spec );

            diff.update( state, createMessage( { a: 0, b: 0 } ) );
            expect( state.diff ).to.equal( 0 );

            diff.update( state, createMessage( { a: 0, b: 10 } ) );
            expect( state.diff ).to.equal( -10 );

            diff.update( state, createMessage( { a: 10, b: 0 } ) );
            expect( state.diff ).to.equal( 10 );
        } );

        it( 'defaults absolute to false', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'defaultAbsolute',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            const state = diff.init( spec );
            expect( state.absolute ).to.equal( false );
        } );
    } );

    describe( 'Spec validation', function () {
        it( 'rejects invalid nodeType', function () {
            const badSpec = {
                nodeType: 'INVALID',
                name: 'test',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            expect( () => diff.init( badSpec ) ).to.throw( /nodeType/ );
        } );

        it( 'rejects invalid name', function () {
            const badSpec = {
                nodeType: 'Diff',
                name: '123-invalid',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            expect( () => diff.init( badSpec ) ).to.throw( /identifier/ );
        } );

        it( 'rejects missing from.x', function () {
            const badSpec = {
                nodeType: 'Diff',
                name: 'test',
                from: { y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            expect( () => diff.init( badSpec ) ).to.throw( /Required field missing/ );
        } );

        it( 'rejects missing from.y', function () {
            const badSpec = {
                nodeType: 'Diff',
                name: 'test',
                from: { x: 'a' },
                stats: { diff: { storeAs: 'out' } }
            };
            expect( () => diff.init( badSpec ) ).to.throw( /Required field missing/ );
        } );

        it( 'rejects from.x with spaces', function () {
            const badSpec = {
                nodeType: 'Diff',
                name: 'test',
                from: { x: 'bad field', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            expect( () => diff.init( badSpec ) ).to.throw( /spaces/ );
        } );

        it( 'rejects from.y with spaces', function () {
            const badSpec = {
                nodeType: 'Diff',
                name: 'test',
                from: { x: 'a', y: 'bad field' },
                stats: { diff: { storeAs: 'out' } }
            };
            expect( () => diff.init( badSpec ) ).to.throw( /spaces/ );
        } );

        it( 'rejects same field for x and y', function () {
            const badSpec = {
                nodeType: 'Diff',
                name: 'test',
                from: { x: 'same', y: 'same' },
                stats: { diff: { storeAs: 'out' } }
            };
            expect( () => diff.init( badSpec ) ).to.throw( /different fields/ );
        } );

        it( 'rejects missing stats', function () {
            const badSpec = {
                nodeType: 'Diff',
                name: 'test',
                from: { x: 'a', y: 'b' }
            };
            expect( () => diff.init( badSpec ) ).to.throw( /Required field missing/ );
        } );

        it( 'rejects unsupported stat', function () {
            const badSpec = {
                nodeType: 'Diff',
                name: 'test',
                from: { x: 'a', y: 'b' },
                stats: { delta: { storeAs: 'out' } }
            };
            expect( () => diff.init( badSpec ) ).to.throw( /Invalid property name/ );
        } );

        it( 'rejects invalid storeAs', function () {
            const badSpec = {
                nodeType: 'Diff',
                name: 'test',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: '123-invalid' } }
            };
            expect( () => diff.init( badSpec ) ).to.throw( /identifier/ );
        } );

        it( 'accepts valid spec without absolute', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'valid',
                from: { x: 'high', y: 'low' },
                stats: { diff: { storeAs: 'spread' } }
            };
            const state = diff.init( spec );
            expect( state.x ).to.equal( 'high' );
            expect( state.y ).to.equal( 'low' );
            expect( state.diff ).to.equal( 0 );
            expect( state.disable ).to.equal( false );
            expect( state.pause ).to.equal( false );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'accepts valid spec with absolute', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'validAbs',
                from: { x: 'a', y: 'b' },
                absolute: true,
                stats: { diff: { storeAs: 'gap' } }
            };
            const state = diff.init( spec );
            expect( state.absolute ).to.equal( true );
            expect( state.x ).to.equal( 'a' );
            expect( state.diff ).to.equal( 0 );
        } );
    } );

    describe( 'Introspect accessors', function () {
        it( 'returns expected node type', function () {
            expect( getNodeType() ).to.equal( 'Diff' );
        } );

        it( 'getSupportedStats returns a copy', function () {
            const stats = getSupportedStats();
            expect( stats ).to.be.an( 'array' );
            expect( stats ).to.include( 'diff' );

            stats.push( 'mutation' );
            const stats2 = getSupportedStats();
            expect( stats2 ).to.not.include( 'mutation' );
        } );

        it( 'getStatDescriptions returns descriptions', function () {
            const desc = getStatDescriptions();
            expect( desc.diff ).to.equal( 'Difference between two message values (x - y)' );
        } );

        it( 'getSupportedControlMethods returns all control methods', function () {
            const methods = getSupportedControlMethods();
            expect( Object.keys( methods ).sort() ).to.deep.equal(
                [ 'disable', 'enable', 'pause', 'reset', 'unpause' ]
            );
        } );

        it( 'getCapabilities returns capabilities', function () {
            const cap = getCapabilities();
            expect( cap.description ).to.equal( 'Computes the difference between two numeric fields in a message' );
            expect( cap.features ).to.be.an( 'array' ).with.length.greaterThan( 0 );
        } );

        it( 'getDSLMetadata returns metadata with schema and builder', function () {
            const dsl = getDSLMetadata();
            expect( dsl ).to.have.property( 'specSchema' ).that.is.an( 'object' );
            expect( dsl ).to.have.property( 'buildSpec' ).that.is.a( 'function' );
            expect( dsl ).to.have.property( 'crossFieldValidators' ).that.is.an( 'array' );
        } );

        it( 'DEFAULT_OPTIONS has expected values', function () {
            expect( DEFAULT_OPTIONS ).to.have.property( 'absolute' ).that.equals( false );
        } );
    } );

    describe( 'DSL buildSpec', function () {
        it( 'builds basic spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'spread',
                'high',
                'low',
                { diff: { storeAs: 'spread' } },
                {}
            );

            expect( spec.nodeType ).to.equal( 'Diff' );
            expect( spec.name ).to.equal( 'spread' );
            expect( spec.from ).to.deep.equal( { x: 'high', y: 'low' } );
            expect( spec.stats.diff.storeAs ).to.equal( 'spread' );
        } );

        it( 'builds spec with absolute option', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'gap',
                'a',
                'b',
                { diff: { storeAs: 'gap' } },
                { absolute: true }
            );

            expect( spec.absolute ).to.equal( true );
        } );
    } );

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'pauseTest',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            const state = diff.init( spec );

            diff.update( state, createMessage( { a: 100, b: 60 } ) );
            expect( state.diff ).to.equal( 40 );

            diff.pause( state );
            diff.update( state, createMessage( { a: 200, b: 50 } ) );

            expect( state.diff ).to.equal( 40 );
        } );

        it( 'publishes when paused', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'pausePub',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            const state = diff.init( spec );

            diff.update( state, createMessage( { a: 100, b: 60 } ) );

            diff.pause( state );
            const output = Object.create( null );
            diff.publishTo( state, output );

            expect( output.out ).to.equal( 40 );
        } );

        it( 'pause() and unpause() toggle the pause flag', function () {
            const spec = {
                nodeType: 'Diff',
                name: 'pauseToggle',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            const state = diff.init( spec );
            expect( state.pause ).to.equal( false );

            diff.pause( state );
            expect( state.pause ).to.equal( true );

            diff.unpause( state );
            expect( state.pause ).to.equal( false );
        } );
    } );
} );

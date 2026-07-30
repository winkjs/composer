/* eslint-disable no-unused-expressions */
/**
 * Comprehensive test suite for accumulate node.
 * Tests simple running sum accumulation.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import * as accumulate from '../index.js';
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

describe( 'Accumulate Node', function () {
    describe( 'Basic functionality', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'accum',
                from: { x: 'value' },
                stats: { sum: { storeAs: 'total' } }
            };
            state = accumulate.init( spec );
        } );

        it( 'starts with sum of 0', function () {
            expect( state.sum ).to.equal( 0 );
        } );

        it( 'accumulates positive value', function () {
            accumulate.update( state, createMessage( { value: 10 } ) );
            expect( state.sum ).to.equal( 10 );
        } );

        it( 'accumulates multiple values', function () {
            accumulate.update( state, createMessage( { value: 10 } ) );
            accumulate.update( state, createMessage( { value: 20 } ) );
            accumulate.update( state, createMessage( { value: 30 } ) );
            expect( state.sum ).to.equal( 60 );
        } );

        it( 'handles sequence of values correctly', function () {
            const testCases = [
                { value: 5, expected: 5 },
                { value: 10, expected: 15 },
                { value: -3, expected: 12 },
                { value: 8, expected: 20 }
            ];

            testCases.forEach( ( tc ) => {
                accumulate.update( state, createMessage( { value: tc.value } ) );
                expect( state.sum ).to.equal( tc.expected );
            } );
        } );
    } );

    describe( 'Numeric edge cases', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'numeric',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            state = accumulate.init( spec );
        } );

        it( 'accumulates zero (sum unchanged)', function () {
            accumulate.update( state, createMessage( { val: 10 } ) );
            accumulate.update( state, createMessage( { val: 0 } ) );
            expect( state.sum ).to.equal( 10 );
        } );

        it( 'accumulates negative values', function () {
            accumulate.update( state, createMessage( { val: -5 } ) );
            expect( state.sum ).to.equal( -5 );
        } );

        it( 'accumulates mixed positive and negative', function () {
            accumulate.update( state, createMessage( { val: 10 } ) );
            accumulate.update( state, createMessage( { val: -3 } ) );
            accumulate.update( state, createMessage( { val: 7 } ) );
            accumulate.update( state, createMessage( { val: -14 } ) );
            expect( state.sum ).to.equal( 0 );
        } );

        it( 'accumulates floating point values', function () {
            accumulate.update( state, createMessage( { val: 0.1 } ) );
            accumulate.update( state, createMessage( { val: 0.2 } ) );
            // Note: 0.1 + 0.2 !== 0.3 in JS due to floating point
            expect( state.sum ).to.be.closeTo( 0.3, 0.0001 );
        } );

        it( 'handles large values', function () {
            accumulate.update( state, createMessage( { val: 1e10 } ) );
            accumulate.update( state, createMessage( { val: 1e10 } ) );
            expect( state.sum ).to.equal( 2e10 );
        } );

        it( 'handles very small values', function () {
            accumulate.update( state, createMessage( { val: 1e-10 } ) );
            accumulate.update( state, createMessage( { val: 1e-10 } ) );
            expect( state.sum ).to.be.closeTo( 2e-10, 1e-15 );
        } );
    } );

    describe( 'Invalid input handling', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'validator',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            state = accumulate.init( spec );
        } );

        it( 'sets inputValidationFailed on NaN', function () {
            accumulate.update( state, createMessage( { val: NaN } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on Infinity', function () {
            accumulate.update( state, createMessage( { val: Infinity } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on negative Infinity', function () {
            accumulate.update( state, createMessage( { val: -Infinity } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on undefined', function () {
            accumulate.update( state, createMessage( { val: undefined } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on missing field', function () {
            accumulate.update( state, createMessage( {} ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on string', function () {
            accumulate.update( state, createMessage( { val: 'not a number' } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on null', function () {
            accumulate.update( state, createMessage( { val: null } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'preserves sum on invalid input', function () {
            accumulate.update( state, createMessage( { val: 10 } ) );
            accumulate.update( state, createMessage( { val: NaN } ) );
            expect( state.sum ).to.equal( 10 );
        } );

        it( 'recovers from invalid input', function () {
            accumulate.update( state, createMessage( { val: 10 } ) );
            accumulate.update( state, createMessage( { val: NaN } ) );
            expect( state.inputValidationFailed ).to.equal( true );

            accumulate.update( state, createMessage( { val: 5 } ) );
            expect( state.inputValidationFailed ).to.equal( false );
            expect( state.sum ).to.equal( 15 );
        } );
    } );

    describe( 'Publishing', function () {
        it( 'publishes sum to configured storeAs field', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'pub',
                from: { x: 'value' },
                stats: { sum: { storeAs: 'total' } }
            };
            const state = accumulate.init( spec );

            accumulate.update( state, createMessage( { value: 10 } ) );
            accumulate.update( state, createMessage( { value: 20 } ) );

            const output = Object.create( null );
            accumulate.publishTo( state, output );
            expect( output.total ).to.equal( 30 );
        } );

        it( 'publishes zero when no values accumulated', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'pub2',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'result' } }
            };
            const state = accumulate.init( spec );

            const output = Object.create( null );
            accumulate.publishTo( state, output );
            expect( output.result ).to.equal( 0 );
        } );

        it( 'publishes NaN when inputValidationFailed', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'nanPub',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );

            accumulate.update( state, createMessage( { val: NaN } ) );

            const output = Object.create( null );
            accumulate.publishTo( state, output );
            expect( Number.isNaN( output.out ) ).to.equal( true );
        } );

        it( 'does not publish when disabled', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'disabledPub',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );

            accumulate.update( state, createMessage( { val: 10 } ) );
            state.disable = true;

            const output = Object.create( null );
            accumulate.publishTo( state, output );
            expect( output.out ).to.be.undefined;
        } );
    } );

    describe( 'Disable functionality', function () {
        it( 'skips update when disabled', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'disableTest',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );

            accumulate.update( state, createMessage( { val: 10 } ) );
            expect( state.sum ).to.equal( 10 );

            state.disable = true;

            accumulate.update( state, createMessage( { val: 20 } ) );
            expect( state.sum ).to.equal( 10 ); // Unchanged

            state.disable = false;
            accumulate.update( state, createMessage( { val: 5 } ) );
            expect( state.sum ).to.equal( 15 );
        } );

        it( 'preserves sum during disabled period', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'preserve',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );

            accumulate.update( state, createMessage( { val: 100 } ) );
            state.disable = true;

            // Multiple messages while disabled
            accumulate.update( state, createMessage( { val: 1 } ) );
            accumulate.update( state, createMessage( { val: 2 } ) );
            accumulate.update( state, createMessage( { val: 3 } ) );

            expect( state.sum ).to.equal( 100 ); // Still 100

            state.disable = false;
            expect( state.sum ).to.equal( 100 ); // No catch-up
        } );
    } );

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'pauseSkip',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );

            accumulate.update( state, createMessage( { val: 10 } ) );
            expect( state.sum ).to.equal( 10 );

            state.pause = true;

            accumulate.update( state, createMessage( { val: 20 } ) );
            expect( state.sum ).to.equal( 10 ); // Unchanged
        } );

        it( 'publishes when paused', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'pausePub',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );

            accumulate.update( state, createMessage( { val: 10 } ) );
            state.pause = true;

            const output = Object.create( null );
            accumulate.publishTo( state, output );
            expect( output.out ).to.equal( 10 ); // Still visible
        } );

        it( 'preserves state during paused period', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'pausePreserve',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );

            accumulate.update( state, createMessage( { val: 100 } ) );
            state.pause = true;

            // Multiple messages while paused
            accumulate.update( state, createMessage( { val: 1 } ) );
            accumulate.update( state, createMessage( { val: 2 } ) );
            accumulate.update( state, createMessage( { val: 3 } ) );

            expect( state.sum ).to.equal( 100 ); // Still 100
        } );

        it( 'resumes after unpause', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'pauseResume',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );

            accumulate.update( state, createMessage( { val: 10 } ) );
            state.pause = true;

            accumulate.update( state, createMessage( { val: 99 } ) );
            expect( state.sum ).to.equal( 10 );

            state.pause = false;
            accumulate.update( state, createMessage( { val: 5 } ) );
            expect( state.sum ).to.equal( 15 );
        } );

        it( 'pause function sets pause to true', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'pauseFn',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );

            accumulate.pause( state );
            expect( state.pause ).to.equal( true );
        } );

        it( 'unpause function sets pause to false', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'unpauseFn',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );
            state.pause = true;

            accumulate.unpause( state );
            expect( state.pause ).to.equal( false );
        } );

        it( 'init sets pause to false', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'pauseInit',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );
            expect( state.pause ).to.equal( false );
        } );

        it( 'reset does not clear pause', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'pauseReset',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );

            state.pause = true;
            accumulate.reset( state );
            expect( state.pause ).to.equal( true );
        } );
    } );

    describe( 'Reset functionality', function () {
        it( 'reset clears sum to zero', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'resetTest',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );

            accumulate.update( state, createMessage( { val: 50 } ) );
            accumulate.update( state, createMessage( { val: 50 } ) );
            expect( state.sum ).to.equal( 100 );

            accumulate.reset( state );
            expect( state.sum ).to.equal( 0 );
        } );

        it( 'reset returns true', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'resetReturn',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );
            expect( accumulate.reset( state ) ).to.equal( true );
        } );

        it( 'accumulation resumes from zero after reset', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'resumeAfterReset',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );

            accumulate.update( state, createMessage( { val: 100 } ) );
            accumulate.reset( state );
            accumulate.update( state, createMessage( { val: 10 } ) );
            expect( state.sum ).to.equal( 10 );
        } );

        it( 'multiple resets work correctly', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'multiReset',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );

            accumulate.update( state, createMessage( { val: 10 } ) );
            accumulate.reset( state );
            expect( state.sum ).to.equal( 0 );

            accumulate.update( state, createMessage( { val: 20 } ) );
            accumulate.reset( state );
            expect( state.sum ).to.equal( 0 );

            accumulate.update( state, createMessage( { val: 30 } ) );
            expect( state.sum ).to.equal( 30 );
        } );
    } );

    describe( 'Recompute', function () {
        it( 'recompute returns true', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'recomputeTest',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );
            expect( accumulate.recompute( state ) ).to.equal( true );
        } );
    } );

    describe( 'Edge cases', function () {
        it( 'handles many accumulations', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'manyAccum',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );

            for ( let i = 0; i < 1000; i += 1 ) {
                accumulate.update( state, createMessage( { val: 1 } ) );
            }
            expect( state.sum ).to.equal( 1000 );
        } );

        it( 'initializes sum to zero', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'initTest',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );
            expect( state.sum ).to.equal( 0 );
        } );

        it( 'initializes disable to false', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'disableInit',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );
            expect( state.disable ).to.equal( false );
        } );

        it( 'initializes inputValidationFailed to false', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'failedInit',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'stores nodeType in state', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'nodeTypeTest',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );
            expect( state.nodeType ).to.equal( 'Accumulate' );
        } );
    } );

    describe( 'Spec validation', function () {
        it( 'rejects invalid nodeType', function () {
            const badSpec = {
                nodeType: 'INVALID',
                name: 'test',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            expect( () => accumulate.init( badSpec ) ).to.throw( TypeError, /Must be exactly 'Accumulate'/ );
        } );

        it( 'rejects invalid name', function () {
            const badSpec = {
                nodeType: 'Accumulate',
                name: '123-invalid',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            expect( () => accumulate.init( badSpec ) ).to.throw( TypeError, /name must be a valid identifier/ );
        } );

        it( 'rejects missing from.x', function () {
            const badSpec = {
                nodeType: 'Accumulate',
                name: 'test',
                from: {},
                stats: { sum: { storeAs: 'out' } }
            };
            expect( () => accumulate.init( badSpec ) ).to.throw( TypeError, /from\.x.*Required field missing/ );
        } );

        it( 'rejects from.x with spaces', function () {
            const badSpec = {
                nodeType: 'Accumulate',
                name: 'test',
                from: { x: 'bad field' },
                stats: { sum: { storeAs: 'out' } }
            };
            expect( () => accumulate.init( badSpec ) ).to.throw( TypeError, /from\.x must not contain spaces/ );
        } );

        it( 'rejects missing stats', function () {
            const badSpec = {
                nodeType: 'Accumulate',
                name: 'test',
                from: { x: 'val' }
            };
            expect( () => accumulate.init( badSpec ) ).to.throw( TypeError, /stats.*Required field missing/ );
        } );

        it( 'rejects unsupported stat', function () {
            const badSpec = {
                nodeType: 'Accumulate',
                name: 'test',
                from: { x: 'val' },
                stats: { delta: { storeAs: 'out' } }
            };
            expect( () => accumulate.init( badSpec ) ).to.throw( TypeError, /Invalid property name 'delta'/ );
        } );

        it( 'rejects invalid storeAs', function () {
            const badSpec = {
                nodeType: 'Accumulate',
                name: 'test',
                from: { x: 'val' },
                stats: { sum: { storeAs: '123-invalid' } }
            };
            expect( () => accumulate.init( badSpec ) ).to.throw( TypeError, /storeAs must be a valid identifier/ );
        } );

        it( 'accepts valid spec and returns correct initial state', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'valid',
                from: { x: 'value' },
                stats: { sum: { storeAs: 'total' } }
            };
            const state = accumulate.init( spec );
            expect( state.sum ).to.equal( 0 );
            expect( state.x ).to.equal( 'value' );
            expect( state.inputValidationFailed ).to.equal( false );
            expect( state.disable ).to.equal( false );
            expect( state.pause ).to.equal( false );
            expect( state.nodeType ).to.equal( 'Accumulate' );
        } );
    } );

    describe( 'Introspect accessors', function () {
        it( 'returns expected node type', function () {
            expect( getNodeType() ).to.equal( 'Accumulate' );
        } );

        it( 'getSupportedStats returns a copy', function () {
            const stats = getSupportedStats();
            expect( stats ).to.be.an( 'array' );
            expect( stats ).to.include( 'sum' );

            stats.push( 'mutation' );
            const stats2 = getSupportedStats();
            expect( stats2 ).to.not.include( 'mutation' );
        } );

        it( 'getStatDescriptions returns descriptions', function () {
            const desc = getStatDescriptions();
            expect( desc ).to.be.an( 'object' );
            expect( desc ).to.have.property( 'sum' ).that.is.a( 'string' );
        } );

        it( 'getSupportedControlMethods returns reset/enable/disable/pause/unpause', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'reset' );
            expect( methods ).to.have.property( 'enable' );
            expect( methods ).to.have.property( 'disable' );
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
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

        it( 'DEFAULT_OPTIONS is empty object', function () {
            expect( DEFAULT_OPTIONS ).to.be.an( 'object' );
            expect( Object.keys( DEFAULT_OPTIONS ) ).to.have.lengthOf( 0 );
        } );
    } );

    describe( 'DSL buildSpec', function () {
        it( 'builds basic spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'accum',
                'value',
                { sum: { storeAs: 'total' } },
                {}
            );

            expect( spec.nodeType ).to.equal( 'Accumulate' );
            expect( spec.name ).to.equal( 'accum' );
            expect( spec.from ).to.deep.equal( { x: 'value' } );
            expect( spec.stats.sum.storeAs ).to.equal( 'total' );
        } );

        it( 'spreads options into spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'test',
                'val',
                { sum: { storeAs: 'out' } },
                { customOption: 'value' }
            );

            expect( spec.customOption ).to.equal( 'value' );
        } );
    } );

    describe( 'Enable/Disable control', function () {
        it( 'enable function sets disable to false', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'enableTest',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );
            state.disable = true;

            accumulate.enable( state );
            expect( state.disable ).to.equal( false );
        } );

        it( 'disable function sets disable to true', function () {
            const spec = {
                nodeType: 'Accumulate',
                name: 'disableTest',
                from: { x: 'val' },
                stats: { sum: { storeAs: 'out' } }
            };
            const state = accumulate.init( spec );

            accumulate.disable( state );
            expect( state.disable ).to.equal( true );
        } );
    } );
} );

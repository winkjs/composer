/**
 * Tests for passIf node — update() hot path: basic gating,
 * counter-based predicates, message-based predicates, and
 * predicate exception handling (one-log-per-episode).
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { init, update } from '../index.js';
import { validSpec } from './test-helpers.js';

describe( 'Pass-If Node — Update', function () {

    describe( 'update() - basic gating', function () {
        it( 'passes message when predicate returns true', function () {
            const state = init( validSpec( 'positive', ( msg, _counter ) => msg.value > 0 ) );

            const result = update( state, { value: 10 } );
            expect( result ).to.equal( state );
        } );

        it( 'blocks message when predicate returns false', function () {
            const state = init( validSpec( 'positive', ( msg, _counter ) => msg.value > 0 ) );

            const result = update( state, { value: -5 } );
            expect( result ).to.equal( null );
        } );

        it( 'increments counter on each message', function () {
            const state = init( validSpec( 'always', ( _msg, _counter ) => true ) );

            expect( state.counter ).to.equal( 0 );

            update( state, {} );
            expect( state.counter ).to.equal( 1 );

            update( state, {} );
            expect( state.counter ).to.equal( 2 );

            update( state, {} );
            expect( state.counter ).to.equal( 3 );
        } );

        it( 'increments counter even when message is blocked', function () {
            const state = init( validSpec( 'never', ( _msg, _counter ) => false ) );

            update( state, {} );
            update( state, {} );
            update( state, {} );

            expect( state.counter ).to.equal( 3 );
        } );
    } );

    describe( 'update() - counter-based predicates', function () {
        it( 'supports nth sample (modulo) patterns', function () {
            const state = init( validSpec( 'sample5', ( _msg, counter ) => counter % 5 === 1 ) );

            const results = [];
            for ( let i = 0; i < 12; i += 1 ) {
                results.push( update( state, {} ) !== null );
            }

            expect( results ).to.deep.equal( [
                true, false, false, false, false,
                true, false, false, false, false,
                true, false
            ] );
        } );

        it( 'supports first-N patterns', function () {
            const state = init( validSpec( 'first3', ( _msg, counter ) => counter <= 3 ) );

            const results = [];
            for ( let i = 0; i < 6; i += 1 ) {
                results.push( update( state, {} ) !== null );
            }

            expect( results ).to.deep.equal( [
                true, true, true, false, false, false
            ] );
        } );

        it( 'supports after-warmup patterns', function () {
            const state = init( validSpec( 'afterWarmup', ( _msg, counter ) => counter > 5 ) );

            const results = [];
            for ( let i = 0; i < 8; i += 1 ) {
                results.push( update( state, {} ) !== null );
            }

            expect( results ).to.deep.equal( [
                false, false, false, false, false,
                true, true, true
            ] );
        } );
    } );

    describe( 'update() - message-based predicates', function () {
        it( 'filters by message field value', function () {
            const state = init( validSpec( 'highTemp', ( msg, _counter ) => msg.temperature > 30 ) );

            expect( update( state, { temperature: 35 } ) ).to.equal( state );
            expect( update( state, { temperature: 25 } ) ).to.equal( null );
            expect( update( state, { temperature: 31 } ) ).to.equal( state );
        } );

        it( 'filters by multiple conditions', function () {
            const state = init( validSpec( 'valid', ( msg, _counter ) => msg.temperature > 0 && msg.pressure > 0 ) );

            expect( update( state, { temperature: 25, pressure: 100 } ) ).to.equal( state );
            expect( update( state, { temperature: -5, pressure: 100 } ) ).to.equal( null );
            expect( update( state, { temperature: 25, pressure: -10 } ) ).to.equal( null );
        } );

        it( 'supports combined message and counter predicates', function () {
            const state = init( validSpec( 'highAfterWarmup', ( msg, counter ) => counter > 3 && msg.value > 50 ) );

            expect( update( state, { value: 100 } ) ).to.equal( null );
            expect( update( state, { value: 100 } ) ).to.equal( null );
            expect( update( state, { value: 100 } ) ).to.equal( null );
            expect( update( state, { value: 30 } ) ).to.equal( null );
            expect( update( state, { value: 80 } ) ).to.equal( state );
        } );
    } );

    describe( 'update() - predicate error handling', function () {
        let consoleStub;

        beforeEach( function () {
            consoleStub = sinon.stub( console, 'error' );
        } );

        afterEach( function () {
            consoleStub.restore();
        } );

        it( 'treats exceptions as false (blocks message)', function () {
            const throwingPredicate = function ( _msg, _counter ) {
                throw new Error( 'Test error' );
            };
            const state = init( validSpec( 'throws', throwingPredicate ) );

            const result = update( state, {} );
            expect( result ).to.equal( null );
        } );

        it( 'logs predicate errors to console', function () {
            const throwingPredicate = function ( _msg, _counter ) {
                throw new Error( 'Test error' );
            };
            const state = init( validSpec( 'throws', throwingPredicate ) );

            update( state, {} );

            expect( consoleStub.calledOnce ).to.equal( true );
            expect( consoleStub.firstCall.args[ 0 ] ).to.include( 'predicate threw exception' );
            expect( consoleStub.firstCall.args[ 0 ] ).to.include( 'Test error' );
        } );

        it( 'continues processing after predicate error', function () {
            let shouldThrow = true;
            const conditionalPredicate = function ( _msg, _counter ) {
                if ( shouldThrow ) {
                    throw new Error( 'First call fails' );
                }
                return true;
            };
            const state = init( validSpec( 'intermittent', conditionalPredicate ) );

            expect( update( state, {} ) ).to.equal( null );

            shouldThrow = false;
            expect( update( state, {} ) ).to.equal( state );
        } );

        it( 'suppresses log on repeated exceptions', function () {
            const throwingPredicate = function ( _msg, _counter ) {
                throw new Error( 'repeated error' );
            };
            const state = init( validSpec( 'suppression', throwingPredicate ) );

            update( state, {} );
            update( state, {} );
            update( state, {} );

            expect( consoleStub.calledOnce ).to.equal( true );
        } );

        it( 'logs again after recovery', function () {
            let shouldThrow = true;
            const conditionalPredicate = function ( _msg, _counter ) {
                if ( shouldThrow ) {
                    throw new Error( 'intermittent error' );
                }
                return true;
            };
            const state = init( validSpec( 'recovery', conditionalPredicate ) );

            // First error — logs
            update( state, {} );
            expect( consoleStub.calledOnce ).to.equal( true );

            // Recovery
            shouldThrow = false;
            update( state, {} );

            // Second error — logs again (new episode)
            shouldThrow = true;
            update( state, {} );
            expect( consoleStub.calledTwice ).to.equal( true );
        } );
    } );
} );

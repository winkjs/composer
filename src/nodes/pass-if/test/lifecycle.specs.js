/**
 * Tests for passIf node — lifecycle controls: disable/enable,
 * pause/unpause, reset, and recompute.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    init,
    update,
    publishTo,
    reset,
    recompute,
    disable,
    enable,
    pause,
    unpause,
    getSupportedControlMethods
} from '../index.js';
import { validSpec } from './test-helpers.js';

describe( 'Pass-If Node — Lifecycle', function () {

    describe( 'disable/enable behavior', function () {
        it( 'returns state early when disabled', function () {
            const state = init( validSpec( 'test', ( _msg, _counter ) => false ) );

            state.disable = true;
            const result = update( state, {} );

            expect( result ).to.equal( state );
        } );

        it( 'does not increment counter when disabled', function () {
            const state = init( validSpec( 'test', ( _msg, _counter ) => true ) );

            state.disable = true;
            update( state, {} );
            update( state, {} );

            expect( state.counter ).to.equal( 0 );
        } );

        it( 'does not evaluate predicate when disabled', function () {
            let predicateCalled = false;
            const trackingPredicate = function ( _msg, _counter ) {
                predicateCalled = true;
                return true;
            };
            const state = init( validSpec( 'test', trackingPredicate ) );

            state.disable = true;
            update( state, {} );

            expect( predicateCalled ).to.equal( false );
        } );

        it( 'disable() sets flag and returns true', function () {
            const state = init( validSpec( 'test', ( _msg, _counter ) => true ) );

            expect( disable( state ) ).to.equal( true );
            expect( state.disable ).to.equal( true );
        } );

        it( 'enable() clears flag and returns true', function () {
            const state = init( validSpec( 'test', ( _msg, _counter ) => true ) );

            disable( state );
            expect( enable( state ) ).to.equal( true );
            expect( state.disable ).to.equal( false );
        } );

        it( 'resumes processing after enable()', function () {
            const state = init( validSpec( 'test', ( msg, _counter ) => msg.value > 0 ) );

            disable( state );
            expect( update( state, { value: 10 } ) ).to.equal( state );

            enable( state );
            expect( update( state, { value: 10 } ) ).to.equal( state );
            expect( update( state, { value: -1 } ) ).to.equal( null );
        } );
    } );

    describe( 'reset()', function () {
        it( 'resets counter to zero', function () {
            const state = init( validSpec( 'test', ( _msg, _counter ) => true ) );

            update( state, {} );
            update( state, {} );
            update( state, {} );
            expect( state.counter ).to.equal( 3 );

            reset( state );
            expect( state.counter ).to.equal( 0 );
        } );

        it( 'returns true', function () {
            const state = init( validSpec( 'test', ( _msg, _counter ) => true ) );

            expect( reset( state ) ).to.equal( true );
        } );

        it( 'allows counter-based predicates to restart', function () {
            const state = init( validSpec( 'first2', ( _msg, counter ) => counter <= 2 ) );

            expect( update( state, {} ) ).to.equal( state );
            expect( update( state, {} ) ).to.equal( state );
            expect( update( state, {} ) ).to.equal( null );

            reset( state );
            expect( update( state, {} ) ).to.equal( state );
            expect( update( state, {} ) ).to.equal( state );
            expect( update( state, {} ) ).to.equal( null );
        } );

        it( 'clears error suppression flag', function () {
            const state = init( validSpec( 'test', ( _msg, _counter ) => true ) );

            state.predicateErrorLogged = true;
            reset( state );
            expect( state.predicateErrorLogged ).to.equal( false );
        } );

        it( 'is idempotent on fresh state', function () {
            const state = init( validSpec( 'test', ( _msg, _counter ) => true ) );

            expect( reset( state ) ).to.equal( true );
            expect( state.counter ).to.equal( 0 );
            expect( state.predicateErrorLogged ).to.equal( false );
        } );

        it( 'is idempotent when called twice', function () {
            const state = init( validSpec( 'test', ( _msg, _counter ) => true ) );

            update( state, {} );
            update( state, {} );

            reset( state );
            expect( reset( state ) ).to.equal( true );
            expect( state.counter ).to.equal( 0 );
            expect( state.predicateErrorLogged ).to.equal( false );
        } );
    } );

    describe( 'recompute()', function () {
        it( 'returns true (no numerical stability needed)', function () {
            expect( recompute() ).to.equal( true );
        } );
    } );

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused — returns state regardless of predicate', function () {
            const state = init( validSpec( 'pauseGate', ( _msg, _counter ) => false ) );

            update( state, {} );
            const counterAfterFirst = state.counter;

            state.pause = true;

            const result = update( state, {} );

            expect( result ).to.equal( state );
            expect( state.counter ).to.equal( counterAfterFirst );
        } );

        it( 'publishes when paused', function () {
            const state = init( validSpec( 'pausePub', ( _msg, _counter ) => true ) );

            update( state, {} );

            state.pause = true;

            const output = { original: 'data' };
            publishTo( state, output );

            // passIf publishTo is a no-op (pure gate), so just verify it runs without error
            expect( output.original ).to.equal( 'data' );
        } );

        it( 'pause/unpause control methods exist', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );

        it( 'pause() sets flag and returns true', function () {
            const state = init( validSpec( 'test', ( _msg, _counter ) => true ) );

            expect( pause( state ) ).to.equal( true );
            expect( state.pause ).to.equal( true );
        } );

        it( 'unpause() clears flag and returns true', function () {
            const state = init( validSpec( 'test', ( _msg, _counter ) => true ) );

            pause( state );
            expect( unpause( state ) ).to.equal( true );
            expect( state.pause ).to.equal( false );
        } );

        it( 'resumes predicate evaluation after unpause()', function () {
            const state = init( validSpec( 'test', ( msg, _counter ) => msg.value > 0 ) );

            pause( state );
            // Paused — returns state regardless of predicate
            expect( update( state, { value: -1 } ) ).to.equal( state );

            unpause( state );
            // Unpaused — predicate evaluates normally
            expect( update( state, { value: 10 } ) ).to.equal( state );
            expect( update( state, { value: -1 } ) ).to.equal( null );
        } );
    } );
} );

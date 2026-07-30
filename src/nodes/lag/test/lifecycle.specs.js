/**
 * Tests for lag node lifecycle — reset, recompute, disable/enable,
 * pause/unpause control signals.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as lag from '../index.js';
import { getSupportedControlMethods } from '../introspect.js';
import { createMessage } from './test-helpers.js';

// ── Test Suite ─────────────────────────────────────────────────────────────

describe( 'Lag Node — Lifecycle', function () {
    // ════════════════════════════════════════════════════════════════════════
    // Reset Behavior
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Reset behavior', function () {
        it( 'returns true', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'resetTest',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );
            const result = lag.reset( state );
            expect( result ).to.equal( true );
        } );

        it( 'resets computed values to NaN', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'resetValues',
                from: { x: 'value' },
                timestamp: 'ts',
                stats: {
                    delta: { storeAs: 'd' },
                    slope: { storeAs: 's' }
                }
            };
            const state = lag.init( spec );

            // Fill buffer and compute
            lag.update( state, createMessage( { value: 10, ts: 0 } ) );
            lag.update( state, createMessage( { value: 20, ts: 1 } ) );
            expect( state.delta ).to.equal( 10 );

            // Reset
            lag.reset( state );
            expect( Number.isNaN( state.delta ) ).to.equal( true );
            expect( Number.isNaN( state.slope ) ).to.equal( true );
        } );

        it( 'requires buffer refill after reset', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'resetRefill',
                from: { x: 'value' },
                lag: 2,
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );

            // Fill buffer
            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );
            lag.update( state, createMessage( { value: 35 } ) );
            expect( state.delta ).to.equal( 25 ); // 35 - 10

            // Reset and verify refill is needed
            lag.reset( state );
            lag.update( state, createMessage( { value: 100 } ) );
            expect( Number.isNaN( state.delta ) ).to.equal( true );

            lag.update( state, createMessage( { value: 200 } ) );
            expect( Number.isNaN( state.delta ) ).to.equal( true );

            lag.update( state, createMessage( { value: 350 } ) );
            expect( state.delta ).to.equal( 250 ); // 350 - 100
        } );

        it( 'double-reset is idempotent', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'doubleReset',
                from: { x: 'value' },
                timestamp: 'ts',
                stats: {
                    delta: { storeAs: 'd' },
                    slope: { storeAs: 's' },
                    cumDelta: { storeAs: 'cumD' }
                }
            };
            const state = lag.init( spec );

            // Build up state
            lag.update( state, createMessage( { value: 10, ts: 0 } ) );
            lag.update( state, createMessage( { value: 20, ts: 1 } ) );

            // Double reset
            lag.reset( state );
            lag.reset( state );

            // Verify same as single reset
            expect( Number.isNaN( state.delta ) ).to.equal( true );
            expect( Number.isNaN( state.slope ) ).to.equal( true );
            expect( state.cumDelta ).to.equal( 0 );

            // Verify node still works after double reset
            lag.update( state, createMessage( { value: 50, ts: 2 } ) );
            // xLag=20 (preserved buffer), tLag=1: delta=30, slope=30, cumDelta=30
            expect( state.delta ).to.equal( 30 );
            expect( state.slope ).to.equal( 30 );
            expect( state.cumDelta ).to.equal( 30 );

            lag.update( state, createMessage( { value: 80, ts: 3 } ) );
            // xLag=50, tLag=2: delta=30, slope=30, cumDelta=30+30=60
            expect( state.delta ).to.equal( 30 );
            expect( state.slope ).to.equal( 30 );
            expect( state.cumDelta ).to.equal( 60 );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Recompute
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Recompute', function () {
        it( 'recompute returns true', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'recomputeTest',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );
            const result = lag.recompute( state );
            expect( result ).to.equal( true );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Disable/Enable Behavior
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Disable/enable behavior', function () {
        it( 'skips update when disabled', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'disableTest',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );
            expect( state.delta ).to.equal( 10 );

            state.disable = true;

            // This should be ignored
            lag.update( state, createMessage( { value: 100 } ) );
            expect( state.delta ).to.equal( 10 ); // Unchanged
        } );

        it( 'skips publish when disabled', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'disablePub',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );

            state.disable = true;

            const output = Object.create( null );
            lag.publishTo( state, output );
            expect( output.diff ).to.equal( undefined );
        } );

        it( 'resumes after re-enable', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'reenable',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'diff' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );

            state.disable = true;
            lag.update( state, createMessage( { value: 100 } ) ); // Ignored

            state.disable = false;
            lag.update( state, createMessage( { value: 30 } ) );
            expect( state.delta ).to.equal( 10 ); // 30 - 20 (buffer wasn't updated while disabled)
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Pause/Unpause Control
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'pauseSkip',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'd' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );
            const deltaBefore = state.delta;

            state.pause = true;

            lag.update( state, createMessage( { value: 100 } ) );
            expect( state.delta ).to.equal( deltaBefore );
        } );

        it( 'publishes when paused', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'pausePub',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'd' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );

            state.pause = true;

            const output = Object.create( null );
            lag.publishTo( state, output );
            expect( 'd' in output ).to.equal( true );
            expect( output.d ).to.equal( state.delta );
        } );

        it( 'pause/unpause control methods exist', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );

        it( 'resumes update after unpause', function () {
            const spec = {
                nodeType: 'Lag',
                name: 'unpauseResume',
                from: { x: 'value' },
                stats: { delta: { storeAs: 'd' } }
            };
            const state = lag.init( spec );

            lag.update( state, createMessage( { value: 10 } ) );
            lag.update( state, createMessage( { value: 20 } ) );
            expect( state.delta ).to.equal( 10 );

            // Pause: update skipped
            state.pause = true;
            lag.update( state, createMessage( { value: 100 } ) );
            expect( state.delta ).to.equal( 10 ); // Unchanged

            // Unpause: update resumes and advances ring buffer state
            state.pause = false;
            lag.update( state, createMessage( { value: 30 } ) );
            expect( state.delta ).to.equal( 10 ); // 30 - 20 (buffer wasn't updated while paused)
        } );
    } );
} );

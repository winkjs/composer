/**
 * Tests for invertFlag node lifecycle — reset, recompute, disable/enable,
 * pause/unpause control signals.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as invertFlag from '../index.js';
import { getSupportedControlMethods } from '../introspect.js';
import { INVERT_SPEC, createMessage } from './test-helpers.js';

// ── Test Suite ─────────────────────────────────────────────────────────────

describe( 'Invert Flag Node — Lifecycle', function () {
    // ════════════════════════════════════════════════════════════════════════
    // Reset Behavior
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Reset behavior', function () {
        it( 'returns true', function () {
            const state = invertFlag.init( INVERT_SPEC );
            expect( invertFlag.reset( state ) ).to.equal( true );
        } );

        it( 'clears inverted to false after update', function () {
            const state = invertFlag.init( INVERT_SPEC );

            invertFlag.update( state, createMessage( { flag: false } ) );
            expect( state.inverted ).to.equal( true );

            invertFlag.reset( state );
            expect( state.inverted ).to.equal( false );
        } );

        it( 'reset-then-update produces fresh result', function () {
            const state = invertFlag.init( INVERT_SPEC );

            // First update
            invertFlag.update( state, createMessage( { flag: false } ) );
            expect( state.inverted ).to.equal( true );

            // Reset clears state
            invertFlag.reset( state );
            expect( state.inverted ).to.equal( false );

            // Fresh update after reset
            invertFlag.update( state, createMessage( { flag: true } ) );
            expect( state.inverted ).to.equal( false );
        } );

        it( 'double reset is idempotent', function () {
            const state = invertFlag.init( INVERT_SPEC );

            invertFlag.update( state, createMessage( { flag: false } ) );
            expect( state.inverted ).to.equal( true );

            invertFlag.reset( state );
            invertFlag.reset( state );
            expect( state.inverted ).to.equal( false );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Recompute Behavior
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Recompute behavior', function () {
        it( 'returns true', function () {
            const state = invertFlag.init( INVERT_SPEC );
            expect( invertFlag.recompute( state ) ).to.equal( true );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Disable / Enable
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Disable functionality', function () {
        it( 'skips update when disabled', function () {
            const state = invertFlag.init( INVERT_SPEC );

            invertFlag.update( state, createMessage( { flag: true } ) );
            expect( state.inverted ).to.equal( false );

            state.disable = true;

            invertFlag.update( state, createMessage( { flag: false } ) );
            expect( state.inverted ).to.equal( false ); // Unchanged

            state.disable = false;
            invertFlag.update( state, createMessage( { flag: false } ) );
            expect( state.inverted ).to.equal( true );
        } );
    } );

    describe( 'Enable/Disable control', function () {
        it( 'enable function sets disable to false', function () {
            const state = invertFlag.init( INVERT_SPEC );
            state.disable = true;

            invertFlag.enable( state );
            expect( state.disable ).to.equal( false );
        } );

        it( 'disable function sets disable to true', function () {
            const state = invertFlag.init( INVERT_SPEC );

            invertFlag.disable( state );
            expect( state.disable ).to.equal( true );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Pause / Unpause
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused via pause() function', function () {
            const state = invertFlag.init( INVERT_SPEC );

            invertFlag.update( state, createMessage( { flag: true } ) );
            expect( state.inverted ).to.equal( false );

            invertFlag.pause( state );

            invertFlag.update( state, createMessage( { flag: false } ) );
            expect( state.inverted ).to.equal( false ); // Unchanged
        } );

        it( 'resumes update after unpause() function', function () {
            const state = invertFlag.init( INVERT_SPEC );

            invertFlag.pause( state );

            invertFlag.update( state, createMessage( { flag: false } ) );
            expect( state.inverted ).to.equal( false ); // Unchanged — still initial

            invertFlag.unpause( state );

            invertFlag.update( state, createMessage( { flag: false } ) );
            expect( state.inverted ).to.equal( true );
        } );

        it( 'publishes when paused', function () {
            const state = invertFlag.init( INVERT_SPEC );

            invertFlag.update( state, createMessage( { flag: true } ) );

            invertFlag.pause( state );

            const output = Object.create( null );
            invertFlag.publishTo( state, output );
            expect( 'out' in output ).to.equal( true );
            expect( output.out ).to.equal( false );
        } );

        it( 'pause/unpause control methods exist', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );
    } );
} );

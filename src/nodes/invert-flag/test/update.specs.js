/**
 * Tests for invertFlag node update() — boolean inversion, truthy/falsy
 * coercion, invalid input handling, and edge cases.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import * as invertFlag from '../index.js';
import { createMessage } from './test-helpers.js';

// ── Test Suite ─────────────────────────────────────────────────────────────

describe( 'Invert Flag Node — Update', function () {
    // ════════════════════════════════════════════════════════════════════════
    // Basic Functionality
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Basic functionality', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Invert Flag',
                name: 'invert',
                from: { x: 'active' },
                stats: { inverted: { storeAs: 'wasActive' } }
            };
            state = invertFlag.init( spec );
        } );

        it( 'inverts true to false', function () {
            invertFlag.update( state, createMessage( { active: true } ) );
            expect( state.inverted ).to.equal( false );
        } );

        it( 'inverts false to true', function () {
            invertFlag.update( state, createMessage( { active: false } ) );
            expect( state.inverted ).to.equal( true );
        } );

        it( 'handles sequence of values', function () {
            const testCases = [
                { active: true, expected: false },
                { active: false, expected: true },
                { active: true, expected: false },
                { active: false, expected: true }
            ];

            testCases.forEach( ( tc ) => {
                invertFlag.update( state, createMessage( { active: tc.active } ) );
                expect( state.inverted ).to.equal( tc.expected );
            } );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Truthy/Falsy Coercion
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Truthy/falsy coercion', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Invert Flag',
                name: 'coerce',
                from: { x: 'flag' },
                stats: { inverted: { storeAs: 'out' } }
            };
            state = invertFlag.init( spec );
        } );

        it( 'inverts 1 to false', function () {
            invertFlag.update( state, createMessage( { flag: 1 } ) );
            expect( state.inverted ).to.equal( false );
        } );

        it( 'inverts 0 to true', function () {
            invertFlag.update( state, createMessage( { flag: 0 } ) );
            expect( state.inverted ).to.equal( true );
        } );

        it( 'inverts non-empty string to false', function () {
            invertFlag.update( state, createMessage( { flag: 'yes' } ) );
            expect( state.inverted ).to.equal( false );
        } );

        it( 'inverts empty string to true', function () {
            invertFlag.update( state, createMessage( { flag: '' } ) );
            expect( state.inverted ).to.equal( true );
        } );

        it( 'inverts NaN to true (falsy)', function () {
            invertFlag.update( state, createMessage( { flag: NaN } ) );
            expect( state.inverted ).to.equal( true );
        } );

        it( 'inverts positive number to false', function () {
            invertFlag.update( state, createMessage( { flag: 42 } ) );
            expect( state.inverted ).to.equal( false );
        } );

        it( 'inverts negative number to false', function () {
            invertFlag.update( state, createMessage( { flag: -1 } ) );
            expect( state.inverted ).to.equal( false );
        } );

        it( 'inverts Infinity to false', function () {
            invertFlag.update( state, createMessage( { flag: Infinity } ) );
            expect( state.inverted ).to.equal( false );
        } );

        it( 'inverts object to false', function () {
            invertFlag.update( state, createMessage( { flag: {} } ) );
            expect( state.inverted ).to.equal( false );
        } );

        it( 'inverts array to false', function () {
            invertFlag.update( state, createMessage( { flag: [] } ) );
            expect( state.inverted ).to.equal( false );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Invalid Input Handling
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Invalid input handling', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Invert Flag',
                name: 'validator',
                from: { x: 'flag' },
                stats: { inverted: { storeAs: 'out' } }
            };
            state = invertFlag.init( spec );
        } );

        it( 'sets inputValidationFailed on undefined', function () {
            invertFlag.update( state, createMessage( { flag: undefined } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on null', function () {
            invertFlag.update( state, createMessage( { flag: null } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on missing field', function () {
            invertFlag.update( state, createMessage( {} ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'recovers from invalid input', function () {
            invertFlag.update( state, createMessage( { flag: null } ) );
            expect( state.inputValidationFailed ).to.equal( true );

            invertFlag.update( state, createMessage( { flag: true } ) );
            expect( state.inputValidationFailed ).to.equal( false );
            expect( state.inverted ).to.equal( false );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Edge Cases
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Edge cases', function () {
        it( 'handles rapid toggling', function () {
            const spec = {
                nodeType: 'Invert Flag',
                name: 'rapid',
                from: { x: 'toggle' },
                stats: { inverted: { storeAs: 'out' } }
            };
            const state = invertFlag.init( spec );

            for ( let i = 0; i < 100; i += 1 ) {
                const input = ( i % 2 ) === 0;
                invertFlag.update( state, createMessage( { toggle: input } ) );
                expect( state.inverted ).to.equal( !input );
            }
        } );
    } );
} );

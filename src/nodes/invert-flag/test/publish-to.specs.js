/**
 * Tests for invertFlag node publishTo() — normal publishing, NaN
 * propagation, disabled behavior, and initial-state publishing.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as invertFlag from '../index.js';
import { createMessage } from './test-helpers.js';

// ── Test Suite ─────────────────────────────────────────────────────────────

describe( 'Invert Flag Node — PublishTo', function () {
    // ════════════════════════════════════════════════════════════════════════
    // Normal Publishing
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Normal publishing', function () {
        it( 'publishes inverted value to configured storeAs field', function () {
            const spec = {
                nodeType: 'Invert Flag',
                name: 'pub',
                from: { x: 'active' },
                stats: { inverted: { storeAs: 'wasActive' } }
            };
            const state = invertFlag.init( spec );

            invertFlag.update( state, createMessage( { active: true } ) );

            const output = Object.create( null );
            invertFlag.publishTo( state, output );
            expect( output.wasActive ).to.equal( false );
        } );

        it( 'publishes true when input is false', function () {
            const spec = {
                nodeType: 'Invert Flag',
                name: 'pub2',
                from: { x: 'flag' },
                stats: { inverted: { storeAs: 'notFlag' } }
            };
            const state = invertFlag.init( spec );

            invertFlag.update( state, createMessage( { flag: false } ) );

            const output = Object.create( null );
            invertFlag.publishTo( state, output );
            expect( output.notFlag ).to.equal( true );
        } );

        it( 'publishes initial false without prior update', function () {
            const spec = {
                nodeType: 'Invert Flag',
                name: 'noUpdate',
                from: { x: 'flag' },
                stats: { inverted: { storeAs: 'out' } }
            };
            const state = invertFlag.init( spec );

            const output = Object.create( null );
            invertFlag.publishTo( state, output );
            expect( output.out ).to.equal( false );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // NaN Propagation
    // ════════════════════════════════════════════════════════════════════════

    describe( 'NaN propagation', function () {
        it( 'publishes NaN when inputValidationFailed', function () {
            const spec = {
                nodeType: 'Invert Flag',
                name: 'nanPub',
                from: { x: 'flag' },
                stats: { inverted: { storeAs: 'out' } }
            };
            const state = invertFlag.init( spec );

            invertFlag.update( state, createMessage( { flag: null } ) );

            const output = Object.create( null );
            invertFlag.publishTo( state, output );
            expect( Number.isNaN( output.out ) ).to.equal( true );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Disabled Behavior
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Disabled behavior', function () {
        it( 'does not publish when disabled', function () {
            const spec = {
                nodeType: 'Invert Flag',
                name: 'disabledPub',
                from: { x: 'flag' },
                stats: { inverted: { storeAs: 'out' } }
            };
            const state = invertFlag.init( spec );

            invertFlag.update( state, createMessage( { flag: true } ) );
            state.disable = true;

            const output = Object.create( null );
            invertFlag.publishTo( state, output );
            expect( output.out ).to.equal( undefined );
        } );
    } );
} );

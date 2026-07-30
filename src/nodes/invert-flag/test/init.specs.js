/**
 * Tests for invertFlag node — initialization, spec validation,
 * introspection accessors, and DSL buildSpec.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as invertFlag from '../index.js';
import {
    getDSLMetadata,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities,
    DEFAULT_OPTIONS
} from '../introspect.js';
import { INVERT_SPEC } from './test-helpers.js';

// ── Test Suite ─────────────────────────────────────────────────────────────

describe( 'Invert Flag Node — Init', function () {
    // ════════════════════════════════════════════════════════════════════════
    // Initial State
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Initial state', function () {
        it( 'initializes inverted to false', function () {
            const state = invertFlag.init( INVERT_SPEC );
            expect( state.inverted ).to.equal( false );
        } );

        it( 'initializes disable to false', function () {
            const state = invertFlag.init( INVERT_SPEC );
            expect( state.disable ).to.equal( false );
        } );

        it( 'initializes inputValidationFailed to false', function () {
            const state = invertFlag.init( INVERT_SPEC );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'initializes pause to false', function () {
            const state = invertFlag.init( INVERT_SPEC );
            expect( state.pause ).to.equal( false );
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Spec Validation
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Spec validation', function () {
        it( 'rejects invalid nodeType', function () {
            const badSpec = {
                nodeType: 'INVALID',
                name: 'test',
                from: { x: 'flag' },
                stats: { inverted: { storeAs: 'out' } }
            };
            expect( () => invertFlag.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid name', function () {
            const badSpec = {
                nodeType: 'Invert Flag',
                name: '123-invalid',
                from: { x: 'flag' },
                stats: { inverted: { storeAs: 'out' } }
            };
            expect( () => invertFlag.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing from.x', function () {
            const badSpec = {
                nodeType: 'Invert Flag',
                name: 'test',
                from: {},
                stats: { inverted: { storeAs: 'out' } }
            };
            expect( () => invertFlag.init( badSpec ) ).to.throw();
        } );

        it( 'rejects from.x with spaces', function () {
            const badSpec = {
                nodeType: 'Invert Flag',
                name: 'test',
                from: { x: 'bad field' },
                stats: { inverted: { storeAs: 'out' } }
            };
            expect( () => invertFlag.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing stats', function () {
            const badSpec = {
                nodeType: 'Invert Flag',
                name: 'test',
                from: { x: 'flag' }
            };
            expect( () => invertFlag.init( badSpec ) ).to.throw();
        } );

        it( 'rejects unsupported stat', function () {
            const badSpec = {
                nodeType: 'Invert Flag',
                name: 'test',
                from: { x: 'flag' },
                stats: { delta: { storeAs: 'out' } }
            };
            expect( () => invertFlag.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid storeAs', function () {
            const badSpec = {
                nodeType: 'Invert Flag',
                name: 'test',
                from: { x: 'flag' },
                stats: { inverted: { storeAs: '123-invalid' } }
            };
            expect( () => invertFlag.init( badSpec ) ).to.throw();
        } );

        it( 'accepts valid spec', function () {
            expect( () => invertFlag.init( INVERT_SPEC ) ).to.not.throw();
        } );
    } );

    // ════════════════════════════════════════════════════════════════════════
    // Introspect Accessors
    // ════════════════════════════════════════════════════════════════════════

    describe( 'Introspect accessors', function () {
        it( 'returns expected node type', function () {
            expect( getNodeType() ).to.equal( 'Invert Flag' );
        } );

        it( 'getSupportedStats returns a copy', function () {
            const stats = getSupportedStats();
            expect( stats ).to.be.an( 'array' );
            expect( stats ).to.include( 'inverted' );

            stats.push( 'mutation' );
            const stats2 = getSupportedStats();
            expect( stats2 ).to.not.include( 'mutation' );
        } );

        it( 'getStatDescriptions returns descriptions', function () {
            const desc = getStatDescriptions();
            expect( desc ).to.be.an( 'object' );
            expect( desc ).to.have.property( 'inverted' ).that.is.a( 'string' );
        } );

        it( 'getSupportedControlMethods returns reset/enable/disable', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'reset' );
            expect( methods ).to.have.property( 'enable' );
            expect( methods ).to.have.property( 'disable' );
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

    // ════════════════════════════════════════════════════════════════════════
    // DSL buildSpec
    // ════════════════════════════════════════════════════════════════════════

    describe( 'DSL buildSpec', function () {
        it( 'builds basic spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'invert',
                'active',
                { inverted: { storeAs: 'wasActive' } },
                {}
            );

            expect( spec.nodeType ).to.equal( 'Invert Flag' );
            expect( spec.name ).to.equal( 'invert' );
            expect( spec.from ).to.deep.equal( { x: 'active' } );
            expect( spec.stats.inverted.storeAs ).to.equal( 'wasActive' );
        } );

        it( 'spreads options into spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'test',
                'flag',
                { inverted: { storeAs: 'out' } },
                { customOption: 'value' }
            );

            expect( spec.customOption ).to.equal( 'value' );
        } );
    } );
} );

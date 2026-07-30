/* eslint-disable no-unused-expressions */
/**
 * Comprehensive test suite for the transform node.
 * Tests element-wise pure function application: result = using( x ).
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import * as transform from '../index.js';
import {
    getDSLMetadata,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities,
    DEFAULT_OPTIONS
} from '../introspect.js';
import { square, abs, sqrt, log, log10, reciprocal, negate } from '../helpers.js';

// Helper to create test messages
const createMessage = function ( values ) {
    const msg = Object.create( null );
    Object.keys( values ).forEach( ( key ) => {
        msg[ key ] = values[ key ];
    } );
    return msg;
};

// Standard spec reused across tests
const makeSpec = function ( using ) {
    return {
        nodeType: 'Transform',
        name: 'tx',
        from: { x: 'input' },
        stats: { result: { storeAs: 'output' } },
        using: using || square
    };
};

describe( 'Transform Node', function () {

    // ── 1. init ─────────────────────────────────────────────────

    describe( 'init', function () {
        it( 'accepts valid spec with helper', function () {
            expect( () => transform.init( makeSpec( square ) ) ).to.not.throw();
        } );

        it( 'accepts valid spec with custom function', function () {
            expect( () => transform.init( makeSpec( ( x ) => ( x + 1 ) ) ) ).to.not.throw();
        } );

        it( 'initializes all standard flags', function () {
            const state = transform.init( makeSpec() );
            expect( state.inputValidationFailed ).to.equal( false );
            expect( state.disable ).to.equal( false );
            expect( state.pause ).to.equal( false );
        } );

        it( 'initializes result to 0', function () {
            const state = transform.init( makeSpec() );
            expect( state.result ).to.equal( 0 );
        } );

        it( 'stores using function reference', function () {
            const state = transform.init( makeSpec( abs ) );
            expect( state.using ).to.equal( abs );
        } );

        it( 'stores input field name', function () {
            const state = transform.init( makeSpec() );
            expect( state.x ).to.equal( 'input' );
        } );

        it( 'sets nodeType', function () {
            const state = transform.init( makeSpec() );
            expect( state.nodeType ).to.equal( 'Transform' );
        } );

        it( 'rejects missing using', function () {
            const badSpec = {
                nodeType: 'Transform',
                name: 'tx',
                from: { x: 'input' },
                stats: { result: { storeAs: 'output' } }
            };
            expect( () => transform.init( badSpec ) ).to.throw();
        } );

        it( 'rejects non-function using', function () {
            expect( () => transform.init( makeSpec( 42 ) ) ).to.throw();
        } );

        it( 'rejects using with wrong arity', function () {
            const twoArgs = ( a, b ) => ( a + b );
            expect( () => transform.init( makeSpec( twoArgs ) ) ).to.throw();
        } );

        it( 'rejects missing from.x', function () {
            const badSpec = {
                nodeType: 'Transform',
                name: 'tx',
                from: {},
                stats: { result: { storeAs: 'output' } },
                using: square
            };
            expect( () => transform.init( badSpec ) ).to.throw();
        } );

        it( 'rejects from.x with spaces', function () {
            const badSpec = {
                nodeType: 'Transform',
                name: 'tx',
                from: { x: 'bad field' },
                stats: { result: { storeAs: 'output' } },
                using: square
            };
            expect( () => transform.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing stats', function () {
            const badSpec = {
                nodeType: 'Transform',
                name: 'tx',
                from: { x: 'input' },
                using: square
            };
            expect( () => transform.init( badSpec ) ).to.throw();
        } );

        it( 'rejects unsupported stat name', function () {
            const badSpec = {
                nodeType: 'Transform',
                name: 'tx',
                from: { x: 'input' },
                stats: { delta: { storeAs: 'output' } },
                using: square
            };
            expect( () => transform.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid storeAs', function () {
            const badSpec = {
                nodeType: 'Transform',
                name: 'tx',
                from: { x: 'input' },
                stats: { result: { storeAs: '123-invalid' } },
                using: square
            };
            expect( () => transform.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid nodeType', function () {
            const badSpec = {
                nodeType: 'INVALID',
                name: 'tx',
                from: { x: 'input' },
                stats: { result: { storeAs: 'output' } },
                using: square
            };
            expect( () => transform.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid name', function () {
            const badSpec = {
                nodeType: 'Transform',
                name: '123-invalid',
                from: { x: 'input' },
                stats: { result: { storeAs: 'output' } },
                using: square
            };
            expect( () => transform.init( badSpec ) ).to.throw();
        } );
    } );

    // ── 2. update — basic functionality ─────────────────────────

    describe( 'update — basic functionality', function () {
        it( 'applies square helper', function () {
            const state = transform.init( makeSpec( square ) );
            transform.update( state, createMessage( { input: 5 } ) );
            expect( state.result ).to.equal( 25 );
        } );

        it( 'applies abs helper', function () {
            const state = transform.init( makeSpec( abs ) );
            transform.update( state, createMessage( { input: -7.5 } ) );
            expect( state.result ).to.equal( 7.5 );
        } );

        it( 'applies sqrt helper', function () {
            const state = transform.init( makeSpec( sqrt ) );
            transform.update( state, createMessage( { input: 16 } ) );
            expect( state.result ).to.equal( 4 );
        } );

        it( 'applies log helper', function () {
            const state = transform.init( makeSpec( log ) );
            transform.update( state, createMessage( { input: Math.E } ) );
            expect( state.result ).to.be.closeTo( 1, 1e-12 );
        } );

        it( 'applies log10 helper', function () {
            const state = transform.init( makeSpec( log10 ) );
            transform.update( state, createMessage( { input: 1000 } ) );
            expect( state.result ).to.be.closeTo( 3, 1e-12 );
        } );

        it( 'applies reciprocal helper', function () {
            const state = transform.init( makeSpec( reciprocal ) );
            transform.update( state, createMessage( { input: 4 } ) );
            expect( state.result ).to.equal( 0.25 );
        } );

        it( 'applies negate helper', function () {
            const state = transform.init( makeSpec( negate ) );
            transform.update( state, createMessage( { input: 3.14 } ) );
            expect( state.result ).to.equal( -3.14 );
        } );

        it( 'applies custom inline function', function () {
            const state = transform.init( makeSpec( ( x ) => ( ( x * x ) + 1 ) ) );
            transform.update( state, createMessage( { input: 3 } ) );
            expect( state.result ).to.equal( 10 );
        } );

        it( 'handles multi-message sequence', function () {
            const state = transform.init( makeSpec( square ) );
            const values = [ 1, 2, 3, 4, 5 ];
            const expected = [ 1, 4, 9, 16, 25 ];

            values.forEach( ( v, i ) => {
                transform.update( state, createMessage( { input: v } ) );
                expect( state.result ).to.equal( expected[ i ] );
            } );
        } );

        it( 'handles zero input for all safe helpers', function () {
            const helpers = [ square, abs, negate ];
            const expectedForZero = [ 0, 0, -0 ];

            helpers.forEach( ( fn, i ) => {
                const state = transform.init( makeSpec( fn ) );
                transform.update( state, createMessage( { input: 0 } ) );
                expect( state.result ).to.equal( expectedForZero[ i ] );
            } );
        } );

        it( 'handles negative input for square and abs', function () {
            const state1 = transform.init( makeSpec( square ) );
            transform.update( state1, createMessage( { input: -3 } ) );
            expect( state1.result ).to.equal( 9 );

            const state2 = transform.init( makeSpec( abs ) );
            transform.update( state2, createMessage( { input: -3 } ) );
            expect( state2.result ).to.equal( 3 );
        } );

        it( 'handles very small input', function () {
            const state = transform.init( makeSpec( square ) );
            transform.update( state, createMessage( { input: 0.001 } ) );
            expect( state.result ).to.be.closeTo( 0.000001, 1e-15 );
        } );

        it( 'handles very large input', function () {
            const state = transform.init( makeSpec( square ) );
            transform.update( state, createMessage( { input: 1e6 } ) );
            expect( state.result ).to.equal( 1e12 );
        } );
    } );

    // ── 3. update — input validation ────────────────────────────

    describe( 'update — input validation', function () {
        let state;

        beforeEach( function () {
            state = transform.init( makeSpec( square ) );
        } );

        it( 'flags NaN input', function () {
            transform.update( state, createMessage( { input: NaN } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'flags Infinity input', function () {
            transform.update( state, createMessage( { input: Infinity } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'flags -Infinity input', function () {
            transform.update( state, createMessage( { input: -Infinity } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'flags undefined input (missing field)', function () {
            transform.update( state, createMessage( {} ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'recovers after bad input', function () {
            transform.update( state, createMessage( { input: NaN } ) );
            expect( state.inputValidationFailed ).to.equal( true );

            transform.update( state, createMessage( { input: 4 } ) );
            expect( state.inputValidationFailed ).to.equal( false );
            expect( state.result ).to.equal( 16 );
        } );
    } );

    // ── 4. update — transform-produced NaN ──────────────────────

    describe( 'update — transform-produced NaN (natural flow)', function () {
        it( 'sqrt of negative produces NaN, flag stays false', function () {
            const state = transform.init( makeSpec( sqrt ) );
            transform.update( state, createMessage( { input: -1 } ) );
            expect( Number.isNaN( state.result ) ).to.equal( true );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'reciprocal of zero produces Infinity, flag stays false', function () {
            const state = transform.init( makeSpec( reciprocal ) );
            transform.update( state, createMessage( { input: 0 } ) );
            expect( state.result ).to.equal( Infinity );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'log of zero produces -Infinity, flag stays false', function () {
            const state = transform.init( makeSpec( log ) );
            transform.update( state, createMessage( { input: 0 } ) );
            expect( state.result ).to.equal( -Infinity );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'log of negative produces NaN, flag stays false', function () {
            const state = transform.init( makeSpec( log ) );
            transform.update( state, createMessage( { input: -5 } ) );
            expect( Number.isNaN( state.result ) ).to.equal( true );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'log10 of zero produces -Infinity, flag stays false', function () {
            const state = transform.init( makeSpec( log10 ) );
            transform.update( state, createMessage( { input: 0 } ) );
            expect( state.result ).to.equal( -Infinity );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'log10 of negative produces NaN, flag stays false', function () {
            const state = transform.init( makeSpec( log10 ) );
            transform.update( state, createMessage( { input: -5 } ) );
            expect( Number.isNaN( state.result ) ).to.equal( true );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'NaN result flows through publishTo naturally', function () {
            const state = transform.init( makeSpec( sqrt ) );
            transform.update( state, createMessage( { input: -1 } ) );

            const output = Object.create( null );
            transform.publishTo( state, output );
            expect( Number.isNaN( output.output ) ).to.equal( true );
        } );

        it( 'Infinity result flows through publishTo naturally', function () {
            const state = transform.init( makeSpec( reciprocal ) );
            transform.update( state, createMessage( { input: 0 } ) );

            const output = Object.create( null );
            transform.publishTo( state, output );
            expect( output.output ).to.equal( Infinity );
        } );
    } );

    // ── 5. update — user function throws ────────────────────────

    describe( 'update — user function throws', function () {
        it( 'sets result to NaN on throw, node continues', function () {
            const throwing = function ( x ) { // eslint-disable-line no-unused-vars
                throw new Error( 'boom' );
            };
            const state = transform.init( makeSpec( throwing ) );

            transform.update( state, createMessage( { input: 5 } ) );
            expect( Number.isNaN( state.result ) ).to.equal( true );
            expect( state.inputValidationFailed ).to.equal( false );
        } );

        it( 'publishes NaN after throw', function () {
            const throwing = function ( x ) { // eslint-disable-line no-unused-vars
                throw new Error( 'fail' );
            };
            const state = transform.init( makeSpec( throwing ) );

            transform.update( state, createMessage( { input: 5 } ) );

            const output = Object.create( null );
            transform.publishTo( state, output );
            expect( Number.isNaN( output.output ) ).to.equal( true );
        } );
    } );

    // ── 6. publishTo ────────────────────────────────────────────

    describe( 'publishTo', function () {
        it( 'publishes result to configured storeAs field', function () {
            const state = transform.init( makeSpec( square ) );
            transform.update( state, createMessage( { input: 7 } ) );

            const output = Object.create( null );
            transform.publishTo( state, output );
            expect( output.output ).to.equal( 49 );
        } );

        it( 'publishes NaN when inputValidationFailed', function () {
            const state = transform.init( makeSpec( square ) );
            transform.update( state, createMessage( { input: NaN } ) );

            const output = Object.create( null );
            transform.publishTo( state, output );
            expect( Number.isNaN( output.output ) ).to.equal( true );
        } );

        it( 'does not publish when disabled', function () {
            const state = transform.init( makeSpec( square ) );
            transform.update( state, createMessage( { input: 5 } ) );
            state.disable = true;

            const output = Object.create( null );
            transform.publishTo( state, output );
            expect( output.output ).to.be.undefined;
        } );

        it( 'publishes when paused (last-known value)', function () {
            const state = transform.init( makeSpec( square ) );
            transform.update( state, createMessage( { input: 6 } ) );
            state.pause = true;

            const output = Object.create( null );
            transform.publishTo( state, output );
            expect( output.output ).to.equal( 36 );
        } );
    } );

    // ── 7. Control signals ──────────────────────────────────────

    describe( 'Control signals', function () {
        it( 'skips update when disabled', function () {
            const state = transform.init( makeSpec( square ) );
            transform.update( state, createMessage( { input: 3 } ) );
            expect( state.result ).to.equal( 9 );

            state.disable = true;
            transform.update( state, createMessage( { input: 5 } ) );
            expect( state.result ).to.equal( 9 ); // Unchanged
        } );

        it( 'resumes after enable', function () {
            const state = transform.init( makeSpec( square ) );
            state.disable = true;
            transform.update( state, createMessage( { input: 5 } ) );
            expect( state.result ).to.equal( 0 ); // Never updated

            transform.enable( state );
            expect( state.disable ).to.equal( false );

            transform.update( state, createMessage( { input: 5 } ) );
            expect( state.result ).to.equal( 25 );
        } );

        it( 'disable function sets disable to true', function () {
            const state = transform.init( makeSpec( square ) );
            transform.disable( state );
            expect( state.disable ).to.equal( true );
        } );

        it( 'skips update when paused', function () {
            const state = transform.init( makeSpec( square ) );
            transform.update( state, createMessage( { input: 3 } ) );
            expect( state.result ).to.equal( 9 );

            state.pause = true;
            transform.update( state, createMessage( { input: 5 } ) );
            expect( state.result ).to.equal( 9 ); // Unchanged
        } );

        it( 'resumes after unpause', function () {
            const state = transform.init( makeSpec( square ) );
            transform.update( state, createMessage( { input: 3 } ) );
            state.pause = true;
            transform.update( state, createMessage( { input: 10 } ) );
            expect( state.result ).to.equal( 9 ); // Unchanged

            transform.unpause( state );
            expect( state.pause ).to.equal( false );

            transform.update( state, createMessage( { input: 10 } ) );
            expect( state.result ).to.equal( 100 );
        } );

        it( 'pause function sets pause to true', function () {
            const state = transform.init( makeSpec( square ) );
            transform.pause( state );
            expect( state.pause ).to.equal( true );
        } );

        it( 'reset returns true', function () {
            const state = transform.init( makeSpec( square ) );
            expect( transform.reset( state ) ).to.equal( true );
        } );

        it( 'reset is idempotent', function () {
            const state = transform.init( makeSpec( square ) );
            expect( transform.reset( state ) ).to.equal( true );
            expect( transform.reset( state ) ).to.equal( true );
        } );

        it( 'recompute returns true', function () {
            const state = transform.init( makeSpec( square ) );
            expect( transform.recompute( state ) ).to.equal( true );
        } );

        it( 'recompute does not corrupt state', function () {
            const state = transform.init( makeSpec( square ) );
            transform.update( state, createMessage( { input: 5 } ) );
            expect( state.result ).to.equal( 25 );

            transform.recompute( state );
            expect( state.result ).to.equal( 25 );
        } );
    } );

    // ── 8. Introspection ────────────────────────────────────────

    describe( 'Introspection', function () {
        it( 'returns expected node type', function () {
            expect( getNodeType() ).to.equal( 'Transform' );
        } );

        it( 'getSupportedStats returns [ result ]', function () {
            const stats = getSupportedStats();
            expect( stats ).to.deep.equal( [ 'result' ] );
        } );

        it( 'getSupportedStats returns defensive copy', function () {
            const stats = getSupportedStats();
            stats.push( 'mutation' );
            expect( getSupportedStats() ).to.not.include( 'mutation' );
        } );

        it( 'getStatDescriptions returns description for result', function () {
            const desc = getStatDescriptions();
            expect( desc ).to.have.property( 'result' ).that.is.a( 'string' );
        } );

        it( 'getStatDescriptions returns defensive copy', function () {
            const desc = getStatDescriptions();
            desc.injected = 'hack';
            expect( getStatDescriptions() ).to.not.have.property( 'injected' );
        } );

        it( 'getSupportedControlMethods includes all 5 standard methods', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'reset' );
            expect( methods ).to.have.property( 'enable' );
            expect( methods ).to.have.property( 'disable' );
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );

        it( 'getCapabilities returns description and features', function () {
            const cap = getCapabilities();
            expect( cap ).to.have.property( 'description' ).that.is.a( 'string' );
            expect( cap ).to.have.property( 'features' ).that.is.an( 'array' );
            expect( cap.features.length ).to.be.greaterThan( 0 );
        } );

        it( 'getCapabilities returns defensive copy', function () {
            const cap = getCapabilities();
            cap.features.push( 'mutation' );
            expect( getCapabilities().features ).to.not.include( 'mutation' );
        } );

        it( 'getDSLMetadata has specSchema and buildSpec', function () {
            const dsl = getDSLMetadata();
            expect( dsl ).to.have.property( 'specSchema' );
            expect( dsl ).to.have.property( 'buildSpec' ).that.is.a( 'function' );
        } );

        it( 'specSchema declares using as required function with arity 1', function () {
            const dsl = getDSLMetadata();
            expect( dsl.specSchema.using ).to.deep.include( {
                type: 'function',
                required: true,
                arity: 1
            } );
        } );

        it( 'DEFAULT_OPTIONS is empty', function () {
            expect( DEFAULT_OPTIONS ).to.be.an( 'object' );
            expect( Object.keys( DEFAULT_OPTIONS ) ).to.have.lengthOf( 0 );
        } );
    } );

    // ── 9. DSL buildSpec ────────────────────────────────────────

    describe( 'DSL buildSpec', function () {
        it( 'builds spec with using in options', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'sq',
                'ecgDeriv',
                { result: { storeAs: 'ecgSquared' } },
                { using: square }
            );

            expect( spec.nodeType ).to.equal( 'Transform' );
            expect( spec.name ).to.equal( 'sq' );
            expect( spec.from ).to.deep.equal( { x: 'ecgDeriv' } );
            expect( spec.stats.result.storeAs ).to.equal( 'ecgSquared' );
            expect( spec.using ).to.equal( square );
        } );

        it( 'spreads additional options into spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'tx',
                'field',
                { result: { storeAs: 'out' } },
                { using: abs, extra: 'value' }
            );

            expect( spec.extra ).to.equal( 'value' );
        } );
    } );

    // ── 10. Edge cases ──────────────────────────────────────────

    describe( 'Edge cases', function () {
        it( 'cold start → warm → reset → warm-again', function () {
            const state = transform.init( makeSpec( square ) );
            expect( state.result ).to.equal( 0 );

            transform.update( state, createMessage( { input: 5 } ) );
            expect( state.result ).to.equal( 25 );

            transform.reset( state );

            transform.update( state, createMessage( { input: 3 } ) );
            expect( state.result ).to.equal( 9 );
        } );

        it( 'publishTo without prior update returns initial result', function () {
            const state = transform.init( makeSpec( square ) );
            const output = Object.create( null );
            transform.publishTo( state, output );
            expect( output.output ).to.equal( 0 );
        } );

        it( 'rapid alternating valid/invalid inputs', function () {
            const state = transform.init( makeSpec( square ) );

            for ( let i = 0; i < 50; i += 1 ) {
                if ( ( i % 2 ) === 0 ) {
                    transform.update( state, createMessage( { input: i } ) );
                    expect( state.inputValidationFailed ).to.equal( false );
                    expect( state.result ).to.equal( i * i );
                } else {
                    transform.update( state, createMessage( { input: NaN } ) );
                    expect( state.inputValidationFailed ).to.equal( true );
                }
            }
        } );

        it( 'x = 0 through sqrt produces 0', function () {
            const state = transform.init( makeSpec( sqrt ) );
            transform.update( state, createMessage( { input: 0 } ) );
            expect( state.result ).to.equal( 0 );
        } );

        it( 'negate of negative produces positive', function () {
            const state = transform.init( makeSpec( negate ) );
            transform.update( state, createMessage( { input: -42 } ) );
            expect( state.result ).to.equal( 42 );
        } );

        it( 'disable then enable is idempotent', function () {
            const state = transform.init( makeSpec( square ) );
            transform.disable( state );
            transform.disable( state );
            expect( state.disable ).to.equal( true );

            transform.enable( state );
            transform.enable( state );
            expect( state.disable ).to.equal( false );
        } );

        it( 'pause then unpause is idempotent', function () {
            const state = transform.init( makeSpec( square ) );
            transform.pause( state );
            transform.pause( state );
            expect( state.pause ).to.equal( true );

            transform.unpause( state );
            transform.unpause( state );
            expect( state.pause ).to.equal( false );
        } );
    } );

    // ── 11. Helper semantics ────────────────────────────────────

    describe( 'Helper semantics', function () {
        const helpers = { square, abs, sqrt, log, log10, reciprocal, negate };

        Object.entries( helpers ).forEach( ( [ name, fn ] ) => {
            it( `${name} has .semantics property`, function () {
                expect( fn ).to.have.property( 'semantics' );
                expect( fn.semantics ).to.have.property( 'type', 'transform' );
                expect( fn.semantics ).to.have.property( 'name', name );
                expect( fn.semantics ).to.have.property( 'formula' ).that.is.a( 'string' );
            } );
        } );

        it( 'each helper has arity of 1', function () {
            Object.values( helpers ).forEach( ( fn ) => {
                expect( fn.length ).to.equal( 1 );
            } );
        } );
    } );
} );

// core/emitter-manager/terminal/test/config-schema.specs.js

/* eslint-disable no-underscore-dangle */

/**
 * @fileoverview Tests for terminal emitter configSchema validation.
 *
 * Tests cover:
 * - Schema exports correctly
 * - Valid configs pass validation
 * - Invalid configs are caught with descriptive errors
 * - Optional fields work correctly
 * - Unknown-key rejection via `_propertyNames`: typos fail
 *   loudly at DSL time instead of being silently ignored. `assetClass` is
 *   deliberately NOT an accepted key — wire-emitters injects it from the
 *   flow's `.assetClass()` after DSL validation; a user-supplied value
 *   would be overwritten, so rejecting it loudly beats silence.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import terminalEmitterAdapter, { configSchema, id } from '../index.js';
import { validateWithSchema } from '../../../utils/validate/index.js';
import { flow } from '../../../../flow/flow.js';

// ============================================================================
// HELPER: Run validation and return result
// ============================================================================

const validate = function ( config ) {
    return validateWithSchema( configSchema, config, 'config' );
};

// ============================================================================
// TESTS
// ============================================================================

describe( 'Terminal Emitter — configSchema Export', function () {

    it( 'exports configSchema object', function () {
        expect( configSchema ).to.be.an( 'object' );
    } );

    it( 'exports id as "terminal"', function () {
        expect( id ).to.equal( 'terminal' );
    } );

    it( 'configSchema has expected fields', function () {
        expect( configSchema ).to.have.property( 'verbose' );
        expect( configSchema ).to.have.property( 'prefix' );
        expect( configSchema ).to.have.property( 'precision' );
    } );

} );

describe( 'Terminal Emitter — Valid Configs', function () {

    it( 'accepts empty config (all optional)', function () {
        const result = validate( {} );

        expect( result.valid ).to.equal( true );
        expect( result.errors ).to.have.lengthOf( 0 );
    } );

    it( 'accepts verbose=true', function () {
        const result = validate( { verbose: true } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts verbose=false', function () {
        const result = validate( { verbose: false } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts prefix string', function () {
        const result = validate( { prefix: '[DEBUG]' } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts empty prefix string', function () {
        const result = validate( { prefix: '' } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts precision=0', function () {
        const result = validate( { precision: 0 } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts precision=4', function () {
        const result = validate( { precision: 4 } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts full valid config', function () {
        const result = validate( {
            verbose: true,
            prefix: '[TEST]',
            precision: 3
        } );

        expect( result.valid ).to.equal( true );
    } );

} );

describe( 'Terminal Emitter — Invalid Configs', function () {

    it( 'rejects verbose as string', function () {
        const result = validate( { verbose: 'true' } );

        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.include( 'verbose' );
    } );

    it( 'rejects verbose as number', function () {
        const result = validate( { verbose: 1 } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'rejects prefix as number', function () {
        const result = validate( { prefix: 123 } );

        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.include( 'prefix' );
    } );

    it( 'rejects precision as string', function () {
        const result = validate( { precision: '2' } );

        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.include( 'precision' );
    } );

    it( 'rejects negative precision', function () {
        const result = validate( { precision: -1 } );

        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.include( 'precision' );
    } );

    it( 'provides descriptive error for negative precision', function () {
        const result = validate( { precision: -1 } );

        expect( result.errors[ 0 ] ).to.include( 'non-negative' );
    } );

} );

describe( 'Terminal Emitter — throwIfInvalid', function () {

    it( 'does not throw for valid config', function () {
        const result = validate( { precision: 2 } );

        expect( () => result.throwIfInvalid( 'terminal' ) ).to.not.throw();
    } );

    it( 'throws TypeError for invalid config', function () {
        const result = validate( { precision: -5 } );

        expect( () => result.throwIfInvalid( 'terminal' ) ).to.throw( TypeError );
    } );

    it( 'includes nodeType in error message', function () {
        const result = validate( { precision: -5 } );

        expect( () => result.throwIfInvalid( 'flow/emitter:terminal' ) )
            .to.throw( /flow\/emitter:terminal/ );
    } );

} );

// ============================================================================
// UNKNOWN-KEY REJECTION
// ============================================================================

describe( 'Terminal Emitter — Unknown-Key Rejection', function () {

    it( '_propertyNames lists exactly the schema field names', function () {
        // Self-consistency: every declared field is an allowed key and
        // vice versa, so the schema cannot drift from its own key list.
        const fieldNames = Object.keys( configSchema )
            .filter( ( key ) => !key.startsWith( '_' ) )
            .sort();
        const allowed = [ ...configSchema._propertyNames ].sort();
        expect( allowed ).to.deep.equal( fieldNames );
    } );

    it( 'flags \'verbos\' (typo) as an unknown property', function () {
        const result = validate( { verbos: true } );

        expect( result.valid ).to.equal( false );
        expect( result.errors.some( ( e ) => e.includes( 'Unknown property \'verbos\'' ) ) ).to.equal( true );
    } );

    it( 'flags \'assetClass\' as an unknown property — it arrives via .assetClass(), never user config', function () {
        const result = validate( { assetClass: { name: 'pump' } } );

        expect( result.valid ).to.equal( false );
        expect( result.errors.some( ( e ) => e.includes( 'Unknown property \'assetClass\'' ) ) ).to.equal( true );
    } );

    it( 'accepts a config using every advertised key', function () {
        const result = validate( { verbose: true, prefix: '[edge]', precision: 3 } );

        expect( result.valid ).to.equal( true );
        expect( result.errors ).to.have.lengthOf( 0 );
    } );

} );

describe( 'Terminal Emitter — DSL-Time Enforcement (flow.emitter hook)', function () {

    it( 'flow.emitter() rejects an unknown config key', function () {
        expect( () => flow( 'terminal-unknown-key-test' ).emitter( terminalEmitterAdapter, { verbos: true } ) )
            .to.throw( /Unknown property 'verbos'/ );
    } );

    it( 'flow.emitter() accepts a valid config', function () {
        const api = flow( 'terminal-valid-config-test' ).emitter( terminalEmitterAdapter, { verbose: true } );

        expect( api ).to.have.property( 'build' );
    } );

} );

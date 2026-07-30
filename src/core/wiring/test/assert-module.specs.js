// core/wiring/test/assert-module.specs.js

/**
 * @fileoverview Tests for the adapter module durability assertion
 * (the ADR-018 module-surface gate).
 *
 * The wiring layer rejects, at wire time, any adapter module that does
 * not export a valid `durabilityClass` — one of the four values the
 * contract defines. A
 * missing export would otherwise leave operators with no answer to
 * "what does a crash cost here", and the gap would only surface when
 * someone asked.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import { assertModuleDurability } from '../assert-module.js';

describe( 'assertModuleDurability (ADR-018)', function () {

    const VALID_CLASSES = [ 'in-memory', 'wal-backed', 'broker-queue', 'best-effort' ];

    it( 'accepts all four contract durability classes', function () {
        for ( const durabilityClass of VALID_CLASSES ) {
            expect(
                () => assertModuleDurability( 'someAdapter', { durabilityClass } ),
                `class: ${durabilityClass}`
            ).to.not.throw();
        }
    } );

    it( 'throws when durabilityClass is missing', function () {
        expect( () => assertModuleDurability( 'someAdapter', {} ) )
            .to.throw( /'someAdapter' module missing valid 'durabilityClass'/ );
    } );

    it( 'throws when durabilityClass is not one of the four contract values', function () {
        expect( () => assertModuleDurability( 'someAdapter', { durabilityClass: 'durable-ish' } ) )
            .to.throw( /'durable-ish'/ );
    } );

    it( 'throws when durabilityClass is a non-string', function () {
        expect( () => assertModuleDurability( 'someAdapter', { durabilityClass: 3 } ) )
            .to.throw( /missing valid 'durabilityClass'/ );
    } );

    it( 'names the adapter and lists the allowed values in the message', function () {
        let thrown;
        try {
            assertModuleDurability( 'badAdapter', {} );
        } catch ( err ) {
            thrown = err;
        }
        expect( thrown ).to.be.an( 'error' );
        expect( thrown.message ).to.include( 'badAdapter' );
        for ( const durabilityClass of VALID_CLASSES ) {
            expect( thrown.message ).to.include( durabilityClass );
        }
    } );

    it( 'thrown error carries err.code = INVALID_ADAPTER', function () {
        let thrown;
        try {
            assertModuleDurability( 'badAdapter', {} );
        } catch ( err ) {
            thrown = err;
        }
        expect( thrown.code ).to.equal( 'INVALID_ADAPTER' );
    } );

} );

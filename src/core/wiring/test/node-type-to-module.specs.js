// core/wiring/test/node-type-to-module.specs.js

/**
 * @fileoverview Comprehensive tests for node-type-to-module.js
 *
 * Tests cover:
 * - Acronym conversion (all uppercase → lowercase)
 * - Multi-word conversion (space separated → camelCase)
 * - Single word passthrough
 * - Whitespace trimming
 * - Edge cases
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import nodeTypeToModule from '../node-type-to-module.js';

describe( 'nodeTypeToModule', function () {

    // ========================================================================
    // ACRONYM CONVERSION
    // ========================================================================

    describe( 'acronym conversion (all uppercase)', function () {

        it( 'converts EWMA to ewma', function () {
            expect( nodeTypeToModule( 'EWMA' ) ).to.equal( 'ewma' );
        } );

        it( 'converts SMA to sma', function () {
            expect( nodeTypeToModule( 'SMA' ) ).to.equal( 'sma' );
        } );

        it( 'converts API to api', function () {
            expect( nodeTypeToModule( 'API' ) ).to.equal( 'api' );
        } );

        it( 'converts HTTP to http', function () {
            expect( nodeTypeToModule( 'HTTP' ) ).to.equal( 'http' );
        } );

    } );

    // ========================================================================
    // MULTI-WORD CONVERSION
    // ========================================================================

    describe( 'multi-word conversion (space separated)', function () {

        it( 'converts Page Hinkley to pageHinkley', function () {
            expect( nodeTypeToModule( 'Page Hinkley' ) ).to.equal( 'pageHinkley' );
        } );

        it( 'converts ES Mean to esMean', function () {
            // First word "ES" is lowercased entirely to "es"
            expect( nodeTypeToModule( 'ES Mean' ) ).to.equal( 'esMean' );
        } );

        it( 'converts Emit If to emitIf', function () {
            expect( nodeTypeToModule( 'Emit If' ) ).to.equal( 'emitIf' );
        } );

        it( 'converts Pass If to passIf', function () {
            expect( nodeTypeToModule( 'Pass If' ) ).to.equal( 'passIf' );
        } );

        it( 'converts three words to camelCase', function () {
            expect( nodeTypeToModule( 'Foo Bar Baz' ) ).to.equal( 'fooBarBaz' );
        } );

        it( 'handles mixed case in subsequent words', function () {
            // Second word "hINKLEY" should remain as-is
            expect( nodeTypeToModule( 'Page hINKLEY' ) ).to.equal( 'pagehINKLEY' );
        } );

    } );

    // ========================================================================
    // SINGLE WORD PASSTHROUGH
    // ========================================================================

    describe( 'single word passthrough', function () {

        it( 'lowercases first character of single PascalCase word', function () {
            expect( nodeTypeToModule( 'Threshold' ) ).to.equal( 'threshold' );
        } );

        it( 'keeps lowercase word unchanged', function () {
            expect( nodeTypeToModule( 'filter' ) ).to.equal( 'filter' );
        } );

        it( 'lowercases first char of Capitalize', function () {
            expect( nodeTypeToModule( 'Controller' ) ).to.equal( 'controller' );
        } );

        it( 'handles mixed case single word', function () {
            // Single word is entirely lowercased (not just first char)
            expect( nodeTypeToModule( 'ThReShOlD' ) ).to.equal( 'threshold' );
        } );

    } );

    // ========================================================================
    // WHITESPACE HANDLING
    // ========================================================================

    describe( 'whitespace handling', function () {

        it( 'trims leading whitespace', function () {
            expect( nodeTypeToModule( '  EWMA' ) ).to.equal( 'ewma' );
        } );

        it( 'trims trailing whitespace', function () {
            expect( nodeTypeToModule( 'EWMA  ' ) ).to.equal( 'ewma' );
        } );

        it( 'trims both leading and trailing whitespace', function () {
            expect( nodeTypeToModule( '  Page Hinkley  ' ) ).to.equal( 'pageHinkley' );
        } );

        it( 'handles tabs in whitespace', function () {
            expect( nodeTypeToModule( '\tEWMA\t' ) ).to.equal( 'ewma' );
        } );

    } );

    // ========================================================================
    // EDGE CASES
    // ========================================================================

    describe( 'edge cases', function () {

        it( 'handles single character uppercase', function () {
            expect( nodeTypeToModule( 'X' ) ).to.equal( 'x' );
        } );

        it( 'handles single character lowercase', function () {
            expect( nodeTypeToModule( 'x' ) ).to.equal( 'x' );
        } );

        it( 'handles numbers in name', function () {
            expect( nodeTypeToModule( 'Node123' ) ).to.equal( 'node123' );
        } );

        it( 'handles uppercase with numbers', function () {
            expect( nodeTypeToModule( 'V1' ) ).to.equal( 'v1' );
        } );

    } );

} );

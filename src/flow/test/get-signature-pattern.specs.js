// flow/test/get-signature-pattern.specs.js

/**
 * @fileoverview Unit tests for get-signature-pattern.js
 *
 * Tests signature pattern detection for different node schema types:
 * - Controller nodes (logic-based)
 * - Predicate nodes (passIf, emitIf)
 * - Single input nodes (esMean, threshold)
 * - Dual input nodes (diff)
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { getSignaturePattern } from '../get-signature-pattern.js';
import { SIGNATURE_PATTERNS } from '../consts.js';

describe( 'getSignaturePattern', function () {

    describe( 'controller node (NAME_LOGIC)', function () {

        it( 'returns nameLogic for schema with logic and no from', function () {
            const schema = {
                logic: { type: 'array', required: true }
            };
            expect( getSignaturePattern( schema ) ).to.equal( SIGNATURE_PATTERNS.nameLogic );
        } );

    } );

    describe( 'predicate nodes', function () {

        it( 'returns namePredicateOptions for predicate without stats', function () {
            const schema = {
                predicate: { type: 'function', required: true }
                // no from, no stats
            };
            expect( getSignaturePattern( schema ) ).to.equal( SIGNATURE_PATTERNS.namePredicateOptions );
        } );

        it( 'returns namePredicateOutputsOptions for predicate with required stats', function () {
            const schema = {
                predicate: { type: 'function', required: true },
                stats: { required: true }
            };
            expect( getSignaturePattern( schema ) ).to.equal( SIGNATURE_PATTERNS.namePredicateOutputsOptions );
        } );

        it( 'returns namePredicateOptions for predicate with optional stats', function () {
            const schema = {
                predicate: { type: 'function', required: true },
                stats: { required: false }
            };
            expect( getSignaturePattern( schema ) ).to.equal( SIGNATURE_PATTERNS.namePredicateOptions );
        } );

    } );

    describe( 'single input nodes (x only)', function () {

        it( 'returns nameXOptions for x-only node without stats', function () {
            const schema = {
                from: {
                    properties: {
                        x: { type: 'string', required: true }
                    }
                }
                // no stats defined
            };
            expect( getSignaturePattern( schema ) ).to.equal( SIGNATURE_PATTERNS.nameXOptions );
        } );

        it( 'returns nameXOutputsOptions for x-only node with stats', function () {
            const schema = {
                from: {
                    properties: {
                        x: { type: 'string', required: true }
                    }
                },
                stats: { required: true }
            };
            expect( getSignaturePattern( schema ) ).to.equal( SIGNATURE_PATTERNS.nameXOutputsOptions );
        } );

    } );

    describe( 'dual input nodes (x and y)', function () {

        it( 'returns nameXYOutputsOptions for x and y node', function () {
            const schema = {
                from: {
                    properties: {
                        x: { type: 'string', required: true },
                        y: { type: 'string', required: true }
                    }
                },
                stats: { required: true }
            };
            expect( getSignaturePattern( schema ) ).to.equal( SIGNATURE_PATTERNS.nameXYOutputsOptions );
        } );

    } );

    describe( 'unknown pattern', function () {

        it( 'returns unknown for schema with from but no x property', function () {
            const schema = {
                from: {
                    properties: {
                        z: { type: 'string', required: true }
                    }
                }
            };
            expect( getSignaturePattern( schema ) ).to.equal( SIGNATURE_PATTERNS.unknown );
        } );

        it( 'returns unknown for schema with no from, logic, or predicate', function () {
            // This shape previously threw a raw TypeError on `props.x`. The guard now
            // returns `unknown` so make-node-method.js surfaces its clear error.
            const schema = {
                nodeType: { type: 'string', required: true },
                name: { type: 'string', required: true },
                stats: { required: true }
            };
            expect( getSignaturePattern( schema ) ).to.equal( SIGNATURE_PATTERNS.unknown );
        } );

    } );

} );

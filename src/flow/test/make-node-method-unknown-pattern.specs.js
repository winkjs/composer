// flow/test/make-node-method-unknown-pattern.specs.js

/**
 * @fileoverview Edge case test for makeNodeMethod unknown signature pattern.
 *
 * This tests the defensive guard in makeNodeMethod that throws when
 * getSignaturePattern returns SIGNATURE_PATTERNS.unknown. This scenario
 * represents a malformed node schema that doesn't match any known pattern.
 *
 * Separated from main tests because:
 * 1. Requires mocking internal module behavior
 * 2. Tests a "should never happen in production" defensive check
 * 3. Exists primarily for coverage completeness
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { makeNodeMethod } from '../make-node-method.js';
import { makeCollisionChecker } from '../../core/utils/flow/index.js';

describe( 'makeNodeMethod — unknown signature pattern (edge case)', function () {

    it( 'throws error when schema yields unknown signature pattern', function () {
        // Minimal mock API for chaining
        const api = Object.create( null );

        // Malformed schema: has `from` but no `x` property
        // This causes getSignaturePattern to return SIGNATURE_PATTERNS.unknown
        const malformedMeta = {
            specSchema: {
                from: {
                    properties: {
                        // Missing `x` property - this triggers unknown pattern
                        z: { type: 'string', required: true }
                    }
                },
                stats: { required: true }
            }
        };

        const flowState = {
            flowDefinition: [],
            importSet: new Set(),
            isNodeNameDuplicate: makeCollisionChecker(),
            isParamNameDuplicate: makeCollisionChecker(),
            config: { namingTemplate: '{x}_{stat}', aliasMap: Object.create( null ) },
            switchState: { active: false },
            markPipelineStarted: () => { /* no-op */ }
        };

        const method = makeNodeMethod( api, 'malformedNode', malformedMeta, flowState );

        // Attempt to call the method - should throw due to unknown pattern
        expect( () => method( 'testInstance', 'inputField', { stat: 'output' } ) )
            .to.throw( /unknown signature pattern/ );
    } );

} );

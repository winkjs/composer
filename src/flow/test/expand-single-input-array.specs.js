// flow/test/expand-single-input-array.specs.js

/**
 * @fileoverview Unit tests for expand-single-input-array.js
 *
 * Tests the array sugar expansion for single-input nodes:
 * - expandXOutputsOptions: nodes with outputs (e.g., sanitize, esMean)
 * - expandXOptions: nodes without outputs (e.g., momentsDigest)
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { expandSingleInputArraySugar } from '../expand-single-input-array.js';
import { SIGNATURE_PATTERNS } from '../consts.js';
import { makeCollisionChecker } from '../../core/utils/flow/index.js';

describe( 'expandSingleInputArraySugar', function () {

    // Mock meta with buildSpec that captures arguments
    const createMockMeta = function () {
        return {
            buildSpec: function ( name, x, statsOrOptions, options ) {
                return { name, x, statsOrOptions, options };
            }
        };
    };

    // Create flowState with the node-name collision checker the expansion needs.
    const createFlowState = function () {
        return {
            isNodeNameDuplicate: makeCollisionChecker()
        };
    };

    describe( 'expandXOutputsOptions (NAME_X_OUTPUTS_OPTIONS pattern)', function () {

        it( 'expands array of inputs into multiple specs', function () {
            const meta = createMockMeta();
            const flowState = createFlowState();
            const nodeArgs = [
                'sanitize',              // baseName
                [ 'temp', 'pressure' ],  // inputs array
                { failureReason: 'bad' }, // outputs
                { ranges: {} }           // options
            ];

            const specs = expandSingleInputArraySugar(
                meta, nodeArgs, flowState, SIGNATURE_PATTERNS.nameXOutputsOptions
            );

            expect( specs ).to.have.length( 2 );
            expect( specs[ 0 ].name ).to.equal( 'sanitize_temp' );
            expect( specs[ 0 ].x ).to.equal( 'temp' );
            expect( specs[ 1 ].name ).to.equal( 'sanitize_pressure' );
            expect( specs[ 1 ].x ).to.equal( 'pressure' );
        } );

        it( 'joins field and label into storeAs (value_smoothed)', function () {
            const meta = createMockMeta();
            const flowState = createFlowState();
            const nodeArgs = [
                'esMean',
                [ 'value' ],
                { mean: 'smoothed' },
                { halfLife: 2 }
            ];

            const specs = expandSingleInputArraySugar(
                meta, nodeArgs, flowState, SIGNATURE_PATTERNS.nameXOutputsOptions
            );

            expect( specs[ 0 ].statsOrOptions.mean.storeAs ).to.equal( 'value_smoothed' );
        } );

        it( 'throws on duplicate input in array', function () {
            const meta = createMockMeta();
            const flowState = createFlowState();
            const nodeArgs = [
                'sanitize',
                [ 'temp', 'temp' ],  // duplicate
                { failureReason: 'bad' },
                { ranges: {} }
            ];

            expect( () => expandSingleInputArraySugar(
                meta, nodeArgs, flowState, SIGNATURE_PATTERNS.nameXOutputsOptions
            ) ).to.throw( 'duplicate input' );
        } );

        it( 'throws on duplicate node name', function () {
            const meta = createMockMeta();
            const flowState = createFlowState();

            // First call to register sanitize_temp
            expandSingleInputArraySugar(
                meta,
                [ 'sanitize', [ 'temp' ], { failureReason: 'bad' }, {} ],
                flowState,
                SIGNATURE_PATTERNS.nameXOutputsOptions
            );

            // Second call with same baseName and input should throw
            expect( () => expandSingleInputArraySugar(
                meta,
                [ 'sanitize', [ 'temp' ], { failureReason: 'bad' }, {} ],
                flowState,
                SIGNATURE_PATTERNS.nameXOutputsOptions
            ) ).to.throw( 'duplicate node' );
        } );

        // A duplicate storeAs across nodes is no longer a per-node warning here; it is
        // caught at build time by the output-collision guard (see the flow-level
        // build()-throws test in flow.specs.js and check-output-collisions.specs.js).

    } );

    describe( 'expandXOptions (NAME_X_OPTIONS pattern)', function () {

        it( 'expands array of inputs into multiple specs', function () {
            const meta = createMockMeta();
            const flowState = createFlowState();
            const nodeArgs = [
                'momentsDigest',
                [ 'value1', 'value2' ],
                { windowSize: 100 }
            ];

            const specs = expandSingleInputArraySugar(
                meta, nodeArgs, flowState, SIGNATURE_PATTERNS.nameXOptions
            );

            expect( specs ).to.have.length( 2 );
            expect( specs[ 0 ].name ).to.equal( 'momentsDigest_value1' );
            expect( specs[ 0 ].x ).to.equal( 'value1' );
            expect( specs[ 1 ].name ).to.equal( 'momentsDigest_value2' );
            expect( specs[ 1 ].x ).to.equal( 'value2' );
        } );

        it( 'throws on duplicate input in array', function () {
            const meta = createMockMeta();
            const flowState = createFlowState();
            const nodeArgs = [
                'momentsDigest',
                [ 'value', 'value' ],  // duplicate
                { windowSize: 100 }
            ];

            expect( () => expandSingleInputArraySugar(
                meta, nodeArgs, flowState, SIGNATURE_PATTERNS.nameXOptions
            ) ).to.throw( 'duplicate input' );
        } );

        it( 'throws on duplicate node name', function () {
            const meta = createMockMeta();
            const flowState = createFlowState();

            // First call
            expandSingleInputArraySugar(
                meta,
                [ 'digest', [ 'temp' ], {} ],
                flowState,
                SIGNATURE_PATTERNS.nameXOptions
            );

            // Second call with same generated name should throw
            expect( () => expandSingleInputArraySugar(
                meta,
                [ 'digest', [ 'temp' ], {} ],
                flowState,
                SIGNATURE_PATTERNS.nameXOptions
            ) ).to.throw( 'duplicate node' );
        } );

    } );

    describe( 'pattern routing', function () {

        it( 'routes to expandXOptions for nameXOptions pattern', function () {
            const meta = createMockMeta();
            const flowState = createFlowState();
            const nodeArgs = [ 'node', [ 'x' ], { opt: 1 } ];

            const specs = expandSingleInputArraySugar(
                meta, nodeArgs, flowState, SIGNATURE_PATTERNS.nameXOptions
            );

            // expandXOptions doesn't process outputs, so statsOrOptions is the options
            expect( specs[ 0 ].statsOrOptions ).to.deep.equal( { opt: 1 } );
        } );

        it( 'routes to expandXOutputsOptions for other patterns', function () {
            const meta = createMockMeta();
            const flowState = createFlowState();
            const nodeArgs = [ 'node', [ 'x' ], { stat: 'store' }, { opt: 1 } ];

            const specs = expandSingleInputArraySugar(
                meta, nodeArgs, flowState, SIGNATURE_PATTERNS.nameXOutputsOptions
            );

            // expandXOutputsOptions processes outputs into stats objects
            expect( specs[ 0 ].statsOrOptions.stat ).to.have.property( 'storeAs' );
        } );

    } );

} );

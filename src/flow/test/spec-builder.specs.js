/* eslint-disable new-cap */
// flow/test/spec-builder.specs.js

/**
 * @fileoverview Unit tests for spec-builder.js
 *
 * Tests the specBuilder factory that creates pattern-specific spec builders
 * for different node signature patterns.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { specBuilder } from '../spec-builder.js';

describe( 'specBuilder', function () {

    // Mock meta with buildSpec that returns its arguments for verification
    const mockMeta = {
        buildSpec: function ( ...args ) {
            return { args };
        }
    };

    describe( 'NAME_PREDICATE_OPTIONS', function () {

        it( 'builds spec for predicate-only node', function () {
            const patterns = specBuilder( mockMeta );
            const predicate = ( msg ) => msg.value > 0;
            const options = { option1: true };

            const result = patterns.NAME_PREDICATE_OPTIONS( [ 'myNode', predicate, options ] );

            expect( result.args ).to.deep.equal( [ 'myNode', predicate, options ] );
        } );

    } );

    describe( 'NAME_PREDICATE_OUTPUTS_OPTIONS', function () {

        it( 'builds spec with stats from outputs', function () {
            const patterns = specBuilder( mockMeta );
            const predicate = ( msg ) => msg.value > 0;
            const outputs = { active: 'is_active', count: 'match_count' };
            const options = { debounce: 100 };

            const result = patterns.NAME_PREDICATE_OUTPUTS_OPTIONS(
                [ 'myNode', predicate, outputs, options ]
            );

            expect( result.args[ 0 ] ).to.equal( 'myNode' );
            expect( result.args[ 1 ] ).to.equal( predicate );
            expect( result.args[ 2 ] ).to.have.property( 'active' );
            expect( result.args[ 2 ].active.storeAs ).to.equal( 'is_active' );
            expect( result.args[ 2 ] ).to.have.property( 'count' );
            expect( result.args[ 2 ].count.storeAs ).to.equal( 'match_count' );
            expect( result.args[ 3 ] ).to.equal( options );
        } );

    } );

    describe( 'NAME_LOGIC', function () {

        it( 'builds spec for controller node', function () {
            const patterns = specBuilder( mockMeta );
            const logic = [ { when: () => true, triggers: [] } ];

            const result = patterns.NAME_LOGIC( [ 'myController', logic ] );

            expect( result.args ).to.deep.equal( [ 'myController', logic ] );
        } );

    } );

    describe( 'NAME_X_OUTPUTS_OPTIONS', function () {

        it( 'builds spec for single-input node with outputs', function () {
            const patterns = specBuilder( mockMeta );
            const outputs = { mean: 'temp_mean', variance: 'temp_var' };
            const options = { halfLife: 2 };

            const result = patterns.NAME_X_OUTPUTS_OPTIONS(
                [ 'myNode', 'temperature', outputs, options ]
            );

            expect( result.args[ 0 ] ).to.equal( 'myNode' );
            expect( result.args[ 1 ] ).to.equal( 'temperature' );
            expect( result.args[ 2 ].mean.storeAs ).to.equal( 'temp_mean' );
            expect( result.args[ 2 ].variance.storeAs ).to.equal( 'temp_var' );
            expect( result.args[ 3 ] ).to.equal( options );
        } );

    } );

    describe( 'NAME_X_Y_OUTPUTS_OPTIONS', function () {

        it( 'builds spec for dual-input node with outputs', function () {
            const patterns = specBuilder( mockMeta );
            const outputs = { diff: 'pressure_diff' };
            const options = {};

            const result = patterns.NAME_X_Y_OUTPUTS_OPTIONS(
                [ 'myNode', 'inlet', 'outlet', outputs, options ]
            );

            expect( result.args[ 0 ] ).to.equal( 'myNode' );
            expect( result.args[ 1 ] ).to.equal( 'inlet' );
            expect( result.args[ 2 ] ).to.equal( 'outlet' );
            expect( result.args[ 3 ].diff.storeAs ).to.equal( 'pressure_diff' );
            expect( result.args[ 4 ] ).to.equal( options );
        } );

    } );

    describe( 'NAME_X_OPTIONS', function () {

        it( 'builds spec for single-input node without outputs', function () {
            const patterns = specBuilder( mockMeta );
            const options = { windowSize: 100 };

            const result = patterns.NAME_X_OPTIONS( [ 'myNode', 'value', options ] );

            expect( result.args ).to.deep.equal( [ 'myNode', 'value', options ] );
        } );

    } );

    describe( 'duplicate storeAs detection', function () {

        it( 'throws on duplicate storeAs within same node', function () {
            const patterns = specBuilder( mockMeta );
            const outputs = { mean: 'same_name', variance: 'same_name' };

            expect( () => patterns.NAME_X_OUTPUTS_OPTIONS(
                [ 'myNode', 'x', outputs, {} ]
            ) ).to.throw( 'duplicate storeAs' );
        } );

        // Duplicates ACROSS nodes on one path are no longer a per-node warning; they are
        // caught at build time by the output-collision guard - see
        // check-output-collisions.specs.js and the flow-level build()-throws test.

    } );

} );

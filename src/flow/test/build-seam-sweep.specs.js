// flow/test/build-seam-sweep.specs.js

/**
 * @fileoverview Build-seam sweep — every node must build through the real flow API.
 *
 * When you add a node to a flow, the flow turns that one call into a running node in a
 * few steps. It works out the call shape, checks the arguments, builds the spec, then
 * runs the node's own init(). The seam is the boundary where the flow passes one node
 * call to the node's own setup code. Those steps live across two files, so a test for
 * any one step can pass while the seam between them is broken: a validation rule that
 * never runs on the real path, or a buildSpec whose argument order does not match the
 * call shape. The single call `flow('t')[node](...args)` runs all of those steps
 * together (make-node-method.js:83-99). So building every node this way tests the whole
 * seam, not each step on its own.
 *
 * The test finds every node from its own metadata and builds each one. It makes the
 * arguments in two parts. The plain structure of a call — a name, the input field(s),
 * one output, and a stand-in predicate with the right number of parameters — is built
 * automatically from the node's metadata. The few options a node truly requires, which
 * cannot be guessed, are written by hand for that node in BUILD_FIXTURES (in
 * node-build-helpers.js).
 *
 * The automatic part never makes up an option value. So a node that requires an option
 * and has no fixture fails to build here, on purpose. That is what keeps the test
 * working for nodes added later: such a node cannot pass unless it has sensible
 * defaults or gets a fixture. No one has to remember to add a separate test for it.
 *
 * A second set of checks at the end builds each fixtured node without its fixture and
 * confirms the build fails. That proves every fixture is genuinely needed, and that the
 * main sweep cannot pass for the wrong reason.
 *
 * This test only checks that each node builds. It does not run messages through a node
 * or check what the node computes; that is a separate test.
 *
 * The fixtures and argument synthesis are shared with the other metadata-driven sweeps,
 * so they live in node-build-helpers.js.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { flow } from '../../composer.js';
import * as nodes from '../../nodes/index.js';
import { getSignaturePattern } from '../get-signature-pattern.js';
import { KNOWN_PATTERNS, BUILD_FIXTURES, buildArgs } from './node-build-helpers.js';

describe( 'build-seam sweep (every DSL node constructs through flow())', function () {

    const discovered = Object.keys( nodes )
        .filter( ( n ) => typeof nodes[ n ]?.getDSLMetadata === 'function' );

    it( 'discovers the node set (floor guard, not vacuous)', function () {
        expect( discovered.length ).to.be.greaterThan( 35 );
    } );

    discovered.forEach( ( node ) => {

        describe( node, function () {

            it( 'resolves to a known signature pattern', function () {
                const schema = nodes[ node ].getDSLMetadata().specSchema;
                expect( () => getSignaturePattern( schema ) ).to.not.throw();
                const pattern = getSignaturePattern( schema );
                expect(
                    KNOWN_PATTERNS.has( pattern ),
                    `${node} resolves to unrecognized pattern ${pattern}`
                ).to.equal( true );
            } );

            it( 'constructs through the flow API', function () {
                expect( () => flow( 't' )[ node ]( ...buildArgs( node ) ) ).to.not.throw();
            } );

        } );

    } );

} );

describe( 'build-seam sweep — fixtures are load-bearing (negative control)', function () {

    // Each pinned fixture should be genuinely required, so building the node without it
    // must fail. This checks two things. First, every fixture is actually needed, not
    // dead weight. Second, the build path still rejects a node missing required options,
    // so the positive sweep above cannot pass for the wrong reason. The flow wraps any
    // build failure with "Failed to process", so that string confirms the throw came
    // from the build seam and not from somewhere unrelated.
    Object.keys( BUILD_FIXTURES ).forEach( ( node ) => {

        it( `${node} fails to build without its fixture`, function () {
            expect( () => flow( 't' )[ node ]( ...buildArgs( node, {} ) ) ).to.throw( /Failed to process/ );
        } );

    } );

} );

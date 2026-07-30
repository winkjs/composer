// nodes/test/registry-consistency.specs.js

/**
 * @fileoverview Registry consistency contract — the two lists of nodes must match.
 *
 * A node is reached two ways, through two separate lists that can fall out of step:
 *   1. the flow builds a fluent `flow().<node>()` method for each export of
 *      `src/nodes/index.js` that has `getDSLMetadata` (flow.js:129-150).
 *   2. `NODE_NAMES` in `src/nodes/node-names.js` is the list of names used to check and
 *      lazily load a node referred to by name (load-node-module.js).
 *
 * A name in one list but not the other means the two disagree. Either the loader
 * accepts a name that has no flow method, or a flow method has a name the loader does
 * not know. This test checks the two lists hold the same names, in both directions, so
 * they cannot disagree without a test failing. Three stale names — apply, conextBaseline,
 * sseEmitter — slipped through before this guard existed.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as nodes from '../index.js';
import { NODE_NAMES } from '../node-names.js';

describe( 'node registry consistency (index.js exports vs NODE_NAMES)', function () {

    // The set of nodes the flow can build: every export that has getDSLMetadata. This is
    // the exact filter flow.js uses to create the fluent methods.
    const dslNodes = Object.keys( nodes )
        .filter( ( n ) => typeof nodes[ n ]?.getDSLMetadata === 'function' );
    const dslSet = new Set( dslNodes );
    const nameSet = new Set( NODE_NAMES );

    it( 'discovers the node set (floor guard, not vacuous)', function () {
        // If discovery silently breaks (e.g. a bad import) both lists look empty and the
        // equality checks below would pass for the wrong reason. This catches that.
        expect( dslNodes.length ).to.be.greaterThan( 35 );
    } );

    it( 'every DSL-buildable node is a registered name', function () {
        const missing = dslNodes.filter( ( n ) => !nameSet.has( n ) );
        expect(
            missing.length,
            `DSL methods with no NODE_NAMES entry: ${missing.join( ', ' ) || '(none)'}`
        ).to.equal( 0 );
    } );

    it( 'every registered name is DSL-buildable', function () {
        const stranded = [ ...NODE_NAMES ].filter( ( n ) => !dslSet.has( n ) );
        expect(
            stranded.length,
            `NODE_NAMES entries with no DSL method (add to index.js or remove the name): ${stranded.join( ', ' ) || '(none)'}`
        ).to.equal( 0 );
    } );

} );

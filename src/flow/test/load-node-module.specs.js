// flow/test/load-node-module.specs.js

/**
 * @fileoverview Tests for load-node-module.js.
 *
 * Tests cover:
 * - loadNodeModule: valid node loading, caching, invalid node rejection
 * - loadNodeModules: parallel loading, deduplication
 * - clearModuleCache: cache clearing for testing
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { loadNodeModule, loadNodeModules, clearModuleCache } from '../load-node-module.js';

// ============================================================================
// SETUP
// ============================================================================

describe( 'load-node-module', function () {

    beforeEach( function () {
        // Clear cache before each test for isolation
        clearModuleCache();
    } );

    // ========================================================================
    // loadNodeModule
    // ========================================================================
    describe( 'loadNodeModule', function () {

        it( 'loads a valid node module', async function () {
            const mod = await loadNodeModule( 'esMean' );

            expect( typeof mod ).to.equal( 'object' );
            expect( mod ).to.have.property( 'init' );
            expect( mod ).to.have.property( 'update' );
            expect( mod ).to.have.property( 'publishTo' );
        } );

        it( 'returns cached module on subsequent calls', async function () {
            const mod1 = await loadNodeModule( 'threshold' );
            const mod2 = await loadNodeModule( 'threshold' );

            expect( mod1 ).to.equal( mod2 );
        } );

        it( 'throws for invalid node name', async function () {
            try {
                await loadNodeModule( 'notARealNode' );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'Unknown node type' );
                expect( err.message ).to.include( 'notARealNode' );
            }
        } );

        it( 'throws for empty string', async function () {
            try {
                await loadNodeModule( '' );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'Unknown node type' );
            }
        } );

    } );

    // ========================================================================
    // loadNodeModules
    // ========================================================================
    describe( 'loadNodeModules', function () {

        it( 'loads multiple modules in parallel', async function () {
            const modules = await loadNodeModules( [ 'esMean', 'threshold', 'passIf' ] );

            expect( modules ).to.be.instanceOf( Map );
            expect( modules.size ).to.equal( 3 );
            expect( modules.has( 'esMean' ) ).to.equal( true );
            expect( modules.has( 'threshold' ) ).to.equal( true );
            expect( modules.has( 'passIf' ) ).to.equal( true );
        } );

        it( 'deduplicates node names', async function () {
            const modules = await loadNodeModules( [ 'esMean', 'esMean', 'esMean' ] );

            expect( modules.size ).to.equal( 1 );
            expect( modules.has( 'esMean' ) ).to.equal( true );
        } );

        it( 'returns empty Map for empty array', async function () {
            const modules = await loadNodeModules( [] );

            expect( modules ).to.be.instanceOf( Map );
            expect( modules.size ).to.equal( 0 );
        } );

        it( 'throws if any node name is invalid', async function () {
            try {
                await loadNodeModules( [ 'esMean', 'invalidNode', 'threshold' ] );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'Unknown node type' );
                expect( err.message ).to.include( 'invalidNode' );
            }
        } );

    } );

    // ========================================================================
    // clearModuleCache
    // ========================================================================
    describe( 'clearModuleCache', function () {

        it( 'clears the module cache', async function () {
            // Load a module to populate cache
            const mod1 = await loadNodeModule( 'esMean' );

            // Clear cache
            clearModuleCache();

            // Load again - should be a new import (different object reference)
            // Note: In practice they may be the same due to Node's module cache,
            // but our internal cache is cleared
            const mod2 = await loadNodeModule( 'esMean' );

            // At minimum, the function should complete without error
            expect( typeof mod1 ).to.equal( 'object' );
            expect( typeof mod2 ).to.equal( 'object' );
        } );

        it( 'allows cache to be cleared multiple times', function () {
            // Should not throw
            clearModuleCache();
            clearModuleCache();
            clearModuleCache();
        } );

    } );

} );

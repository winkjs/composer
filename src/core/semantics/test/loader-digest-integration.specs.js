// src/core/semantics/test/loader-digest-integration.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSemantics } from '../loader.js';

const currentFile = fileURLToPath( import.meta.url );
const currentDir = dirname( currentFile );
const TEST_DATA_PATH = join( currentDir, '../../../../test-data/semantics' );

describe( 'Loader Digest Integration', function () {

    // ========================================================================
    // loadSemantics returns digest
    // ========================================================================

    describe( 'loadSemantics digest output', function () {

        it( 'should return digest property', async function () {
            const configPath = join( TEST_DATA_PATH, 'valid' );
            const result = await loadSemantics( configPath );

            expect( result.digest ).to.be.an( 'object' );
            expect( result.digest.globalHash ).to.be.a( 'string' );
            expect( result.digest.globalHash ).to.have.lengthOf( 64 );
        } );

        it( 'should return digest with enumsHash', async function () {
            const configPath = join( TEST_DATA_PATH, 'valid' );
            const result = await loadSemantics( configPath );

            expect( result.digest.enumsHash ).to.be.a( 'string' );
            expect( result.digest.enumsHash ).to.have.lengthOf( 64 );
        } );

        it( 'should return digest with assetHashes matching loaded asset classes', async function () {
            const configPath = join( TEST_DATA_PATH, 'valid' );
            const result = await loadSemantics( configPath );

            const assetNames = Object.keys( result.assetClasses ).sort();
            const hashNames = Object.keys( result.digest.assetHashes ).sort();

            expect( hashNames ).to.deep.equal( assetNames );

            // Each hash should be 64-char hex
            for ( let i = 0; i < hashNames.length; i += 1 ) {
                const hash = result.digest.assetHashes[ hashNames[ i ] ];
                expect( hash ).to.have.lengthOf( 64 );
            }
        } );

        it( 'should use version from options.version', async function () {
            const configPath = join( TEST_DATA_PATH, 'valid' );
            const result = await loadSemantics( configPath, {
                version: '2.5.0'
            } );

            expect( result.digest.version ).to.equal( '2.5.0' );
        } );

        it( 'should default digest version to 1.0.0', async function () {
            const configPath = join( TEST_DATA_PATH, 'valid' );
            const result = await loadSemantics( configPath );

            expect( result.digest.version ).to.equal( '1.0.0' );
        } );

        it( 'should produce deterministic digest across multiple loads', async function () {
            const configPath = join( TEST_DATA_PATH, 'valid' );
            const result1 = await loadSemantics( configPath );
            const result2 = await loadSemantics( configPath );

            expect( result1.digest.globalHash ).to.equal( result2.digest.globalHash );
            expect( result1.digest.enumsHash ).to.equal( result2.digest.enumsHash );

            const assetNames = Object.keys( result1.digest.assetHashes );
            for ( let i = 0; i < assetNames.length; i += 1 ) {
                const name = assetNames[ i ];
                expect( result1.digest.assetHashes[ name ] )
                    .to.equal( result2.digest.assetHashes[ name ] );
            }
        } );

        it( 'should compute digest only for filtered asset classes', async function () {
            const configPath = join( TEST_DATA_PATH, 'valid' );
            const result = await loadSemantics( configPath, {
                assetClasses: [ 'simplePump' ]
            } );

            const hashNames = Object.keys( result.digest.assetHashes );

            expect( hashNames ).to.have.lengthOf( 1 );
            expect( hashNames ).to.include( 'simplePump' );
        } );

        it( 'should return empty assetHashes for empty directories', async function () {
            const configPath = join( TEST_DATA_PATH, 'invalid/empty-dir' );
            const result = await loadSemantics( configPath );

            expect( result.digest.assetHashes ).to.deep.equal( {} );
        } );

    } );

} );

// create-composer/src/test/scaffold.specs.js

/**
 * @fileoverview Unit tests for the copy-and-stamp step.
 *
 * Covers:
 * - The copy reproduces every template file byte for byte, including
 *   nested directories
 * - The name stamp changes exactly one field; the reserialized file
 *   equals the original with only the name replaced
 * - The stamped package object is returned so the caller can read
 *   the composer pin
 */

import { expect } from 'chai';
import { describe, it, before, after } from 'mocha';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { copyTemplate, rewritePackageName } from '../scaffold.js';
import {
    JSON_INDENT,
    makeScratchDir,
    removeScratchDir,
    writeExampleFixture,
    listFilesRelative
} from './test-helpers.js';

describe( 'copyTemplate and rewritePackageName', function () {

    let scratch;
    let templateDir;

    before( async function () {
        scratch = await makeScratchDir();
        templateDir = await writeExampleFixture( scratch, {
            name: 'fixture-flow',
            pin: '1.2.3',
            extraFiles: { 'nested/deep/file.txt': 'kept\n' }
        } );
    } );

    after( async function () {
        await removeScratchDir( scratch );
    } );

    it( 'copies every file byte for byte', async function () {
        const target = path.join( scratch, 'copied-flow' );
        await copyTemplate( templateDir, target );

        const sourceFiles = await listFilesRelative( templateDir );
        const targetFiles = await listFilesRelative( target );
        expect( targetFiles ).to.deep.equal( sourceFiles );

        const comparisons = await Promise.all( sourceFiles.map( async ( file ) => {
            const sourceBytes = await fs.readFile( path.join( templateDir, file ) );
            const targetBytes = await fs.readFile( path.join( target, file ) );
            return { file, identical: sourceBytes.equals( targetBytes ) };
        } ) );
        comparisons.forEach( ( comparison ) => {
            expect( comparison.identical ).to.equal( true, `differs: ${comparison.file}` );
        } );
    } );

    it( 'stamps only the name field into package.json', async function () {
        const target = path.join( scratch, 'stamped-flow' );
        await copyTemplate( templateDir, target );
        await rewritePackageName( target, 'stamped-flow' );

        const originalText = await fs.readFile( path.join( templateDir, 'package.json' ), 'utf8' );
        const stampedText = await fs.readFile( path.join( target, 'package.json' ), 'utf8' );
        const expected = JSON.parse( originalText );
        expected.name = 'stamped-flow';
        expect( stampedText ).to.equal( `${JSON.stringify( expected, null, JSON_INDENT )}\n` );
    } );

    it( 'returns the stamped package object with its dependencies', async function () {
        const target = path.join( scratch, 'returned-flow' );
        await copyTemplate( templateDir, target );
        const written = await rewritePackageName( target, 'returned-flow' );
        expect( written.name ).to.equal( 'returned-flow' );
        expect( written.dependencies[ '@winkjs/composer' ] ).to.equal( '1.2.3' );
    } );

} );

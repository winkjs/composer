// create-composer/src/test/cli.specs.js

/**
 * @fileoverview End-to-end tests of the real bin in a child process.
 * The child inherits the environment, so c8 merges its coverage.
 * stdin is ignored, so every run exercises the non-interactive
 * paths; the interactive paths are covered in-process by
 * main.specs.js.
 *
 * Covers:
 * - A real scaffold is byte-identical to the bundled template,
 *   package.json's name field excepted
 * - Refusals exit 1 with the documented messages
 * - --help and --version exit 0
 * - An unexpected filesystem crash lands in the bin catch-all
 */

import { expect } from 'chai';
import { describe, it, before, beforeEach, afterEach } from 'mocha';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { buildTemplates } from '../../scripts/build-templates.js';
import {
    JSON_INDENT,
    REAL_EXAMPLES_DIR,
    REAL_TEMPLATES_DIR,
    makeScratchDir,
    removeScratchDir,
    runBin,
    listFilesRelative
} from './test-helpers.js';

describe( 'create-composer bin', function () {

    let cwd;

    before( async function () {
        await buildTemplates( { examplesDir: REAL_EXAMPLES_DIR, templatesDir: REAL_TEMPLATES_DIR } );
    } );

    beforeEach( async function () {
        cwd = await makeScratchDir();
    } );

    afterEach( async function () {
        await removeScratchDir( cwd );
    } );

    it( 'scaffolds byte-identically to the bundled template, name excepted', async function () {
        const result = await runBin( [ 'cli-flow' ], { cwd } );
        expect( result.code ).to.equal( 0 );
        expect( result.stdout ).to.include( 'Scaffolded the hello-flow template into cli-flow/' );
        expect( result.stdout ).to.include( '@winkjs/composer 0.4.1' );

        const templateDir = path.join( REAL_TEMPLATES_DIR, 'hello-flow' );
        const targetDir = path.join( cwd, 'cli-flow' );
        const templateFiles = await listFilesRelative( templateDir );
        const targetFiles = await listFilesRelative( targetDir );
        expect( targetFiles ).to.deep.equal( templateFiles );

        const comparisons = await Promise.all( templateFiles.map( async ( file ) => {
            const templateBytes = await fs.readFile( path.join( templateDir, file ) );
            const targetBytes = await fs.readFile( path.join( targetDir, file ) );
            return { file, identical: templateBytes.equals( targetBytes ) };
        } ) );
        comparisons.forEach( ( comparison ) => {
            if ( comparison.file === 'package.json' ) {
                expect( comparison.identical ).to.equal( false, 'package.json must carry the new name' );
            } else {
                expect( comparison.identical ).to.equal( true, `differs: ${comparison.file}` );
            }
        } );

        const templatePackage = JSON.parse( await fs.readFile( path.join( templateDir, 'package.json' ), 'utf8' ) );
        templatePackage.name = 'cli-flow';
        const targetText = await fs.readFile( path.join( targetDir, 'package.json' ), 'utf8' );
        expect( targetText ).to.equal( `${JSON.stringify( templatePackage, null, JSON_INDENT )}\n` );
    } );

    it( 'refuses a second scaffold into the same directory', async function () {
        expect( ( await runBin( [ 'twice-flow' ], { cwd } ) ).code ).to.equal( 0 );
        const second = await runBin( [ 'twice-flow' ], { cwd } );
        expect( second.code ).to.equal( 1 );
        expect( second.stderr ).to.include( 'not empty' );
    } );

    it( 'refuses a name that breaks npm rules', async function () {
        const result = await runBin( [ 'Bad-Flow' ], { cwd } );
        expect( result.code ).to.equal( 1 );
        expect( result.stderr ).to.include( 'lowercase' );
    } );

    it( 'refuses an unknown template and lists the bundled ones', async function () {
        const result = await runBin( [ 'x-flow', '--template', 'nope' ], { cwd } );
        expect( result.code ).to.equal( 1 );
        expect( result.stderr ).to.include( 'No bundled template is named "nope"' );
    } );

    it( 'requires a directory when stdin is not a terminal', async function () {
        const result = await runBin( [], { cwd } );
        expect( result.code ).to.equal( 1 );
        expect( result.stderr ).to.include( 'No project directory given' );
    } );

    it( 'prints usage for --help', async function () {
        const result = await runBin( [ '--help' ], { cwd } );
        expect( result.code ).to.equal( 0 );
        expect( result.stdout ).to.include( 'Usage:' );
    } );

    it( 'prints the version for --version', async function () {
        const result = await runBin( [ '--version' ], { cwd } );
        expect( result.code ).to.equal( 0 );
        expect( result.stdout.trim() ).to.match( /^\d+\.\d+\.\d+$/ );
    } );

    it( 'turns an unexpected crash into the one-line catch-all', async function () {
        await fs.writeFile( path.join( cwd, 'blocker' ), 'a file, not a directory\n' );
        const result = await runBin( [ path.join( 'blocker', 'inner-flow' ) ], { cwd } );
        expect( result.code ).to.equal( 1 );
        expect( result.stderr ).to.include( 'create-composer failed:' );
    } );

} );

// create-composer/src/test/main.specs.js

/**
 * @fileoverview In-process tests for the orchestrator, run(). Every
 * behavior of the command is driven here through injected streams;
 * the bin subprocess is exercised separately in cli.specs.js.
 *
 * Covers:
 * - The Node version gate refuses before anything touches disk
 * - Argument errors, --help, --version
 * - A broken templates root
 * - Template resolution: named, unknown, single-silent, non-TTY
 *   default, non-TTY fallback to first, TTY picker, picker cancel
 * - Directory resolution: argument, non-TTY refusal, TTY prompt,
 *   prompted default, prompt cancel
 * - Target and name refusals leave the target untouched
 * - Scaffolding into ".", an absolute path without cwd, a missing
 *   pin, and color output on a color TTY
 */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, DEFAULT_DIRECTORY } from '../main.js';
import { buildTemplates } from '../../scripts/build-templates.js';
import {
    NODE_OK,
    REAL_EXAMPLES_DIR,
    REAL_TEMPLATES_DIR,
    makeScratchDir,
    removeScratchDir,
    readRealComposerPin,
    createCaptureStream,
    createScriptedInput,
    writeTemplateFixtureRoot
} from './test-helpers.js';

const OWN_PACKAGE_PATH = fileURLToPath( new URL( '../../package.json', import.meta.url ) );

// Builds the io bag run() expects; overrides drop in per test.
const createIo = function ( overrides = {} ) {
    return {
        input: overrides.input ?? createScriptedInput( [], { isTTY: false } ),
        output: overrides.output ?? createCaptureStream(),
        errorOutput: overrides.errorOutput ?? createCaptureStream(),
        nodeVersion: overrides.nodeVersion ?? NODE_OK,
        cwd: overrides.cwd,
        templatesRoot: overrides.templatesRoot
    };
}; // createIo()

describe( 'run', function () {

    let singleRoot;
    let multiRoot;
    let noHelloRoot;
    let cwd;

    before( async function () {
        singleRoot = await writeTemplateFixtureRoot( [
            { name: 'hello-flow', description: 'Hello.', pin: '1.2.3' }
        ] );
        multiRoot = await writeTemplateFixtureRoot( [
            { name: 'hello-flow', description: 'Hello.', pin: '1.2.3' },
            { name: 'pump-monitor', description: 'Pump.', pin: '1.2.3', extraFiles: { 'docker-compose.yml': 'services: {}\n' } }
        ] );
        noHelloRoot = await writeTemplateFixtureRoot( [
            { name: 'alpha-flow', description: 'Alpha.', pin: '1.2.3' },
            { name: 'beta-flow', description: 'Beta.', pin: '1.2.3' }
        ] );
    } );

    after( async function () {
        await removeScratchDir( singleRoot );
        await removeScratchDir( multiRoot );
        await removeScratchDir( noHelloRoot );
    } );

    beforeEach( async function () {
        cwd = await makeScratchDir();
    } );

    afterEach( async function () {
        await removeScratchDir( cwd );
    } );

    it( 'refuses an old Node before touching the disk', async function () {
        const io = createIo( { nodeVersion: 'v18.0.0', templatesRoot: singleRoot, cwd } );
        const code = await run( [ 'x-flow' ], io );
        expect( code ).to.equal( 1 );
        expect( io.errorOutput.text() ).to.include( 'Node.js 22 or newer' );
        expect( ( await fs.readdir( cwd ) ).length ).to.equal( 0 );
    } );

    it( 'fails argument errors with the separator hint', async function () {
        const io = createIo( { templatesRoot: singleRoot, cwd } );
        expect( await run( [ '--nope' ], io ) ).to.equal( 1 );
        expect( io.errorOutput.text() ).to.include( '--' );
    } );

    it( 'prints its own version for --version', async function () {
        const io = createIo( { templatesRoot: singleRoot, cwd } );
        const expected = JSON.parse( await fs.readFile( OWN_PACKAGE_PATH, 'utf8' ) ).version;
        expect( await run( [ '--version' ], io ) ).to.equal( 0 );
        expect( io.output.text() ).to.equal( `${expected}\n` );
    } );

    it( 'fails a broken templates root with the broken-install message', async function () {
        const io = createIo( { templatesRoot: path.join( singleRoot, 'not-there' ), cwd } );
        expect( await run( [ 'x-flow' ], io ) ).to.equal( 1 );
        expect( io.errorOutput.text() ).to.include( 'templates directory is missing' );
    } );

    it( 'prints usage with the template table for --help', async function () {
        const io = createIo( { templatesRoot: multiRoot, cwd } );
        expect( await run( [ '--help' ], io ) ).to.equal( 0 );
        expect( io.output.text() ).to.include( 'Bundled templates:' );
        expect( io.output.text() ).to.include( 'pump-monitor' );
    } );

    it( 'honours a valid --template name', async function () {
        const io = createIo( { templatesRoot: multiRoot, cwd } );
        expect( await run( [ 'named-flow', '--template', 'pump-monitor' ], io ) ).to.equal( 0 );
        expect( io.output.text() ).to.include( 'pump-monitor template' );
        expect( io.output.text() ).to.include( 'docker compose up -d' );
    } );

    it( 'fails an unknown template, listing what is bundled', async function () {
        const io = createIo( { templatesRoot: multiRoot, cwd } );
        expect( await run( [ 'x-flow', '--template', 'nope' ], io ) ).to.equal( 1 );
        expect( io.errorOutput.text() ).to.include( 'No bundled template is named "nope"' );
        expect( io.errorOutput.text() ).to.include( 'hello-flow, pump-monitor' );
    } );

    it( 'scaffolds the single bundled template silently', async function () {
        const io = createIo( { templatesRoot: singleRoot, cwd } );
        expect( await run( [ 'quiet-flow' ], io ) ).to.equal( 0 );
        expect( io.output.text() ).to.include( 'Scaffolded the hello-flow template into quiet-flow/' );
        const written = JSON.parse( await fs.readFile( path.join( cwd, 'quiet-flow', 'package.json' ), 'utf8' ) );
        expect( written.name ).to.equal( 'quiet-flow' );
        expect( written.private ).to.equal( true );
    } );

    it( 'takes hello-flow off a terminal when several templates exist', async function () {
        const io = createIo( { templatesRoot: multiRoot, cwd } );
        expect( await run( [ 'default-flow' ], io ) ).to.equal( 0 );
        expect( io.output.text() ).to.include( 'hello-flow template' );
    } );

    it( 'falls back to the first template off a terminal when hello-flow is absent', async function () {
        const io = createIo( { templatesRoot: noHelloRoot, cwd } );
        expect( await run( [ 'fallback-flow' ], io ) ).to.equal( 0 );
        expect( io.output.text() ).to.include( 'alpha-flow template' );
    } );

    it( 'runs the picker on a terminal and honours a numeric choice', async function () {
        const io = createIo( {
            templatesRoot: multiRoot,
            cwd,
            input: createScriptedInput( [ '2' ] ),
            output: createCaptureStream( { isTTY: true } )
        } );
        expect( await run( [ 'picked-flow' ], io ) ).to.equal( 0 );
        expect( io.output.text() ).to.include( '1. hello-flow' );
        expect( io.output.text() ).to.include( 'pump-monitor template' );
        expect( io.output.text() ).to.include( 'docker compose up -d' );
    } );

    it( 'cancels cleanly when the picker stream closes', async function () {
        const io = createIo( {
            templatesRoot: multiRoot,
            cwd,
            input: createScriptedInput( [] ),
            output: createCaptureStream( { isTTY: true } )
        } );
        expect( await run( [ 'never-flow' ], io ) ).to.equal( 1 );
        expect( io.errorOutput.text() ).to.include( 'Cancelled. Nothing was changed.' );
        expect( ( await fs.readdir( cwd ) ).length ).to.equal( 0 );
    } );

    it( 'requires a directory argument off a terminal', async function () {
        const io = createIo( { templatesRoot: singleRoot, cwd } );
        expect( await run( [], io ) ).to.equal( 1 );
        expect( io.errorOutput.text() ).to.include( 'No project directory given' );
        expect( io.errorOutput.text() ).to.include( 'Usage:' );
    } );

    it( 'prompts for the directory on a terminal', async function () {
        const io = createIo( {
            templatesRoot: singleRoot,
            cwd,
            input: createScriptedInput( [ 'prompted-flow' ] ),
            output: createCaptureStream( { isTTY: true } )
        } );
        expect( await run( [], io ) ).to.equal( 0 );
        const entries = await fs.readdir( cwd );
        expect( entries ).to.deep.equal( [ 'prompted-flow' ] );
    } );

    it( 'offers my-composer-flow as the prompted default', async function () {
        const io = createIo( {
            templatesRoot: singleRoot,
            cwd,
            input: createScriptedInput( [ '' ] ),
            output: createCaptureStream( { isTTY: true } )
        } );
        expect( await run( [], io ) ).to.equal( 0 );
        expect( io.output.text() ).to.include( `Project directory (${DEFAULT_DIRECTORY}): ` );
        const entries = await fs.readdir( cwd );
        expect( entries ).to.deep.equal( [ DEFAULT_DIRECTORY ] );
    } );

    it( 'cancels cleanly when the directory prompt closes', async function () {
        const io = createIo( {
            templatesRoot: singleRoot,
            cwd,
            input: createScriptedInput( [] ),
            output: createCaptureStream( { isTTY: true } )
        } );
        expect( await run( [], io ) ).to.equal( 1 );
        expect( io.errorOutput.text() ).to.include( 'Cancelled' );
    } );

    it( 'refuses a non-empty target and leaves it untouched', async function () {
        await fs.mkdir( path.join( cwd, 'taken-flow' ) );
        await fs.writeFile( path.join( cwd, 'taken-flow', 'keep.txt' ), 'mine\n' );
        const io = createIo( { templatesRoot: singleRoot, cwd } );
        expect( await run( [ 'taken-flow' ], io ) ).to.equal( 1 );
        expect( io.errorOutput.text() ).to.include( 'not empty' );
        expect( await fs.readdir( path.join( cwd, 'taken-flow' ) ) ).to.deep.equal( [ 'keep.txt' ] );
    } );

    it( 'refuses a directory whose basename breaks npm name rules', async function () {
        const io = createIo( { templatesRoot: singleRoot, cwd } );
        expect( await run( [ 'Bad Flow' ], io ) ).to.equal( 1 );
        expect( io.errorOutput.text() ).to.include( 'lowercase' );
        expect( ( await fs.readdir( cwd ) ).length ).to.equal( 0 );
    } );

    it( 'scaffolds into "." using the directory name as the project name', async function () {
        const inPlace = path.join( cwd, 'dot-flow' );
        await fs.mkdir( inPlace );
        const io = createIo( { templatesRoot: singleRoot, cwd: inPlace } );
        expect( await run( [ '.' ], io ) ).to.equal( 0 );
        expect( io.output.text() ).to.include( 'the current directory' );
        const written = JSON.parse( await fs.readFile( path.join( inPlace, 'package.json' ), 'utf8' ) );
        expect( written.name ).to.equal( 'dot-flow' );
    } );

    it( 'resolves an absolute directory without an injected cwd', async function () {
        const target = path.join( cwd, 'absolute-flow' );
        const io = createIo( { templatesRoot: singleRoot } );
        expect( await run( [ target ], io ) ).to.equal( 0 );
        const entries = await fs.readdir( target );
        expect( entries.includes( 'package.json' ) ).to.equal( true );
    } );

    it( 'reports an unknown pin when a template misses the dependency', async function () {
        const bareRoot = await writeTemplateFixtureRoot( [
            { name: 'bare-flow', omitDependencies: true }
        ] );
        const io = createIo( { templatesRoot: bareRoot, cwd } );
        expect( await run( [ 'bare-target' ], io ) ).to.equal( 0 );
        expect( io.output.text() ).to.include( '@winkjs/composer unknown' );
        await removeScratchDir( bareRoot );
    } );

    it( 'paints the success line on a color terminal', async function () {
        const io = createIo( {
            templatesRoot: singleRoot,
            cwd,
            input: createScriptedInput( [ 'tinted-flow' ] ),
            output: createCaptureStream( { isTTY: true, colors: true } )
        } );
        expect( await run( [], io ) ).to.equal( 0 );
        expect( io.output.text() ).to.include( '[32m' );
    } );

    it( 'scaffolds from the real bundled templates by default', async function () {
        await buildTemplates( { examplesDir: REAL_EXAMPLES_DIR, templatesDir: REAL_TEMPLATES_DIR } );
        const io = createIo( { cwd } );
        expect( await run( [ 'real-flow' ], io ) ).to.equal( 0 );
        const written = JSON.parse( await fs.readFile( path.join( cwd, 'real-flow', 'package.json' ), 'utf8' ) );
        const expectedPin = await readRealComposerPin();
        expect( expectedPin ).to.match( /^\d+\.\d+\.\d+$/ );
        expect( written.dependencies[ '@winkjs/composer' ] ).to.equal( expectedPin );
    } );

} );

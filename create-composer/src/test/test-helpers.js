// create-composer/src/test/test-helpers.js

/**
 * @fileoverview Shared fixtures for the scaffolder specs: scratch
 * directories under the OS temp root, capture and scripted streams
 * that stand in for a terminal, doctored example fixtures for the
 * template-build guards, and runners that execute the real bin and
 * build script in child processes. The children inherit the
 * environment, so c8's NODE_V8_COVERAGE reaches them and subprocess
 * lines count toward the coverage gate. Scripted inputs support at
 * most one prompt per run: readline drains the buffered stream, so
 * a second interface on the same stream would see it already ended.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = fileURLToPath( new URL( '../..', import.meta.url ) );
const BIN_PATH = path.join( PACKAGE_ROOT, 'bin', 'create-composer.js' );
const BUILD_SCRIPT_PATH = path.join( PACKAGE_ROOT, 'scripts', 'build-templates.js' );
const REAL_EXAMPLES_DIR = path.join( PACKAGE_ROOT, '..', 'examples' );
const REAL_TEMPLATES_DIR = path.join( PACKAGE_ROOT, 'templates' );
const NODE_OK = 'v22.0.0';
const JSON_INDENT = 4;

const makeScratchDir = function () {
    return fs.mkdtemp( path.join( os.tmpdir(), 'create-composer-spec-' ) );
}; // makeScratchDir()

const removeScratchDir = function ( dir ) {
    return fs.rm( dir, { recursive: true, force: true } );
}; // removeScratchDir()

// The composer pin the real hello-flow example carries. Specs that
// scaffold from the real templates read the expected pin from here,
// so a release bump of the example can never strand a stale literal
// in an assertion.
const readRealComposerPin = async function () {
    const packagePath = path.join( REAL_EXAMPLES_DIR, 'hello-flow', 'package.json' );
    const manifest = JSON.parse( await fs.readFile( packagePath, 'utf8' ) );
    return manifest.dependencies[ '@winkjs/composer' ];
}; // readRealComposerPin()

// A writable that records everything written to it. `isTTY` and
// `colors` shape how the code under test sees the "terminal".
const createCaptureStream = function ( { isTTY = false, colors = false } = {} ) {
    const chunks = [];
    const stream = new Writable( {
        write: function ( chunk, encoding, callback ) {
            chunks.push( chunk.toString() );
            callback();
        }
    } );
    stream.isTTY = isTTY;
    if ( isTTY ) {
        stream.hasColors = () => colors;
    }
    stream.text = () => chunks.join( '' );
    return stream;
}; // createCaptureStream()

// All data is pushed up front, so the stream's read() has no work.
const noRead = function () {
    return undefined;
}; // noRead()

// A readable that plays the given lines and then ends. With no
// lines it ends immediately — the "closed without an answer" case.
const createScriptedInput = function ( lines, { isTTY = true } = {} ) {
    const stream = new Readable( { read: noRead } );
    stream.isTTY = isTTY;
    lines.forEach( ( line ) => stream.push( `${line}\n` ) );
    stream.push( null );
    return stream;
}; // createScriptedInput()

// Writes one example/template fixture directory. The defaults pass
// every template-build guard; each spec overrides one field to make
// exactly one guard trip.
const writeExampleFixture = async function ( parentDir, spec ) {
    const dir = path.join( parentDir, spec.name );
    await fs.mkdir( path.join( dir, 'data' ), { recursive: true } );

    const packageObject = {
        name: spec.name,
        version: '0.1.0',
        private: spec.privateFlag ?? true,
        description: spec.description ?? `The ${spec.name} fixture flow.`,
        composer: spec.composer ?? { category: 'getting-started', featured: spec.featured ?? false },
        type: 'module',
        scripts: { start: 'node flow.js' },
        dependencies: { '@winkjs/composer': spec.pin ?? '1.2.3' }
    };
    if ( spec.omitDescription === true ) {
        delete packageObject.description;
    }
    if ( spec.omitComposer === true ) {
        delete packageObject.composer;
    }
    if ( spec.omitDependencies === true ) {
        delete packageObject.dependencies;
    }
    const packageText = spec.packageText ?? `${JSON.stringify( packageObject, null, JSON_INDENT )}\n`;
    await fs.writeFile( path.join( dir, 'package.json' ), packageText );

    const linkVersion = spec.readmeVersion ?? ( spec.pin ?? '1.2.3' );
    const readme = spec.readme ?? [
        `# ${spec.name}`,
        '',
        `Docs: https://github.com/winkjs/composer/tree/${linkVersion}/docs/handbook`,
        ''
    ].join( '\n' );
    await fs.writeFile( path.join( dir, 'README.md' ), readme );
    await fs.writeFile( path.join( dir, 'data', 'feed.csv' ), 'id,x\n1,2\n' );
    await fs.writeFile( path.join( dir, 'flow.js' ), 'console.log( \'flow\' );\n' );

    const extraFiles = Object.entries( spec.extraFiles ?? {} );
    await Promise.all( extraFiles.map( async ( [ relative, content ] ) => {
        const filePath = path.join( dir, relative );
        await fs.mkdir( path.dirname( filePath ), { recursive: true } );
        await fs.writeFile( filePath, content );
    } ) );
    return dir;
}; // writeExampleFixture()

// Writes an examples-root README carrying the category allowlist in
// the exact shape the template-build guard parses: backticked slug
// bullets under a "## Categories" heading.
const writeCategoriesReadme = async function ( rootDir, slugs = [ 'getting-started' ] ) {
    const bullets = slugs.map( ( slug ) => `- \`${slug}\` — fixture category.` ).join( '\n' );
    const text = `# Fixture examples\n\n## Categories\n\n${bullets}\n`;
    await fs.writeFile( path.join( rootDir, 'README.md' ), text );
}; // writeCategoriesReadme()

// Builds a scratch templates root holding the given fixtures, for
// driving listTemplates()/run() without the real bundle.
const writeTemplateFixtureRoot = async function ( specs ) {
    const root = await makeScratchDir();
    await Promise.all( specs.map( ( spec ) => writeExampleFixture( root, spec ) ) );
    return root;
}; // writeTemplateFixtureRoot()

const runProcess = function ( scriptPath, args, options = {} ) {
    return new Promise( ( resolve, reject ) => {
        const child = spawn( process.execPath, [ scriptPath, ...args ], {
            cwd: options.cwd ?? PACKAGE_ROOT,
            stdio: [ 'ignore', 'pipe', 'pipe' ]
        } );
        let stdout = '';
        let stderr = '';
        child.stdout.on( 'data', ( chunk ) => {
            stdout += chunk;
        } );
        child.stderr.on( 'data', ( chunk ) => {
            stderr += chunk;
        } );
        child.on( 'error', reject );
        child.on( 'close', ( code ) => resolve( { code, stdout, stderr } ) );
    } );
}; // runProcess()

// Runs the real bin in a child process; stdin is ignored, so every
// run is non-interactive by construction.
const runBin = function ( args, options ) {
    return runProcess( BIN_PATH, args, options );
}; // runBin()

const runBuildScript = function ( args, options ) {
    return runProcess( BUILD_SCRIPT_PATH, args, options );
}; // runBuildScript()

// Lists every file under dir as sorted relative paths.
const listFilesRelative = async function ( dir, prefix = '' ) {
    const entries = await fs.readdir( dir, { withFileTypes: true } );
    const lists = await Promise.all( entries.map( async ( entry ) => {
        const relative = path.join( prefix, entry.name );
        if ( entry.isDirectory() ) {
            const nested = await listFilesRelative( path.join( dir, entry.name ), relative );
            return nested;
        }
        return [ relative ];
    } ) );
    return lists.flat().sort();
}; // listFilesRelative()

export {
    PACKAGE_ROOT,
    BIN_PATH,
    BUILD_SCRIPT_PATH,
    REAL_EXAMPLES_DIR,
    REAL_TEMPLATES_DIR,
    NODE_OK,
    JSON_INDENT,
    makeScratchDir,
    removeScratchDir,
    readRealComposerPin,
    createCaptureStream,
    createScriptedInput,
    writeExampleFixture,
    writeCategoriesReadme,
    writeTemplateFixtureRoot,
    runBin,
    runBuildScript,
    listFilesRelative
};

/**
 * @fileoverview Builds the creator's templates/ directory from the
 * repository's examples/ at pack time. npm runs this via prepack, so
 * the copy exists only inside the published tarball — git never holds
 * it, and a hand-maintained mirror can never rot. After copying, a
 * guard pass checks each template keeps the contract: private, an
 * exact winkComposer pin, repository doc links pinned to the same
 * version, no lockfile or dependency tree, no ignore files (npm pack
 * silently drops them from tarballs), and a package.json that
 * survives parse-and-reserialize byte-identically (the scaffolder
 * rewrites it that way). Any failed guard fails the pack.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const EXCLUDED_NAMES = new Set( [ 'node_modules', 'package-lock.json' ] );
const BANNED_NAMES = new Set( [ '.gitignore', '.npmignore' ] );
const EXACT_PIN = /^\d+\.\d+\.\d+$/;
const REPO_LINK = /github\.com\/winkjs\/composer\/(?:tree|blob)\/([^/]+)/g;
const JSON_INDENT = 4;

const listFilesRecursively = async function ( dir, prefix ) {
    const entries = await fs.readdir( dir, { withFileTypes: true } );
    const lists = await Promise.all( entries.map( async ( entry ) => {
        const relative = path.join( prefix, entry.name );
        if ( entry.isDirectory() ) {
            const nested = await listFilesRecursively( path.join( dir, entry.name ), relative );
            return nested;
        }
        return [ relative ];
    } ) );
    return lists.flat();
}; // listFilesRecursively()

const copyExample = async function ( exampleDir, templateDir ) {
    await fs.cp( exampleDir, templateDir, {
        recursive: true,
        filter: ( source ) => ( EXCLUDED_NAMES.has( path.basename( source ) ) === false )
    } );
}; // copyExample()

const guardTemplate = async function ( templateDir, name, failures ) {
    const files = await listFilesRecursively( templateDir, '' );
    for ( const file of files ) {
        // Check every path segment: a file inside node_modules/ has
        // an innocent basename, but its path still names the tree.
        const segments = file.split( path.sep );
        if ( segments.some( ( segment ) => EXCLUDED_NAMES.has( segment ) ) ) {
            failures.push( `${name}: excluded file survived the copy: ${file}` );
        }
        const base = path.basename( file );
        if ( BANNED_NAMES.has( base ) ) {
            failures.push( `${name}: ${base} is banned in templates — npm pack silently drops it, so a scaffolded copy would differ: ${file}` );
        }
    }

    const packageText = await fs.readFile( path.join( templateDir, 'package.json' ), 'utf8' );
    const parsed = JSON.parse( packageText );
    if ( parsed.private !== true ) {
        failures.push( `${name}: package.json must carry "private": true` );
    }
    const pin = ( parsed.dependencies ?? {} )[ '@winkjs/composer' ] ?? '';
    if ( EXACT_PIN.test( pin ) === false ) {
        failures.push( `${name}: the @winkjs/composer pin must be exact (got "${pin}")` );
    }
    if ( packageText !== `${JSON.stringify( parsed, null, JSON_INDENT )}\n` ) {
        failures.push( `${name}: package.json is not byte-stable under 4-space reserialization — normalize its formatting` );
    }

    const readmeText = await fs.readFile( path.join( templateDir, 'README.md' ), 'utf8' );
    for ( const match of readmeText.matchAll( REPO_LINK ) ) {
        if ( match[ 1 ] !== pin ) {
            failures.push( `${name}: README repository link is pinned to "${match[ 1 ]}", the composer pin is "${pin}"` );
        }
    }
}; // guardTemplate()

/**
 * Rebuilds templatesDir from examplesDir and runs the guards.
 *
 * @param {object} spec - Directories to build from and into.
 * @param {string} spec.examplesDir - The repository examples/ path.
 * @param {string} spec.templatesDir - The templates/ path to rebuild.
 * @returns {Promise<string[]>} The template names built.
 * @throws {Error} When no templates exist or any guard fails; the
 * message lists every failure.
 */
const buildTemplates = async function ( { examplesDir, templatesDir } ) {
    await fs.rm( templatesDir, { recursive: true, force: true } );
    await fs.mkdir( templatesDir, { recursive: true } );

    const entries = await fs.readdir( examplesDir, { withFileTypes: true } );
    const names = entries
        .filter( ( entry ) => entry.isDirectory() )
        .map( ( entry ) => entry.name )
        .sort();
    if ( names.length === 0 ) {
        throw new Error( `No example directories found under ${examplesDir} — nothing to bundle.` );
    }

    const failures = [];
    await Promise.all( names.map( async ( name ) => {
        const templateDir = path.join( templatesDir, name );
        await copyExample( path.join( examplesDir, name ), templateDir );
        await guardTemplate( templateDir, name, failures );
    } ) );
    if ( failures.length > 0 ) {
        failures.sort();
        throw new Error( `Template guards failed:\n- ${failures.join( '\n- ' )}` );
    }
    return names;
}; // buildTemplates()

const isMainModule = ( process.argv[ 1 ] !== undefined ) &&
    ( import.meta.url === pathToFileURL( process.argv[ 1 ] ).href );

// Run directly (npm prepack does), the script builds from the repo
// examples into the package templates. The two optional arguments
// override the directories; the specs use them to prove the failure
// path without touching the real examples.
if ( isMainModule ) {
    try {
        const names = await buildTemplates( {
            examplesDir: process.argv[ 2 ] ?? path.join( PACKAGE_ROOT, '..', 'examples' ),
            templatesDir: process.argv[ 3 ] ?? path.join( PACKAGE_ROOT, 'templates' )
        } );
        process.stdout.write( `Templates built: ${names.join( ', ' )}\n` );
    } catch ( error ) {
        process.stderr.write( `${error.message}\n` );
        process.exitCode = 1;
    }
}

// guardTemplate is exported for the specs: its excluded-file check
// defends against a future weakening of the copy filter, so it is
// unreachable through buildTemplates() while the filter holds.
export { buildTemplates, guardTemplate };

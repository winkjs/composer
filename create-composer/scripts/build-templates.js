/**
 * @fileoverview Builds the creator's templates/ directory from the
 * repository's examples/ at pack time. npm runs this via prepack, so
 * the copy exists only inside the published tarball — git never holds
 * it, and a hand-maintained mirror can never rot.
 *
 * Bundling is opt-in: an example is packed only when its package.json
 * declares a "composer" block ({ category, featured }). An example
 * without the block stays a repo example — visible in examples/,
 * absent from the tarball. This keeps heavy demos from riding into
 * every cold `npm create` download.
 *
 * After copying, a guard pass checks each template keeps the
 * contract: private, an exact winkComposer pin, repository doc links
 * pinned to the same version, no lockfile or dependency tree, no
 * ignore files (npm pack silently drops them from tarballs), a
 * package.json that survives parse-and-reserialize byte-identically
 * (the scaffolder rewrites it that way), a composer.category from
 * the allowlist in the examples README, at most nine featured
 * templates (the picker's cap), and size budgets — per template and
 * for the whole tree. Any failed guard fails the pack.
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
const CATEGORY_BULLET = /^- `([a-z0-9-]+)`/;
const FEATURED_CAP = 9;
const TEMPLATE_BUDGET_BYTES = 150 * 1024;
const TREE_BUDGET_BYTES = 2 * 1024 * 1024;

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

// Reads the category allowlist from the examples README: the
// backticked slug bullets under its "## Categories" heading. The
// list lives beside the examples so it grows only by a deliberate
// edit there. Returns null when the README, the heading, or the
// bullets are missing — the caller turns that into a failed build.
const readCategoryAllowlist = async function ( examplesDir ) {
    let text = '';
    try {
        text = await fs.readFile( path.join( examplesDir, 'README.md' ), 'utf8' );
    } catch {
        return null;
    }
    const lines = text.split( '\n' );
    const start = lines.findIndex( ( line ) => line.trim() === '## Categories' );
    if ( start === -1 ) {
        return null;
    }
    const allowed = new Set();
    for ( let i = start + 1; i < lines.length; i += 1 ) {
        if ( lines[ i ].startsWith( '## ' ) ) {
            break;
        }
        const match = CATEGORY_BULLET.exec( lines[ i ] );
        if ( match !== null ) {
            allowed.add( match[ 1 ] );
        }
    }
    return ( allowed.size > 0 ) ? allowed : null;
}; // readCategoryAllowlist()

// Reads an example's manifest for the opt-in decision. A directory
// without a package.json is a repo-only directory, never a template
// candidate, so it reads as not opted in. Malformed JSON fails
// loudly and names the example.
const readExampleManifest = async function ( examplesDir, name ) {
    let text = '';
    try {
        text = await fs.readFile( path.join( examplesDir, name, 'package.json' ), 'utf8' );
    } catch {
        return null;
    }
    try {
        return JSON.parse( text );
    } catch ( error ) {
        throw new Error( `${name}: package.json is not valid JSON — ${error.message}` );
    }
}; // readExampleManifest()

const guardTemplate = async function ( templateDir, name, failures, allowedCategories ) {
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
    const stats = await Promise.all( files.map( ( file ) => fs.stat( path.join( templateDir, file ) ) ) );
    const templateBytes = stats.reduce( ( sum, stat ) => ( sum + stat.size ), 0 );
    if ( templateBytes > TEMPLATE_BUDGET_BYTES ) {
        failures.push( `${name}: template weighs ${templateBytes} bytes, over the ${TEMPLATE_BUDGET_BYTES}-byte budget — a heavy example must not ride into every cold npm create download` );
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

    const block = parsed.composer;
    const blockIsObject = ( typeof block === 'object' ) &&
        ( block !== null ) &&
        ( Array.isArray( block ) === false );
    let featured = false;
    if ( blockIsObject === false ) {
        failures.push( `${name}: the "composer" block must be an object carrying a category (bundling is opt-in)` );
    } else {
        if ( allowedCategories.has( block.category ) === false ) {
            const allowed = [ ...allowedCategories ].join( ', ' );
            failures.push( `${name}: composer.category "${block.category}" is not in the examples README allowlist (${allowed})` );
        }
        if ( ( block.featured !== undefined ) && ( typeof block.featured !== 'boolean' ) ) {
            failures.push( `${name}: composer.featured must be a boolean when present` );
        }
        featured = ( block.featured === true );
    }

    const readmeText = await fs.readFile( path.join( templateDir, 'README.md' ), 'utf8' );
    for ( const match of readmeText.matchAll( REPO_LINK ) ) {
        if ( match[ 1 ] !== pin ) {
            failures.push( `${name}: README repository link is pinned to "${match[ 1 ]}", the composer pin is "${pin}"` );
        }
    }

    return { bytes: templateBytes, featured };
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
    const dirNames = entries
        .filter( ( entry ) => entry.isDirectory() )
        .map( ( entry ) => entry.name )
        .sort();
    if ( dirNames.length === 0 ) {
        throw new Error( `No example directories found under ${examplesDir} — nothing to bundle.` );
    }

    // The opt-in pass: only examples declaring the composer block
    // become templates. The rest stay repo examples by design.
    const manifests = await Promise.all(
        dirNames.map( ( name ) => readExampleManifest( examplesDir, name ) )
    );
    const names = dirNames.filter( ( name, index ) => {
        const manifest = manifests[ index ];
        return ( manifest !== null ) && ( manifest.composer !== undefined );
    } );
    if ( names.length === 0 ) {
        throw new Error( `No example under ${examplesDir} declares the "composer" block — bundling is opt-in, nothing to bundle.` );
    }

    const allowedCategories = await readCategoryAllowlist( examplesDir );
    if ( allowedCategories === null ) {
        throw new Error( `No category allowlist found: ${examplesDir}/README.md must carry a "## Categories" section with backticked slug bullets.` );
    }

    const failures = [];
    const results = await Promise.all( names.map( async ( name ) => {
        const templateDir = path.join( templatesDir, name );
        await copyExample( path.join( examplesDir, name ), templateDir );
        return guardTemplate( templateDir, name, failures, allowedCategories );
    } ) );

    const treeBytes = results.reduce( ( sum, result ) => ( sum + result.bytes ), 0 );
    if ( treeBytes > TREE_BUDGET_BYTES ) {
        failures.push( `templates/ tree weighs ${treeBytes} bytes, over the ${TREE_BUDGET_BYTES}-byte budget — npx downloads the full tarball on a cold cache` );
    }
    const featuredCount = results.filter( ( result ) => result.featured ).length;
    if ( featuredCount > FEATURED_CAP ) {
        failures.push( `featured templates number ${featuredCount} — the picker caps at ${FEATURED_CAP}` );
    }

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

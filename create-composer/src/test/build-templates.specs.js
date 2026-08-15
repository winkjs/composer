// create-composer/src/test/build-templates.specs.js

/**
 * @fileoverview Tests for the pack-time template build and its
 * guards.
 *
 * Covers:
 * - The copy excludes node_modules and package-lock.json
 * - A stale templates directory is wiped before the build
 * - Every guard trips on a doctored fixture: missing private, a
 *   ranged pin, a mispinned README link, a banned ignore file, and
 *   a package.json that is not byte-stable under reserialization
 * - Opt-in bundling: an example without the composer block is
 *   skipped; a directory without a package.json is skipped; no
 *   opted-in example at all fails; malformed JSON fails by name
 * - The composer-block guards: shape, category allowlist (and the
 *   allowlist's own presence in the examples README), featured
 *   boolean, the nine-featured cap
 * - The size budgets: per template and for the whole tree
 * - Failures aggregate across templates, sorted
 * - An empty examples directory fails
 * - The real repository examples pass every guard
 * - The CLI entry: explicit directories, the failure exit code, and
 *   the default directories (the prepack path)
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { buildTemplates, guardTemplate } from '../../scripts/build-templates.js';
import {
    REAL_EXAMPLES_DIR,
    makeScratchDir,
    removeScratchDir,
    writeExampleFixture,
    writeCategoriesReadme,
    runBuildScript,
    listFilesRelative
} from './test-helpers.js';

describe( 'buildTemplates', function () {

    let examplesDir;
    let templatesDir;

    beforeEach( async function () {
        examplesDir = await makeScratchDir();
        templatesDir = await makeScratchDir();
        await writeCategoriesReadme( examplesDir );
    } );

    afterEach( async function () {
        await removeScratchDir( examplesDir );
        await removeScratchDir( templatesDir );
    } );

    const expectFailure = async function ( fragment ) {
        try {
            await buildTemplates( { examplesDir, templatesDir } );
            expect.fail( 'buildTemplates should have thrown' );
        } catch ( error ) {
            expect( error.message ).to.include( 'Template guards failed' );
            expect( error.message ).to.include( fragment );
        }
    }; // expectFailure()

    it( 'excludes node_modules and package-lock.json from the copy', async function () {
        await writeExampleFixture( examplesDir, {
            name: 'clean-flow',
            extraFiles: {
                'package-lock.json': '{}\n',
                'node_modules/dep/index.js': 'x\n'
            }
        } );
        const names = await buildTemplates( { examplesDir, templatesDir } );
        expect( names ).to.deep.equal( [ 'clean-flow' ] );
        const files = await listFilesRelative( path.join( templatesDir, 'clean-flow' ) );
        expect( files.some( ( file ) => file.includes( 'node_modules' ) ) ).to.equal( false );
        expect( files.includes( 'package-lock.json' ) ).to.equal( false );
    } );

    it( 'wipes a stale templates directory before building', async function () {
        await writeExampleFixture( examplesDir, { name: 'clean-flow' } );
        await fs.mkdir( path.join( templatesDir, 'stale-flow' ), { recursive: true } );
        await buildTemplates( { examplesDir, templatesDir } );
        const entries = await fs.readdir( templatesDir );
        expect( entries ).to.deep.equal( [ 'clean-flow' ] );
    } );

    it( 'fails a template without private: true', async function () {
        await writeExampleFixture( examplesDir, { name: 'open-flow', privateFlag: false } );
        await expectFailure( '"private": true' );
    } );

    it( 'fails a ranged composer pin', async function () {
        await writeExampleFixture( examplesDir, { name: 'ranged-flow', pin: '^1.2.3', readmeVersion: '1.2.3' } );
        await expectFailure( 'pin must be exact' );
    } );

    it( 'fails a template with no composer dependency at all', async function () {
        await writeExampleFixture( examplesDir, { name: 'unpinned-flow', omitDependencies: true } );
        await expectFailure( 'pin must be exact (got "")' );
    } );

    it( 'fails a README link pinned to another version', async function () {
        await writeExampleFixture( examplesDir, { name: 'stale-link-flow', pin: '1.2.3', readmeVersion: '1.2.2' } );
        await expectFailure( 'pinned to "1.2.2"' );
    } );

    it( 'fails a template carrying an ignore file', async function () {
        await writeExampleFixture( examplesDir, { name: 'ignored-flow', extraFiles: { '.gitignore': 'x\n' } } );
        await expectFailure( 'banned in templates' );
    } );

    it( 'fails a package.json that is not byte-stable', async function () {
        const twoSpace = `${JSON.stringify( {
            name: 'loose-flow',
            private: true,
            composer: { category: 'getting-started' },
            dependencies: { '@winkjs/composer': '1.2.3' }
        }, null, 2 )}\n`;
        await writeExampleFixture( examplesDir, { name: 'loose-flow', packageText: twoSpace } );
        await expectFailure( 'not byte-stable' );
    } );

    it( 'aggregates failures across templates, sorted', async function () {
        await writeExampleFixture( examplesDir, { name: 'z-flow', privateFlag: false } );
        await writeExampleFixture( examplesDir, { name: 'a-flow', pin: '^1.2.3', readmeVersion: '1.2.3' } );
        try {
            await buildTemplates( { examplesDir, templatesDir } );
            expect.fail( 'buildTemplates should have thrown' );
        } catch ( error ) {
            const aAt = error.message.indexOf( 'a-flow' );
            const zAt = error.message.indexOf( 'z-flow' );
            expect( aAt ).to.be.greaterThan( -1 );
            expect( zAt ).to.be.greaterThan( aAt );
        }
    } );

    it( 'guardTemplate itself flags an excluded file that survived a weakened filter', async function () {
        const templateDir = await writeExampleFixture( examplesDir, {
            name: 'leaky-flow',
            extraFiles: { 'node_modules/dep/index.js': 'x\n' }
        } );
        const failures = [];
        await guardTemplate( templateDir, 'leaky-flow', failures, new Set( [ 'getting-started' ] ) );
        expect( failures.some( ( failure ) => failure.includes( 'excluded file survived the copy' ) ) ).to.equal( true );
    } );

    it( 'fails an empty examples directory', async function () {
        try {
            await buildTemplates( { examplesDir, templatesDir } );
            expect.fail( 'buildTemplates should have thrown' );
        } catch ( error ) {
            expect( error.message ).to.include( 'No example directories' );
        }
    } );

    it( 'skips an example without the composer block', async function () {
        await writeExampleFixture( examplesDir, { name: 'bundled-flow' } );
        await writeExampleFixture( examplesDir, { name: 'repo-only-flow', omitComposer: true } );
        const names = await buildTemplates( { examplesDir, templatesDir } );
        expect( names ).to.deep.equal( [ 'bundled-flow' ] );
        const built = await fs.readdir( templatesDir );
        expect( built ).to.deep.equal( [ 'bundled-flow' ] );
    } );

    it( 'skips a directory without a package.json', async function () {
        await writeExampleFixture( examplesDir, { name: 'bundled-flow' } );
        await fs.mkdir( path.join( examplesDir, 'data-sets' ), { recursive: true } );
        const names = await buildTemplates( { examplesDir, templatesDir } );
        expect( names ).to.deep.equal( [ 'bundled-flow' ] );
    } );

    it( 'fails when no example opts in', async function () {
        await writeExampleFixture( examplesDir, { name: 'repo-only-flow', omitComposer: true } );
        try {
            await buildTemplates( { examplesDir, templatesDir } );
            expect.fail( 'buildTemplates should have thrown' );
        } catch ( error ) {
            expect( error.message ).to.include( 'bundling is opt-in, nothing to bundle' );
        }
    } );

    it( 'names an example whose package.json is not valid JSON', async function () {
        await writeExampleFixture( examplesDir, { name: 'broken-flow', packageText: '{ not json\n' } );
        try {
            await buildTemplates( { examplesDir, templatesDir } );
            expect.fail( 'buildTemplates should have thrown' );
        } catch ( error ) {
            expect( error.message ).to.include( 'broken-flow: package.json is not valid JSON' );
        }
    } );

    it( 'fails a category outside the allowlist', async function () {
        await writeExampleFixture( examplesDir, {
            name: 'stray-flow',
            composer: { category: 'unlisted', featured: false }
        } );
        await expectFailure( 'not in the examples README allowlist' );
    } );

    it( 'accepts a block that omits featured (it defaults to false)', async function () {
        await writeExampleFixture( examplesDir, {
            name: 'plain-flow',
            composer: { category: 'getting-started' }
        } );
        const names = await buildTemplates( { examplesDir, templatesDir } );
        expect( names ).to.deep.equal( [ 'plain-flow' ] );
    } );

    it( 'fails a non-boolean featured', async function () {
        await writeExampleFixture( examplesDir, {
            name: 'loud-flow',
            composer: { category: 'getting-started', featured: 'yes' }
        } );
        await expectFailure( 'composer.featured must be a boolean' );
    } );

    it( 'fails a composer block that is not an object', async function () {
        await writeExampleFixture( examplesDir, { name: 'string-flow', composer: 'starter' } );
        await expectFailure( 'must be an object carrying a category' );
    } );

    it( 'fails a composer block that is an array', async function () {
        await writeExampleFixture( examplesDir, { name: 'array-flow', composer: [ 'starter' ] } );
        await expectFailure( 'must be an object carrying a category' );
    } );

    it( 'fails a composer block that is null', async function () {
        const nullBlock = `${JSON.stringify( {
            name: 'null-flow',
            private: true,
            composer: null,
            dependencies: { '@winkjs/composer': '1.2.3' }
        }, null, 4 )}\n`;
        await writeExampleFixture( examplesDir, { name: 'null-flow', packageText: nullBlock } );
        await expectFailure( 'must be an object carrying a category' );
    } );

    it( 'fails a missing examples README', async function () {
        await writeExampleFixture( examplesDir, { name: 'clean-flow' } );
        await fs.rm( path.join( examplesDir, 'README.md' ) );
        try {
            await buildTemplates( { examplesDir, templatesDir } );
            expect.fail( 'buildTemplates should have thrown' );
        } catch ( error ) {
            expect( error.message ).to.include( 'No category allowlist found' );
        }
    } );

    it( 'fails an examples README without a Categories section', async function () {
        await writeExampleFixture( examplesDir, { name: 'clean-flow' } );
        await fs.writeFile( path.join( examplesDir, 'README.md' ), '# Examples\n\nProse only.\n' );
        try {
            await buildTemplates( { examplesDir, templatesDir } );
            expect.fail( 'buildTemplates should have thrown' );
        } catch ( error ) {
            expect( error.message ).to.include( 'No category allowlist found' );
        }
    } );

    it( 'fails a Categories section with no slug bullets', async function () {
        await writeExampleFixture( examplesDir, { name: 'clean-flow' } );
        await fs.writeFile( path.join( examplesDir, 'README.md' ),
            '# Examples\n\n## Categories\n\nNone listed yet.\n\n## Next\n' );
        try {
            await buildTemplates( { examplesDir, templatesDir } );
            expect.fail( 'buildTemplates should have thrown' );
        } catch ( error ) {
            expect( error.message ).to.include( 'No category allowlist found' );
        }
    } );

    it( 'fails past nine featured templates', async function () {
        const writes = [];
        for ( let i = 0; i < 10; i += 1 ) {
            writes.push( writeExampleFixture( examplesDir, {
                name: `featured-flow-${i}`,
                composer: { category: 'getting-started', featured: true }
            } ) );
        }
        await Promise.all( writes );
        await expectFailure( 'the picker caps at 9' );
    } );

    it( 'fails a template over its 150 KB budget', async function () {
        await writeExampleFixture( examplesDir, {
            name: 'heavy-flow',
            extraFiles: { 'data/pad.bin': 'x'.repeat( 160 * 1024 ) }
        } );
        await expectFailure( 'over the 153600-byte budget' );
    } );

    it( 'fails a templates tree over its 2 MB budget', async function () {
        const writes = [];
        for ( let i = 0; i < 15; i += 1 ) {
            writes.push( writeExampleFixture( examplesDir, {
                name: `pad-flow-${i}`,
                extraFiles: { 'data/pad.bin': 'x'.repeat( 140 * 1024 ) }
            } ) );
        }
        await Promise.all( writes );
        await expectFailure( 'over the 2097152-byte budget' );
    } );

    it( 'passes the real repository examples', async function () {
        const names = await buildTemplates( { examplesDir: REAL_EXAMPLES_DIR, templatesDir } );
        expect( names.includes( 'hello-flow' ) ).to.equal( true );
    } );

} );

describe( 'build-templates CLI', function () {

    it( 'builds with explicit directories and reports the names', async function () {
        const examplesDir = await makeScratchDir();
        const templatesDir = await makeScratchDir();
        await writeCategoriesReadme( examplesDir );
        await writeExampleFixture( examplesDir, { name: 'cli-fixture-flow' } );
        const result = await runBuildScript( [ examplesDir, templatesDir ] );
        expect( result.code ).to.equal( 0 );
        expect( result.stdout ).to.include( 'Templates built: cli-fixture-flow' );
        await removeScratchDir( examplesDir );
        await removeScratchDir( templatesDir );
    } );

    it( 'exits non-zero and explains on a failed build', async function () {
        const examplesDir = await makeScratchDir();
        const templatesDir = await makeScratchDir();
        const result = await runBuildScript( [ examplesDir, templatesDir ] );
        expect( result.code ).to.equal( 1 );
        expect( result.stderr ).to.include( 'No example directories' );
        await removeScratchDir( examplesDir );
        await removeScratchDir( templatesDir );
    } );

    it( 'defaults to the repository examples and package templates (the prepack path)', async function () {
        const result = await runBuildScript( [] );
        expect( result.code ).to.equal( 0 );
        expect( result.stdout ).to.include( 'hello-flow' );
    } );

} );

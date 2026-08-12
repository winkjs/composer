// create-composer/src/test/templates.specs.js

/**
 * @fileoverview Unit tests for template discovery and the picker.
 *
 * Covers:
 * - Listing: sorted names, descriptions from each template's own
 *   package.json, a missing description becomes an empty string
 * - Needs inference: a compose file means Docker, otherwise Node.js
 * - A missing or empty templates root throws the broken-install
 *   message
 * - resolveTemplate by name, including the miss
 * - The picker: choice by number, by name, Enter for the default,
 *   an invalid answer re-asks, a closed stream cancels
 */

import { expect } from 'chai';
import { describe, it, before, after } from 'mocha';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { listTemplates, resolveTemplate, pickTemplate } from '../templates.js';
import {
    makeScratchDir,
    removeScratchDir,
    createCaptureStream,
    writeTemplateFixtureRoot
} from './test-helpers.js';

// A fake ask() that answers from a queue; null plays a closed stream.
const createAskQueue = function ( answers ) {
    const queue = [ ...answers ];
    return () => Promise.resolve( queue.shift() ?? null );
}; // createAskQueue()

describe( 'listTemplates', function () {

    let root;

    before( async function () {
        root = await writeTemplateFixtureRoot( [
            { name: 'pump-monitor', description: 'Pump watching.', extraFiles: { 'docker-compose.yml': 'services: {}\n' } },
            { name: 'hello-flow', description: 'Hello flow.' },
            { name: 'bare-flow', omitDescription: true }
        ] );
        await fs.writeFile( path.join( root, 'stray-file.txt' ), 'ignored\n' );
    } );

    after( async function () {
        await removeScratchDir( root );
    } );

    it( 'lists directories sorted by name, ignoring stray files', async function () {
        const templates = await listTemplates( root );
        expect( templates.map( ( template ) => template.name ) ).to.deep.equal(
            [ 'bare-flow', 'hello-flow', 'pump-monitor' ]
        );
    } );

    it( 'reads each description from the template package.json', async function () {
        const templates = await listTemplates( root );
        expect( resolveTemplate( 'hello-flow', templates ).description ).to.equal( 'Hello flow.' );
        expect( resolveTemplate( 'bare-flow', templates ).description ).to.equal( '' );
    } );

    it( 'infers needs from the compose file', async function () {
        const templates = await listTemplates( root );
        expect( resolveTemplate( 'pump-monitor', templates ).needs ).to.equal( 'Docker' );
        expect( resolveTemplate( 'hello-flow', templates ).needs ).to.equal( 'Node.js only' );
    } );

    it( 'throws the broken-install message on a missing root', async function () {
        try {
            await listTemplates( path.join( root, 'not-there' ) );
            expect.fail( 'listTemplates should have thrown' );
        } catch ( error ) {
            expect( error.message ).to.include( 'templates directory is missing' );
        }
    } );

    it( 'throws the broken-install message on an empty root', async function () {
        const empty = await makeScratchDir();
        try {
            await listTemplates( empty );
            expect.fail( 'listTemplates should have thrown' );
        } catch ( error ) {
            expect( error.message ).to.include( 'No templates are bundled' );
        } finally {
            await removeScratchDir( empty );
        }
    } );

} );

describe( 'resolveTemplate', function () {

    const TEMPLATES = [ { name: 'hello-flow' }, { name: 'pump-monitor' } ];

    it( 'finds a template by name', function () {
        expect( resolveTemplate( 'pump-monitor', TEMPLATES ).name ).to.equal( 'pump-monitor' );
    } );

    it( 'returns null for an unknown name', function () {
        expect( resolveTemplate( 'nope', TEMPLATES ) ).to.equal( null );
    } );

} );

describe( 'pickTemplate', function () {

    const TEMPLATES = [
        { name: 'hello-flow', description: 'Hello.', needs: 'Node.js only' },
        { name: 'pump-monitor', description: 'Pump.', needs: 'Docker' }
    ];

    it( 'writes the numbered list before asking', async function () {
        const output = createCaptureStream();
        await pickTemplate( {
            templates: TEMPLATES,
            output,
            ask: createAskQueue( [ '1' ] ),
            defaultName: 'hello-flow'
        } );
        expect( output.text() ).to.include( '1. hello-flow' );
        expect( output.text() ).to.include( '2. pump-monitor' );
    } );

    it( 'picks by number', async function () {
        const picked = await pickTemplate( {
            templates: TEMPLATES,
            output: createCaptureStream(),
            ask: createAskQueue( [ '2' ] ),
            defaultName: 'hello-flow'
        } );
        expect( picked.name ).to.equal( 'pump-monitor' );
    } );

    it( 'picks by name', async function () {
        const picked = await pickTemplate( {
            templates: TEMPLATES,
            output: createCaptureStream(),
            ask: createAskQueue( [ 'pump-monitor' ] ),
            defaultName: 'hello-flow'
        } );
        expect( picked.name ).to.equal( 'pump-monitor' );
    } );

    it( 'takes the default on Enter (the ask returns the default)', async function () {
        const picked = await pickTemplate( {
            templates: TEMPLATES,
            output: createCaptureStream(),
            ask: createAskQueue( [ 'hello-flow' ] ),
            defaultName: 'hello-flow'
        } );
        expect( picked.name ).to.equal( 'hello-flow' );
    } );

    it( 're-asks on an invalid answer, then accepts', async function () {
        const output = createCaptureStream();
        const picked = await pickTemplate( {
            templates: TEMPLATES,
            output,
            ask: createAskQueue( [ '9', '1' ] ),
            defaultName: 'hello-flow'
        } );
        expect( output.text() ).to.include( 'Please answer 1-2' );
        expect( picked.name ).to.equal( 'hello-flow' );
    } );

    it( 'cancels with null when the stream closes', async function () {
        const picked = await pickTemplate( {
            templates: TEMPLATES,
            output: createCaptureStream(),
            ask: createAskQueue( [] ),
            defaultName: 'hello-flow'
        } );
        expect( picked ).to.equal( null );
    } );

} );

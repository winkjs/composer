// create-composer/src/test/validate.specs.js

/**
 * @fileoverview Unit tests for project-name and target-directory
 * validation.
 *
 * Covers:
 * - Valid npm names pass; every rule violation is refused with the
 *   rule spelled out (uppercase, spaces, leading dot or underscore,
 *   empty, too long, non-string)
 * - Target checks: missing path passes, empty directory passes,
 *   non-empty directory refused, existing file refused
 */

import { expect } from 'chai';
import { describe, it, before, after } from 'mocha';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { validateProjectName, checkTargetDirectory } from '../validate.js';
import { makeScratchDir, removeScratchDir } from './test-helpers.js';

describe( 'validateProjectName', function () {

    it( 'accepts well-formed names', function () {
        expect( validateProjectName( 'a' ).ok ).to.equal( true );
        expect( validateProjectName( 'my-flow' ).ok ).to.equal( true );
        expect( validateProjectName( 'flow2.dev_x-y' ).ok ).to.equal( true );
    } );

    it( 'refuses uppercase letters', function () {
        const result = validateProjectName( 'MyFlow' );
        expect( result.ok ).to.equal( false );
        expect( result.message ).to.include( 'lowercase' );
        expect( result.message ).to.include( 'Nothing was changed' );
    } );

    it( 'refuses spaces', function () {
        expect( validateProjectName( 'my flow' ).ok ).to.equal( false );
    } );

    it( 'refuses a leading dot and a leading underscore', function () {
        expect( validateProjectName( '.flow' ).ok ).to.equal( false );
        expect( validateProjectName( '_flow' ).ok ).to.equal( false );
    } );

    it( 'refuses an empty name', function () {
        expect( validateProjectName( '' ).ok ).to.equal( false );
    } );

    it( 'refuses a name longer than 214 characters', function () {
        expect( validateProjectName( 'a'.repeat( 215 ) ).ok ).to.equal( false );
        expect( validateProjectName( 'a'.repeat( 214 ) ).ok ).to.equal( true );
    } );

    it( 'refuses a non-string instead of crashing', function () {
        expect( validateProjectName( undefined ).ok ).to.equal( false );
    } );

} );

describe( 'checkTargetDirectory', function () {

    let scratch;

    before( async function () {
        scratch = await makeScratchDir();
        await fs.mkdir( path.join( scratch, 'empty-dir' ) );
        await fs.mkdir( path.join( scratch, 'full-dir' ) );
        await fs.writeFile( path.join( scratch, 'full-dir', 'keep.txt' ), 'x\n' );
        await fs.writeFile( path.join( scratch, 'a-file' ), 'x\n' );
    } );

    after( async function () {
        await removeScratchDir( scratch );
    } );

    it( 'passes a missing path', async function () {
        const result = await checkTargetDirectory( path.join( scratch, 'not-there' ) );
        expect( result.ok ).to.equal( true );
    } );

    it( 'passes an existing empty directory', async function () {
        const result = await checkTargetDirectory( path.join( scratch, 'empty-dir' ) );
        expect( result.ok ).to.equal( true );
    } );

    it( 'refuses a non-empty directory and names it', async function () {
        const target = path.join( scratch, 'full-dir' );
        const result = await checkTargetDirectory( target );
        expect( result.ok ).to.equal( false );
        expect( result.message ).to.include( target );
        expect( result.message ).to.include( 'not empty' );
        expect( result.message ).to.include( 'Nothing was changed' );
    } );

    it( 'refuses an existing file', async function () {
        const result = await checkTargetDirectory( path.join( scratch, 'a-file' ) );
        expect( result.ok ).to.equal( false );
        expect( result.message ).to.include( 'is a file' );
    } );

} );

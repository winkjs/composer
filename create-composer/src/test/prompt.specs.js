// create-composer/src/test/prompt.specs.js

/**
 * @fileoverview Unit tests for the terminal prompt.
 *
 * Covers:
 * - isInteractive over all four TTY combinations
 * - An answer resolves trimmed
 * - An empty answer resolves to the default
 * - An input that closes without an answer resolves to null, never
 *   hangs (the CI-stall guarantee)
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { isInteractive, askQuestion } from '../prompt.js';
import { createCaptureStream, createScriptedInput } from './test-helpers.js';

describe( 'isInteractive', function () {

    it( 'is true only when both streams are TTYs', function () {
        const tty = createCaptureStream( { isTTY: true } );
        const plain = createCaptureStream( { isTTY: false } );
        expect( isInteractive( createScriptedInput( [], { isTTY: true } ), tty ) ).to.equal( true );
        expect( isInteractive( createScriptedInput( [], { isTTY: true } ), plain ) ).to.equal( false );
        expect( isInteractive( createScriptedInput( [], { isTTY: false } ), tty ) ).to.equal( false );
        expect( isInteractive( createScriptedInput( [], { isTTY: false } ), plain ) ).to.equal( false );
    } );

} );

describe( 'askQuestion', function () {

    it( 'resolves with the trimmed answer', async function () {
        const answer = await askQuestion( {
            input: createScriptedInput( [ '  my-project  ' ] ),
            output: createCaptureStream( { isTTY: true } ),
            question: 'Project directory: ',
            defaultAnswer: 'fallback'
        } );
        expect( answer ).to.equal( 'my-project' );
    } );

    it( 'resolves with the default on an empty answer', async function () {
        const answer = await askQuestion( {
            input: createScriptedInput( [ '' ] ),
            output: createCaptureStream( { isTTY: true } ),
            question: 'Project directory: ',
            defaultAnswer: 'fallback'
        } );
        expect( answer ).to.equal( 'fallback' );
    } );

    it( 'resolves null when the input closes without an answer', async function () {
        const answer = await askQuestion( {
            input: createScriptedInput( [] ),
            output: createCaptureStream( { isTTY: true } ),
            question: 'Project directory: ',
            defaultAnswer: 'fallback'
        } );
        expect( answer ).to.equal( null );
    } );

    it( 'writes the question to the output stream', async function () {
        const output = createCaptureStream( { isTTY: true } );
        await askQuestion( {
            input: createScriptedInput( [ 'x' ] ),
            output,
            question: 'Pick one: ',
            defaultAnswer: 'd'
        } );
        expect( output.text() ).to.include( 'Pick one: ' );
    } );

} );

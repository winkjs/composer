// create-composer/src/test/style.specs.js

/**
 * @fileoverview Unit tests for terminal color painting.
 *
 * Covers:
 * - Plain text on a non-TTY stream
 * - Plain text on a TTY without a hasColors function
 * - Plain text when hasColors() reports false
 * - ANSI-wrapped text when the stream is a color TTY
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { paint } from '../style.js';
import { createCaptureStream } from './test-helpers.js';

const GREEN_PREFIX = '[32m';

describe( 'paint', function () {

    it( 'returns plain text on a non-TTY stream', function () {
        const stream = createCaptureStream( { isTTY: false } );
        expect( paint( stream, 'green', 'done' ) ).to.equal( 'done' );
    } );

    it( 'returns plain text on a TTY without hasColors', function () {
        const stream = createCaptureStream( { isTTY: true } );
        delete stream.hasColors;
        expect( paint( stream, 'green', 'done' ) ).to.equal( 'done' );
    } );

    it( 'returns plain text when hasColors() is false', function () {
        const stream = createCaptureStream( { isTTY: true, colors: false } );
        expect( paint( stream, 'green', 'done' ) ).to.equal( 'done' );
    } );

    it( 'wraps text in ANSI codes on a color TTY', function () {
        const stream = createCaptureStream( { isTTY: true, colors: true } );
        const painted = paint( stream, 'green', 'done' );
        expect( painted ).to.include( GREEN_PREFIX );
        expect( painted ).to.include( 'done' );
    } );

} );

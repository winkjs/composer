// create-composer/src/test/args.specs.js

/**
 * @fileoverview Unit tests for CLI argument parsing and usage text.
 *
 * Covers:
 * - Defaults with no arguments
 * - Directory positional, --template, --help, --version
 * - Unknown flags fail with the "--" separator hint
 * - More than one positional fails
 * - Usage text lists bundled templates, and omits the section when
 *   there are none
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { parseCliArgs, usageText } from '../args.js';

describe( 'parseCliArgs', function () {

    it( 'returns nulls and false flags with no arguments', function () {
        const result = parseCliArgs( [] );
        expect( result.ok ).to.equal( true );
        expect( result.directory ).to.equal( null );
        expect( result.template ).to.equal( null );
        expect( result.help ).to.equal( false );
        expect( result.version ).to.equal( false );
    } );

    it( 'takes the first positional as the directory', function () {
        expect( parseCliArgs( [ 'my-flow' ] ).directory ).to.equal( 'my-flow' );
    } );

    it( 'parses --template', function () {
        const result = parseCliArgs( [ 'my-flow', '--template', 'hello-flow' ] );
        expect( result.ok ).to.equal( true );
        expect( result.template ).to.equal( 'hello-flow' );
        expect( result.directory ).to.equal( 'my-flow' );
    } );

    it( 'parses --help and --version', function () {
        expect( parseCliArgs( [ '--help' ] ).help ).to.equal( true );
        expect( parseCliArgs( [ '--version' ] ).version ).to.equal( true );
    } );

    it( 'fails an unknown flag with the "--" separator hint', function () {
        const result = parseCliArgs( [ '--nope' ] );
        expect( result.ok ).to.equal( false );
        expect( result.message ).to.include( '--' );
        expect( result.message ).to.include( 'npm create @winkjs/composer' );
    } );

    it( 'fails more than one positional', function () {
        const result = parseCliArgs( [ 'one', 'two' ] );
        expect( result.ok ).to.equal( false );
        expect( result.message ).to.include( 'one directory name at most' );
    } );

} );

describe( 'usageText', function () {

    const TEMPLATES = [
        { name: 'hello-flow', description: 'A flow.', needs: 'Node.js only' },
        { name: 'pump-monitor', description: 'A monitored pump.', needs: 'Docker' }
    ];

    it( 'lists every bundled template with its needs', function () {
        const text = usageText( TEMPLATES );
        expect( text ).to.include( 'Bundled templates:' );
        expect( text ).to.include( 'hello-flow' );
        expect( text ).to.include( 'pump-monitor' );
        expect( text ).to.include( '(Docker)' );
        expect( text ).to.include( '(Node.js only)' );
    } );

    it( 'names the "--" separator rule', function () {
        expect( usageText( TEMPLATES ) ).to.include( '"--" separator' );
    } );

    it( 'omits the template section when none are given', function () {
        expect( usageText( [] ) ).to.not.include( 'Bundled templates:' );
    } );

} );

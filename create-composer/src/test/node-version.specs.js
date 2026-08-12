// create-composer/src/test/node-version.specs.js

/**
 * @fileoverview Unit tests for the Node version gate.
 *
 * Covers:
 * - Supported versions (the minimum major and newer) pass
 * - Older majors are refused with an actionable message
 * - A malformed version string is refused, never crashes
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { checkNodeVersion, MINIMUM_MAJOR } from '../node-version.js';

describe( 'checkNodeVersion', function () {

    it( 'accepts the minimum supported major', function () {
        const result = checkNodeVersion( `v${MINIMUM_MAJOR}.0.0` );
        expect( result.ok ).to.equal( true );
        expect( result.message ).to.equal( null );
    } );

    it( 'accepts newer majors', function () {
        expect( checkNodeVersion( 'v24.3.1' ).ok ).to.equal( true );
    } );

    it( 'refuses an older major with an actionable message', function () {
        const result = checkNodeVersion( 'v18.19.0' );
        expect( result.ok ).to.equal( false );
        expect( result.message ).to.include( `Node.js ${MINIMUM_MAJOR} or newer` );
        expect( result.message ).to.include( 'v18.19.0' );
        expect( result.message ).to.include( 'Upgrade Node.js' );
    } );

    it( 'refuses a malformed version string instead of crashing', function () {
        const result = checkNodeVersion( 'weird' );
        expect( result.ok ).to.equal( false );
        expect( result.message ).to.include( 'weird' );
    } );

    it( 'exports the documented minimum major', function () {
        expect( MINIMUM_MAJOR ).to.equal( 22 );
    } );

} );

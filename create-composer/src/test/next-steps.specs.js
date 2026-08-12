// create-composer/src/test/next-steps.specs.js

/**
 * @fileoverview Unit tests for the closing next-steps message.
 *
 * Covers:
 * - The plain template: cd, npm install, npm start, in that order
 * - A compose-backed template adds docker compose up -d between
 *   install and start
 * - Scaffolding into "." drops the cd line and names the current
 *   directory
 * - The exact composer pin is always named
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { buildNextSteps } from '../next-steps.js';

describe( 'buildNextSteps', function () {

    it( 'orders cd, npm install, npm start for a plain template', function () {
        const text = buildNextSteps( {
            directoryLabel: 'my-flow',
            templateName: 'hello-flow',
            composerPin: '0.4.1',
            needsDocker: false
        } ).join( '\n' );
        const cdAt = text.indexOf( 'cd my-flow' );
        const installAt = text.indexOf( 'npm install' );
        const startAt = text.indexOf( 'npm start' );
        expect( cdAt ).to.be.greaterThan( -1 );
        expect( installAt ).to.be.greaterThan( cdAt );
        expect( startAt ).to.be.greaterThan( installAt );
        expect( text ).to.not.include( 'docker compose' );
    } );

    it( 'adds the services step for a compose-backed template', function () {
        const text = buildNextSteps( {
            directoryLabel: 'pump',
            templateName: 'pump-monitor',
            composerPin: '0.4.1',
            needsDocker: true
        } ).join( '\n' );
        const installAt = text.indexOf( 'npm install' );
        const composeAt = text.indexOf( 'docker compose up -d' );
        const startAt = text.indexOf( 'npm start' );
        expect( composeAt ).to.be.greaterThan( installAt );
        expect( startAt ).to.be.greaterThan( composeAt );
    } );

    it( 'drops the cd line when scaffolding into "."', function () {
        const text = buildNextSteps( {
            directoryLabel: '.',
            templateName: 'hello-flow',
            composerPin: '0.4.1',
            needsDocker: false
        } ).join( '\n' );
        expect( text ).to.include( 'the current directory' );
        expect( text ).to.not.include( 'cd .' );
    } );

    it( 'names the exact composer pin', function () {
        const text = buildNextSteps( {
            directoryLabel: 'my-flow',
            templateName: 'hello-flow',
            composerPin: '1.2.3',
            needsDocker: false
        } ).join( '\n' );
        expect( text ).to.include( '@winkjs/composer 1.2.3' );
    } );

} );

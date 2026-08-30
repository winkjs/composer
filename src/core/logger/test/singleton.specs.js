// core/logger/test/singleton.specs.js

/**
 * @fileoverview Tests for the module's default logger instance. It
 * is built once at import from ENV_VARS (COMPOSER_LOGGER and
 * COMPOSER_LOG_LEVEL), so these specs pin its wiring: the four
 * methods exist, the level matches the environment, and under the
 * test environment (non-production, so level debug) a call really
 * reaches the console transport. ADR-028.
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import sinon from 'sinon';
import { logger } from '../index.js';
import { ENV_VARS } from '../../env-vars.js';

describe( 'the default logger instance', function () {

    afterEach( function () {
        sinon.restore();
    } );

    it( 'exposes the four methods and the two hot-path booleans', function () {
        expect( typeof logger.debug ).to.equal( 'function' );
        expect( typeof logger.info ).to.equal( 'function' );
        expect( typeof logger.warn ).to.equal( 'function' );
        expect( typeof logger.error ).to.equal( 'function' );
        expect( typeof logger.debugOn ).to.equal( 'boolean' );
        expect( typeof logger.infoOn ).to.equal( 'boolean' );
    } );

    it( 'runs at the level ENV_VARS resolved', function () {
        expect( logger.level ).to.equal( ENV_VARS.logLevel );
    } );

    it( 'writes through the console transport under the test environment', function () {
        // Non-production defaults: transport console, level debug —
        // so a debug call must land on console.log verbatim.
        const logStub = sinon.stub( console, 'log' );
        logger.debug( 'singleton wiring check' );
        expect( logStub.callCount ).to.equal( 1 );
        expect( logStub.firstCall.args[ 0 ] ).to.equal( 'singleton wiring check' );
    } );

} );

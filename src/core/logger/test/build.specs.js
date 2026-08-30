// core/logger/test/build.specs.js

/**
 * @fileoverview Tests for buildLogger — the level gate and its
 * guarantees. The contract under test: methods are precompiled at
 * build time, every suppressed level shares one no-op function, the
 * hot-path booleans match the threshold, bad inputs fall back to a
 * working console logger instead of throwing, and a transport that
 * throws never lets the fault reach the calling code. ADR-028.
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import sinon from 'sinon';
import { buildLogger, createMemoryTransport } from '../index.js';

describe( 'buildLogger — level gate', function () {

    afterEach( function () {
        sinon.restore();
    } );

    it( 'at debug level every method emits', function () {
        const mem = createMemoryTransport();
        const log = buildLogger( mem, 'debug' );
        log.debug( 'd' );
        log.info( 'i' );
        log.warn( 'w' );
        log.error( 'e' );
        expect( mem.records.map( ( r ) => r.level ) ).to.deep.equal( [ 'debug', 'info', 'warn', 'error' ] );
    } );

    it( 'at info level debug is suppressed, the rest emit', function () {
        const mem = createMemoryTransport();
        const log = buildLogger( mem, 'info' );
        log.debug( 'd' );
        log.info( 'i' );
        log.warn( 'w' );
        log.error( 'e' );
        expect( mem.records.map( ( r ) => r.level ) ).to.deep.equal( [ 'info', 'warn', 'error' ] );
    } );

    it( 'at warn level only warn and error emit', function () {
        const mem = createMemoryTransport();
        const log = buildLogger( mem, 'warn' );
        log.debug( 'd' );
        log.info( 'i' );
        log.warn( 'w' );
        log.error( 'e' );
        expect( mem.records.map( ( r ) => r.level ) ).to.deep.equal( [ 'warn', 'error' ] );
    } );

    it( 'at error level only error emits', function () {
        const mem = createMemoryTransport();
        const log = buildLogger( mem, 'error' );
        log.debug( 'd' );
        log.info( 'i' );
        log.warn( 'w' );
        log.error( 'e' );
        expect( mem.records.map( ( r ) => r.level ) ).to.deep.equal( [ 'error' ] );
    } );

    it( 'every suppressed method is the SAME shared no-op function', function () {
        const mem = createMemoryTransport();
        const log = buildLogger( mem, 'error' );
        // Identity equality proves one shared function, so a
        // suppressed call allocates nothing and dispatches nothing.
        expect( log.debug ).to.equal( log.info );
        expect( log.info ).to.equal( log.warn );
        expect( log.warn ).to.not.equal( log.error );
    } );

    it( 'passes msg and fields to the transport verbatim', function () {
        const mem = createMemoryTransport();
        const log = buildLogger( mem, 'debug' );
        const fields = { partitionId: 'p1', count: 3 };
        log.warn( 'the message', fields );
        expect( mem.records ).to.have.lengthOf( 1 );
        expect( mem.records[ 0 ].msg ).to.equal( 'the message' );
        expect( mem.records[ 0 ].fields ).to.equal( fields );
    } );

    it( 'fields arrives as undefined when the caller omits it', function () {
        const mem = createMemoryTransport();
        const log = buildLogger( mem, 'debug' );
        log.error( 'plain' );
        expect( mem.records[ 0 ].fields ).to.equal( undefined );
    } );

    it( 'debugOn and infoOn track the threshold exactly', function () {
        const mem = createMemoryTransport();
        expect( buildLogger( mem, 'debug' ).debugOn ).to.equal( true );
        expect( buildLogger( mem, 'debug' ).infoOn ).to.equal( true );
        expect( buildLogger( mem, 'info' ).debugOn ).to.equal( false );
        expect( buildLogger( mem, 'info' ).infoOn ).to.equal( true );
        expect( buildLogger( mem, 'warn' ).debugOn ).to.equal( false );
        expect( buildLogger( mem, 'warn' ).infoOn ).to.equal( false );
        expect( buildLogger( mem, 'error' ).infoOn ).to.equal( false );
    } );

    it( 'exposes the active level for introspection', function () {
        const mem = createMemoryTransport();
        expect( buildLogger( mem, 'warn' ).level ).to.equal( 'warn' );
    } );

} );

describe( 'buildLogger — fallback and containment', function () {

    afterEach( function () {
        sinon.restore();
    } );

    it( 'falls back to the console transport on a transport without emit', function () {
        const warnStub = sinon.stub( console, 'warn' );
        const logStub = sinon.stub( console, 'log' );
        const log = buildLogger( { name: 'broken' }, 'info' );
        expect( warnStub.callCount ).to.equal( 1 );
        expect( warnStub.firstCall.args[ 0 ] ).to.contain( 'winkComposer/logger' );
        log.info( 'still works' );
        expect( logStub.callCount ).to.equal( 1 );
        expect( logStub.firstCall.args[ 0 ] ).to.equal( 'still works' );
    } );

    it( 'falls back to info on an unknown level name', function () {
        const warnStub = sinon.stub( console, 'warn' );
        const mem = createMemoryTransport();
        const log = buildLogger( mem, 'verbose' );
        expect( warnStub.callCount ).to.equal( 1 );
        expect( warnStub.firstCall.args[ 0 ] ).to.contain( 'winkComposer/logger' );
        expect( log.level ).to.equal( 'info' );
        log.debug( 'suppressed' );
        log.info( 'kept' );
        expect( mem.records.map( ( r ) => r.msg ) ).to.deep.equal( [ 'kept' ] );
    } );

    it( 'a throwing transport never lets the fault reach the caller', function () {
        const errorStub = sinon.stub( console, 'error' );
        const hostile = {
            emit: function () {
                throw new Error( 'transport bug' );
            }
        };
        const log = buildLogger( hostile, 'debug' );
        expect( () => log.error( 'boom' ) ).to.not.throw();
        expect( errorStub.callCount ).to.equal( 1 );
        expect( errorStub.firstCall.args[ 0 ] ).to.contain( 'winkComposer/logger' );
    } );

} );

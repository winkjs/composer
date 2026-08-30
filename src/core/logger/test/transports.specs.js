// core/logger/test/transports.specs.js

/**
 * @fileoverview Tests for the built-in transports. The contracts
 * under test: the console transport prints msg verbatim and mirrors
 * each level to the SAME console method the raw call used (so a
 * line never moves between stdout and stderr), the json transport
 * prints one parseable object per line on the same stream split,
 * both survive unserializable fields without throwing, silent
 * discards everything, and the memory transport records for specs.
 * ADR-028 fixes these contracts.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { buildLogger, createMemoryTransport, transports } from '../index.js';

describe( 'console transport', function () {

    let logStub;
    let warnStub;
    let errorStub;

    beforeEach( function () {
        logStub = sinon.stub( console, 'log' );
        warnStub = sinon.stub( console, 'warn' );
        errorStub = sinon.stub( console, 'error' );
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'prints msg verbatim when no fields are given', function () {
        transports.console.emit( 'error', 'winkComposer/flow: exact line' );
        expect( errorStub.callCount ).to.equal( 1 );
        expect( errorStub.firstCall.args[ 0 ] ).to.equal( 'winkComposer/flow: exact line' );
    } );

    it( 'appends fields as JSON after the message', function () {
        transports.console.emit( 'warn', 'dropped', { partitionId: 'p1', count: 3 } );
        expect( warnStub.firstCall.args[ 0 ] ).to.equal( 'dropped {"partitionId":"p1","count":3}' );
    } );

    it( 'mirrors each level to the same console method the raw call used', function () {
        transports.console.emit( 'error', 'e' );
        transports.console.emit( 'warn', 'w' );
        transports.console.emit( 'info', 'i' );
        transports.console.emit( 'debug', 'd' );
        expect( errorStub.callCount ).to.equal( 1 );
        expect( warnStub.callCount ).to.equal( 1 );
        expect( logStub.callCount ).to.equal( 2 );
    } );

    it( 'survives circular fields without throwing', function () {
        const circular = {};
        circular.self = circular;
        expect( () => transports.console.emit( 'error', 'msg', circular ) ).to.not.throw();
        expect( errorStub.firstCall.args[ 0 ] ).to.equal( 'msg "[unserializable fields]"' );
    } );

} );

describe( 'json transport', function () {

    let logStub;
    let warnStub;
    let errorStub;

    beforeEach( function () {
        logStub = sinon.stub( console, 'log' );
        warnStub = sinon.stub( console, 'warn' );
        errorStub = sinon.stub( console, 'error' );
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'prints one parseable JSON object with level, msg, and fields', function () {
        transports.json.emit( 'warn', 'queue high', { depth: 9000 } );
        const parsed = JSON.parse( warnStub.firstCall.args[ 0 ] );
        expect( parsed ).to.deep.equal( { level: 'warn', msg: 'queue high', fields: { depth: 9000 } } );
    } );

    it( 'omits the fields key when the caller gave none', function () {
        transports.json.emit( 'info', 'started' );
        const parsed = JSON.parse( logStub.firstCall.args[ 0 ] );
        expect( parsed ).to.deep.equal( { level: 'info', msg: 'started' } );
        expect( Object.keys( parsed ) ).to.deep.equal( [ 'level', 'msg' ] );
    } );

    it( 'mirrors the console stream split (error/warn vs info/debug)', function () {
        transports.json.emit( 'error', 'e' );
        transports.json.emit( 'warn', 'w' );
        transports.json.emit( 'info', 'i' );
        transports.json.emit( 'debug', 'd' );
        expect( errorStub.callCount ).to.equal( 1 );
        expect( warnStub.callCount ).to.equal( 1 );
        expect( logStub.callCount ).to.equal( 2 );
    } );

    it( 'survives circular fields with a placeholder, still valid JSON', function () {
        const circular = {};
        circular.self = circular;
        expect( () => transports.json.emit( 'error', 'msg', circular ) ).to.not.throw();
        const parsed = JSON.parse( errorStub.firstCall.args[ 0 ] );
        expect( parsed ).to.deep.equal( { level: 'error', msg: 'msg', fields: '[unserializable fields]' } );
    } );

} );

describe( 'silent transport', function () {

    afterEach( function () {
        sinon.restore();
    } );

    it( 'emits nothing on any level', function () {
        const logStub = sinon.stub( console, 'log' );
        const warnStub = sinon.stub( console, 'warn' );
        const errorStub = sinon.stub( console, 'error' );
        const log = buildLogger( transports.silent, 'debug' );
        log.debug( 'd' );
        log.info( 'i' );
        log.warn( 'w' );
        log.error( 'e' );
        expect( logStub.callCount ).to.equal( 0 );
        expect( warnStub.callCount ).to.equal( 0 );
        expect( errorStub.callCount ).to.equal( 0 );
    } );

} );

describe( 'memory transport (test capture)', function () {

    it( 'records every emission in order', function () {
        const mem = createMemoryTransport();
        mem.emit( 'info', 'first' );
        mem.emit( 'error', 'second', { code: 'X' } );
        expect( mem.records ).to.deep.equal( [
            { level: 'info', msg: 'first', fields: undefined },
            { level: 'error', msg: 'second', fields: { code: 'X' } }
        ] );
    } );

    it( 'reset empties the records in place', function () {
        const mem = createMemoryTransport();
        const seen = mem.records;
        mem.emit( 'info', 'x' );
        mem.reset();
        expect( mem.records ).to.have.lengthOf( 0 );
        expect( mem.records ).to.equal( seen );
    } );

    it( 'instances are independent', function () {
        const a = createMemoryTransport();
        const b = createMemoryTransport();
        a.emit( 'info', 'only a' );
        expect( a.records ).to.have.lengthOf( 1 );
        expect( b.records ).to.have.lengthOf( 0 );
    } );

} );

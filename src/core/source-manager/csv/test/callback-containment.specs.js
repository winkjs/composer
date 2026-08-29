// core/source-manager/csv/test/callback-containment.specs.js

/**
 * @fileoverview Containment of a broken user onStatus in the CSV source.
 *
 * The CSV source reports its lifecycle and per-record faults through
 * the user's `onStatus`. Per ADR-018, a bug inside that callback must
 * cost only its own output: the replay keeps reading, every row still
 * reaches `onMessage`, and the completion status is still produced.
 * Each fault becomes one classified console line in this source's
 * family. Without the guard, a throwing `onStatus` at the `starting`
 * site killed the whole replay before the first row.
 */

/* eslint-disable no-sync */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { start } from '../start.js';

// Poll until `condition()` is true or ~500ms elapse.
const waitFor = async function ( condition ) {
    for ( let i = 0; i < 50 && !condition(); i += 1 ) {
        // eslint-disable-next-line no-await-in-loop -- wait-for-condition poll
        await new Promise( ( r ) => setTimeout( r, 10 ) );
    }
}; // waitFor()

// One macrotask turn: lets pending rejections reach the trap.
const settle = function () {
    return new Promise( ( resolve ) => setImmediate( resolve ) );
}; // settle()

const makeCsvFile = function ( content ) {
    const filePath = path.join(
        os.tmpdir(),
        `csv-containment-${Date.now()}-${Math.random().toString( 36 ).slice( 2 )}.csv`
    );
    fs.writeFileSync( filePath, content, 'utf8' );
    return filePath;
}; // makeCsvFile()

describe( 'CSV source — a broken user onStatus is contained (ADR-018)', function () {

    const unhandled = [];
    const trapRejection = function ( err ) {
        unhandled.push( err );
    };

    const faultLines = ( spy ) => spy.getCalls()
        .map( ( call ) => String( call.args[ 0 ] ) )
        .filter( ( line ) => line.includes( 'CALLBACK_FAILED' ) && line.includes( 'onStatus' ) );

    before( function () {
        process.on( 'unhandledRejection', trapRejection );
    } );

    after( function () {
        process.removeListener( 'unhandledRejection', trapRejection );
    } );

    beforeEach( function () {
        unhandled.length = 0;
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'a throwing onStatus never stops the replay — every row delivered, complete still emitted', async function () {
        const filePath = makeCsvFile( 'id,value\na,1\na,2\na,3\n' );
        const onStatus = sinon.stub().throws( new Error( 'reporter down' ) );
        const messages = [];
        const spy = sinon.spy( console, 'error' );
        try {
            const stop = start( {
                path: filePath,
                onStatus,
                onMessage: ( m ) => messages.push( m )
            } );
            await waitFor( () => messages.length === 3 );
            await settle();

            expect( messages ).to.have.lengthOf( 3 );
            // The completion payload still reached the callback, fault and
            // all: lifecycle fires starting, headers, complete — 3 calls.
            expect( onStatus.callCount ).to.equal( 3 );
            const completeCall = onStatus.getCalls()
                .find( ( call ) => call.args[ 0 ].phase === 'complete' );
            expect( completeCall.args[ 0 ].count ).to.equal( 3 );
            // One classified line per contained fault, in this source's family.
            const lines = faultLines( spy );
            expect( lines ).to.have.lengthOf( 3 );
            expect( lines[ 0 ] ).to.contain( 'CSV source error' );
            expect( lines[ 0 ] ).to.contain( 'reporter down' );
            expect( unhandled ).to.have.lengthOf( 0 );
            await stop();
        } finally {
            fs.unlinkSync( filePath );
        }
    } );

    it( 'a throwing onStatus at the per-record DECODE_ERROR site skips the row and continues', async function () {
        // Row 2 is structurally malformed (missing a field) — it triggers
        // the yellow DECODE_ERROR report, whose handler then throws.
        const filePath = makeCsvFile( 'id,value\na,1\nbroken\na,3\n' );
        const onStatus = sinon.stub().throws( new Error( 'reporter down' ) );
        const messages = [];
        const spy = sinon.spy( console, 'error' );
        try {
            const stop = start( {
                path: filePath,
                onStatus,
                onMessage: ( m ) => messages.push( m )
            } );
            await waitFor( () => messages.length === 2 );
            await settle();

            // The malformed row cost itself; the rows around it arrived.
            expect( messages ).to.have.lengthOf( 2 );
            // starting, headers, the DECODE_ERROR report, complete.
            expect( onStatus.callCount ).to.equal( 4 );
            const lines = faultLines( spy );
            expect( lines ).to.have.lengthOf( 4 );
            expect( unhandled ).to.have.lengthOf( 0 );
            await stop();
        } finally {
            fs.unlinkSync( filePath );
        }
    } );

    it( 'rejects a truthy non-function onStatus at start() — fail-fast, never silent absence', function () {
        // The guard turns a non-function into null (absent). Without
        // this assert, a misconfigured `onStatus: 'log'` would silently
        // become "no handler" instead of failing loudly at setup.
        let thrown = null;
        try {
            start( { path: '/dev/null', onMessage: () => undefined, onStatus: 'log' } );
        } catch ( err ) {
            thrown = err;
        }
        expect( thrown ).to.not.equal( null );
        expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        expect( thrown.message ).to.contain( 'onStatus must be a function' );
    } );

    it( 'an async-rejecting onStatus leaves no unhandled rejection', async function () {
        const filePath = makeCsvFile( 'id,value\na,1\n' );
        const onStatus = sinon.stub().callsFake(
            () => Promise.reject( new Error( 'async reporter down' ) )
        );
        const messages = [];
        const spy = sinon.spy( console, 'error' );
        try {
            const stop = start( {
                path: filePath,
                onStatus,
                onMessage: ( m ) => messages.push( m )
            } );
            await waitFor( () => messages.length === 1 );
            await settle();
            await settle();

            expect( messages ).to.have.lengthOf( 1 );
            const lines = faultLines( spy );
            expect( lines ).to.have.lengthOf( 3 );
            expect( lines[ 0 ] ).to.contain( 'async reporter down' );
            expect( unhandled ).to.have.lengthOf( 0 );
            await stop();
        } finally {
            fs.unlinkSync( filePath );
        }
    } );

} );

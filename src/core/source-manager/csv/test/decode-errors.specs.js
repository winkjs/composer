// core/source-manager/csv/test/decode-errors.specs.js

/**
 * @fileoverview CSV source — per-record skip-and-classify on structural
 * decode failure (ADR-018).
 *
 * The contract: when a row cannot be parsed at all, the source must
 * SKIP that row (never crash, never halt the stream), SIGNAL it as
 * `DECODE_ERROR` through `onStatus` (never a silent drop), and
 * CONTINUE with the next row.
 *
 * The boundary matters: a *structural* failure (field count does not
 * match the header, an unterminated quoted field) is the source's
 * `DECODE_ERROR`. A bad *field value* inside a parseable row is the
 * pipeline's concern (the `sanitize` node), NOT a decode error — the
 * boundary test below pins that.
 */

/* eslint-disable no-sync */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sinon from 'sinon';
import { start } from '../start.js';

const createTempCsv = function ( content ) {
    const tmpDir = os.tmpdir();
    const filePath = path.join( tmpDir, `test-decode-${Date.now()}-${Math.random().toString( 36 ).slice( 2 )}.csv` );
    fs.writeFileSync( filePath, content, 'utf8' );
    return filePath;
};

const cleanupFile = function ( filePath ) {
    try {
        fs.unlinkSync( filePath );
    } catch {
        // Ignore cleanup errors
    }
};

// Runs the source to completion, collecting messages and status events.
const collectMessages = function ( config ) {
    return new Promise( ( resolve ) => {
        const messages = [];
        const statusMessages = [];

        start( {
            ...config,
            onMessage: function ( msg ) {
                messages.push( msg );
            },
            onStatus: function ( s ) {
                statusMessages.push( s );
                // Completion travels onStatus — the uniform `count`
                // field, per ADR-018 (there is no onComplete).
                if ( s.phase === 'complete' ) {
                    resolve( { messages, statusMessages, count: s.count } );
                }
            },
            onShutdown: null,
            shutdownOnComplete: false
        } );
    } );
};

describe( 'CSV Source — structural decode failure (ADR-018)', function () {

    let testFile;

    afterEach( function () {
        if ( testFile ) cleanupFile( testFile );
        sinon.restore();
    } );

    it( 'skips a row with too few fields, reports DECODE_ERROR, and continues', async function () {
        // Row 2 has one field where the header declares three.
        testFile = createTempCsv( 'id,name,value\n1,alpha,10\nbroken\n3,gamma,30' );

        const { messages, statusMessages } = await collectMessages( { path: testFile } );

        // The stream continued: rows before AND after the bad row arrived.
        expect( messages ).to.have.length( 2 );
        expect( messages[ 0 ] ).to.deep.equal( { id: 1, name: 'alpha', value: 10 } );
        expect( messages[ 1 ] ).to.deep.equal( { id: 3, name: 'gamma', value: 30 } );

        // The skip was signalled, classified.
        const decodeEvents = statusMessages.filter( ( s ) => s.error && s.error.code === 'DECODE_ERROR' );
        expect( decodeEvents ).to.have.length( 1 );
        expect( decodeEvents[ 0 ].status ).to.equal( 'yellow' );
        expect( decodeEvents[ 0 ].connected ).to.equal( true );
        // One payload rule, no exceptions: per-record reports carry
        // the phase too (uniformity sweep, 2026-07-09).
        expect( decodeEvents[ 0 ].phase ).to.equal( 'running' );
        // Operator-facing: the message names the field counts.
        expect( decodeEvents[ 0 ].error.message ).to.contain( '3' );
        expect( decodeEvents[ 0 ].error.message ).to.contain( '1' );
    } );

    it( 'skips a row with too many fields, reports DECODE_ERROR, and continues', async function () {
        testFile = createTempCsv( 'id,value\n1,10\n2,20,extra,fields\n3,30' );

        const { messages, statusMessages } = await collectMessages( { path: testFile } );

        expect( messages ).to.have.length( 2 );
        expect( messages[ 0 ] ).to.deep.equal( { id: 1, value: 10 } );
        expect( messages[ 1 ] ).to.deep.equal( { id: 3, value: 30 } );

        const decodeEvents = statusMessages.filter( ( s ) => s.error && s.error.code === 'DECODE_ERROR' );
        expect( decodeEvents ).to.have.length( 1 );
    } );

    it( 'skips a row with an unterminated quoted field, reports DECODE_ERROR, and continues', async function () {
        // Row 2's quote never closes — the row cannot be parsed.
        testFile = createTempCsv( 'id,name,value\n1,alpha,10\n2,"broken,20\n3,gamma,30' );

        const { messages, statusMessages } = await collectMessages( { path: testFile } );

        expect( messages ).to.have.length( 2 );
        expect( messages[ 0 ].id ).to.equal( 1 );
        expect( messages[ 1 ].id ).to.equal( 3 );

        const decodeEvents = statusMessages.filter( ( s ) => s.error && s.error.code === 'DECODE_ERROR' );
        expect( decodeEvents ).to.have.length( 1 );
        expect( decodeEvents[ 0 ].error.message ).to.contain( 'quote' );
    } );

    it( 'counts skipped rows and reports the count in the complete event', async function () {
        testFile = createTempCsv( 'id,value\n1,10\nbad\n2,20\nalso,bad,row\n3,30' );

        const { messages, statusMessages, count } = await collectMessages( { path: testFile } );

        expect( messages ).to.have.length( 3 );
        expect( count ).to.equal( 3 );

        const complete = statusMessages.find( ( s ) => s.phase === 'complete' );
        expect( complete.count ).to.equal( 3 );
        expect( complete.skipped ).to.equal( 2 );
    } );

    it( 'reports zero skipped in the complete event for a clean file', async function () {
        testFile = createTempCsv( 'id,value\n1,10\n2,20' );

        const { statusMessages } = await collectMessages( { path: testFile } );

        const complete = statusMessages.find( ( s ) => s.phase === 'complete' );
        expect( complete.skipped ).to.equal( 0 );
    } );

    it( 'is deterministic — the same file yields the same skips on every run', async function () {
        testFile = createTempCsv( 'id,value\n1,10\nbad\n2,20' );

        const first = await collectMessages( { path: testFile } );
        const second = await collectMessages( { path: testFile } );

        expect( first.messages ).to.deep.equal( second.messages );
        const codesOf = ( r ) => r.statusMessages
            .filter( ( s ) => s.error )
            .map( ( s ) => s.error.code );
        expect( codesOf( first ) ).to.deep.equal( codesOf( second ) );
    } );

    it( 'falls back to a classified console.error when no onStatus is provided (never silent)', async function () {
        testFile = createTempCsv( 'id,value\n1,10\nbad\n2,20' );
        const errorSpy = sinon.spy( console, 'error' );

        await new Promise( ( resolve ) => {
            start( {
                path: testFile,
                onMessage: () => null,
                onStatus: null,
                onShutdown: null,
                shutdownOnComplete: false
            } );
            // The fallback path under test has no onStatus to signal
            // completion — poll for the classified line instead of
            // sleeping a fixed time (no timing dependence on file size).
            const poll = setInterval( () => {
                if ( errorSpy.called ) {
                    clearInterval( poll );
                    resolve();
                }
            }, 5 );
            poll.unref();
            setTimeout( () => {
                clearInterval( poll );
                resolve();
            }, 2000 ).unref();
        } );
        errorSpy.restore();

        const decodeLines = errorSpy.getCalls()
            .map( ( c ) => c.args[ 0 ] )
            .filter( ( line ) => typeof line === 'string' && line.includes( 'DECODE_ERROR' ) );
        expect( decodeLines ).to.have.length( 1 );
    } );

    it( 'positional range filtering still counts a skipped row\'s position', async function () {
        // Five data lines; line at index 1 is malformed. startMsgId: 2
        // (row index) must still mean "the third data line" — a skipped
        // row occupies its position, it does not shift later rows.
        testFile = createTempCsv( 'id,value\n1,10\nbad\n3,30\n4,40\n5,50' );

        const { messages } = await collectMessages( { path: testFile, startMsgId: 2 } );

        expect( messages.map( ( m ) => m.id ) ).to.deep.equal( [ 3, 4, 5 ] );
    } );

    // --------------------------------------------------------------------
    // The boundary: a bad FIELD VALUE in a parseable row is NOT a
    // decode error — it belongs to the pipeline (sanitize).
    // --------------------------------------------------------------------

    it( 'delivers a parseable row whose field value is garbage — no DECODE_ERROR', async function () {
        // 'not-a-number' in a numeric column: structurally fine (three
        // fields, three headers). The source delivers it; sanitize owns it.
        testFile = createTempCsv( 'id,name,value\n1,alpha,10\n2,beta,not-a-number\n3,gamma,30' );

        const { messages, statusMessages } = await collectMessages( { path: testFile } );

        expect( messages ).to.have.length( 3 );
        expect( messages[ 1 ].value ).to.equal( 'not-a-number' );

        const decodeEvents = statusMessages.filter( ( s ) => s.error && s.error.code === 'DECODE_ERROR' );
        expect( decodeEvents ).to.have.length( 0 );
    } );

    it( 'delivers a parseable row with empty fields — no DECODE_ERROR', async function () {
        // Empty fields are values (null under dynamicTyping), not
        // structural damage: the delimiter count still matches.
        testFile = createTempCsv( 'id,name,value\n1,,10\n2,beta,' );

        const { messages, statusMessages } = await collectMessages( { path: testFile } );

        expect( messages ).to.have.length( 2 );
        expect( messages[ 0 ].name ).to.equal( null );
        expect( messages[ 1 ].value ).to.equal( null );

        const decodeEvents = statusMessages.filter( ( s ) => s.error && s.error.code === 'DECODE_ERROR' );
        expect( decodeEvents ).to.have.length( 0 );
    } );

} );

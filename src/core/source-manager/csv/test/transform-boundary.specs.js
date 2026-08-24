// core/source-manager/csv/test/transform-boundary.specs.js

/**
 * @fileoverview CSV source — transform return boundary.
 *
 * The transform contract is uniform across sources: a null/undefined
 * return is an intentional silent drop, counted in `skipped`; a
 * throw is one per-record CALLBACK_FAILED and the stream continues.
 * The return-shape rule: a scalar or array return is user code
 * handing back an unusable record — one per-record CALLBACK_FAILED,
 * row skipped, stream continues. This file pins all three faces on
 * the CSV side; the MQTT side is pinned in
 * mqtt/test/shape-guard.specs.js.
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
    const filePath = path.join( tmpDir, `test-boundary-${Date.now()}-${Math.random().toString( 36 ).slice( 2 )}.csv` );
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
                if ( s.phase === 'complete' ) {
                    resolve( { messages, statusMessages, complete: s } );
                }
            },
            onShutdown: null,
            shutdownOnComplete: false
        } );
    } );
};

const callbackReports = function ( statusMessages ) {
    return statusMessages.filter( ( s ) => s.error && s.error.code === 'CALLBACK_FAILED' );
};

describe( 'CSV Source — transform return boundary', function () {

    let testFile;

    afterEach( function () {
        if ( testFile ) cleanupFile( testFile );
        sinon.restore();
    } );

    // A scalar or array return on one row: that row is skipped with
    // one classified report; every other row is delivered.
    [
        { name: 'a number',  returned: 7,           shape: 'a number' },
        { name: 'a boolean', returned: true,        shape: 'a boolean' },
        { name: 'a string',  returned: 'oops',      shape: 'a string' },
        { name: 'an array',  returned: [ 1, 2, 3 ], shape: 'an array' }
    ].forEach( function ( { name, returned, shape } ) {
        it( `reports CALLBACK_FAILED when the transform returns ${name}, skips the row, and continues`, async function () {
            testFile = createTempCsv( 'id,value\n1,10\n2,20\n3,30' );
            const transform = function ( row ) {
                return row.id === 2 ? returned : row;
            };

            const { messages, statusMessages, complete } = await collectMessages( { path: testFile, transform } );

            // Rows before AND after the bad return arrived.
            expect( messages.map( ( m ) => m.id ) ).to.deep.equal( [ 1, 3 ] );

            const reports = callbackReports( statusMessages );
            expect( reports ).to.have.length( 1 );
            expect( reports[ 0 ].status ).to.equal( 'yellow' );
            expect( reports[ 0 ].phase ).to.equal( 'running' );
            expect( reports[ 0 ].error.message ).to.contain( `transform returned ${shape}` );
            expect( reports[ 0 ].error.message ).to.contain( 'row skipped' );

            // The skip is counted in the completion payload.
            expect( complete.count ).to.equal( 2 );
            expect( complete.skipped ).to.equal( 1 );
        } );
    } );

    // The intentional drop stays intentional: counted, never reported.
    [ null, undefined ].forEach( function ( dropValue ) {
        it( `drops a ${dropValue === null ? 'null' : 'undefined'} return silently with the counter advanced`, async function () {
            testFile = createTempCsv( 'id,value\n1,10\n2,20\n3,30' );
            const transform = function ( row ) {
                return row.id === 2 ? dropValue : row;
            };

            const { messages, statusMessages, complete } = await collectMessages( { path: testFile, transform } );

            expect( messages.map( ( m ) => m.id ) ).to.deep.equal( [ 1, 3 ] );
            expect( callbackReports( statusMessages ) ).to.have.length( 0 );
            expect( complete.skipped ).to.equal( 1 );
        } );
    } );

    // The throw face, re-pinned here so the whole boundary lives in
    // one data-driven file on each source.
    it( 'reports CALLBACK_FAILED when the transform throws, skips the row, and continues', async function () {
        testFile = createTempCsv( 'id,value\n1,10\n2,20\n3,30' );
        const transform = function ( row ) {
            if ( row.id === 2 ) {
                throw new Error( 'boom on row 2' );
            }
            return row;
        };

        const { messages, statusMessages, complete } = await collectMessages( { path: testFile, transform } );

        expect( messages.map( ( m ) => m.id ) ).to.deep.equal( [ 1, 3 ] );

        const reports = callbackReports( statusMessages );
        expect( reports ).to.have.length( 1 );
        expect( reports[ 0 ].error.message ).to.contain( 'transform threw: boom on row 2' );
        expect( complete.skipped ).to.equal( 1 );
    } );

    // Two-party rule: without an onStatus, the bad return is still
    // visible via the classified console fallback — never silent.
    it( 'falls back to a classified console.error for a bad return when no onStatus is provided', async function () {
        testFile = createTempCsv( 'id,value\n1,10\n2,20' );
        const errorSpy = sinon.spy( console, 'error' );

        await new Promise( ( resolve ) => {
            start( {
                path: testFile,
                onMessage: () => null,
                transform: () => 42,
                onStatus: null,
                onShutdown: null,
                shutdownOnComplete: false
            } );
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

        const lines = errorSpy.getCalls()
            .map( ( c ) => c.args[ 0 ] )
            .filter( ( line ) => typeof line === 'string' &&
                                 line.includes( 'CALLBACK_FAILED' ) &&
                                 line.includes( 'transform returned a number' ) );
        expect( lines.length ).to.be.at.least( 1 );
    } );

} );

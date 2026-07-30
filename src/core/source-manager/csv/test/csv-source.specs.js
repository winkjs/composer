// core/source-manager/csv/test/csv-source.specs.js

/**
 * @fileoverview Functional tests for CSV source adapter.
 *
 * Tests cover:
 * - Basic CSV parsing and streaming
 * - Dynamic typing (numbers, booleans, nulls)
 * - Transform function
 * - Range filtering (row-based and field-based)
 * - Callbacks (onStatus; completion travels onStatus per ADR-018)
 * - shutdownOnComplete behavior
 * - Delimiter detection
 * - Edge cases
 */

/* eslint-disable no-sync */
import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { start } from '../start.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

const createTempCsv = function ( content ) {
    const tmpDir = os.tmpdir();
    const filePath = path.join( tmpDir, `test-${Date.now()}-${Math.random().toString( 36 ).slice( 2 )}.csv` );
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

const collectMessages = function ( config ) {
    return new Promise( ( resolve ) => {
        const messages = [];
        const statusMessages = [];

        const stopFn = start( {
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
            shutdownOnComplete: false  // Don't shutdown, just collect
        } );

        // Safety timeout
        setTimeout( () => {
            stopFn();
            resolve( { messages, statusMessages, count: messages.length } );
        }, 5000 );
    } );
};

// ============================================================================
// TESTS
// ============================================================================

describe( 'CSV Source — Basic Parsing', function () {
    let testFile;

    afterEach( function () {
        if ( testFile ) cleanupFile( testFile );
    } );

    it( 'parses simple CSV with headers', async function () {
        testFile = createTempCsv( 'id,name,value\n1,alpha,10\n2,beta,20\n3,gamma,30' );

        const { messages } = await collectMessages( { path: testFile } );

        expect( messages ).to.have.length( 3 );
        expect( messages[ 0 ] ).to.deep.equal( { id: 1, name: 'alpha', value: 10 } );
        expect( messages[ 1 ] ).to.deep.equal( { id: 2, name: 'beta', value: 20 } );
        expect( messages[ 2 ] ).to.deep.equal( { id: 3, name: 'gamma', value: 30 } );
    } );

    it( 'handles empty lines gracefully', async function () {
        testFile = createTempCsv( 'id,value\n1,10\n\n2,20\n\n3,30' );

        const { messages } = await collectMessages( { path: testFile } );

        expect( messages ).to.have.length( 3 );
    } );

    it( 'handles quoted fields with commas', async function () {
        testFile = createTempCsv( 'id,name,desc\n1,"Smith, John","A, B, C"\n2,Jane,Simple' );

        const { messages } = await collectMessages( { path: testFile } );

        expect( messages ).to.have.length( 2 );
        expect( messages[ 0 ].name ).to.equal( 'Smith, John' );
        expect( messages[ 0 ].desc ).to.equal( 'A, B, C' );
    } );
} );

describe( 'CSV Source — Dynamic Typing', function () {
    let testFile;

    afterEach( function () {
        if ( testFile ) cleanupFile( testFile );
    } );

    it( 'casts numbers correctly', async function () {
        testFile = createTempCsv( 'int,float,neg\n42,3.14,-100' );

        const { messages } = await collectMessages( { path: testFile } );

        expect( messages[ 0 ].int ).to.equal( 42 );
        expect( messages[ 0 ].float ).to.equal( 3.14 );
        expect( messages[ 0 ].neg ).to.equal( -100 );
    } );

    it( 'casts booleans correctly', async function () {
        testFile = createTempCsv( 'a,b,c,d\ntrue,false,TRUE,FALSE' );

        const { messages } = await collectMessages( { path: testFile } );

        expect( messages[ 0 ].a ).to.equal( true );
        expect( messages[ 0 ].b ).to.equal( false );
        expect( messages[ 0 ].c ).to.equal( true );
        expect( messages[ 0 ].d ).to.equal( false );
    } );

    it( 'casts empty values to null', async function () {
        testFile = createTempCsv( 'a,b,c\n1,,3' );

        const { messages } = await collectMessages( { path: testFile } );

        expect( messages[ 0 ].a ).to.equal( 1 );
        expect( messages[ 0 ].b ).to.equal( null );
        expect( messages[ 0 ].c ).to.equal( 3 );
    } );

    it( 'keeps strings as strings', async function () {
        testFile = createTempCsv( 'name,code\nhello,ABC123' );

        const { messages } = await collectMessages( { path: testFile } );

        expect( messages[ 0 ].name ).to.equal( 'hello' );
        expect( messages[ 0 ].code ).to.equal( 'ABC123' );
    } );

    it( 'respects dynamicTyping=false', async function () {
        testFile = createTempCsv( 'id,value\n1,100' );

        const { messages } = await collectMessages( { path: testFile, dynamicTyping: false } );

        expect( messages[ 0 ].id ).to.equal( '1' );
        expect( messages[ 0 ].value ).to.equal( '100' );
    } );
} );

describe( 'CSV Source — Delimiter Detection', function () {
    let testFile;

    afterEach( function () {
        if ( testFile ) cleanupFile( testFile );
    } );

    it( 'detects tab delimiter', async function () {
        testFile = createTempCsv( 'id\tname\tvalue\n1\talpha\t10' );

        const { messages } = await collectMessages( { path: testFile } );

        expect( messages ).to.have.length( 1 );
        expect( messages[ 0 ] ).to.deep.equal( { id: 1, name: 'alpha', value: 10 } );
    } );

    it( 'detects semicolon delimiter', async function () {
        testFile = createTempCsv( 'id;name;value\n1;alpha;10' );

        const { messages } = await collectMessages( { path: testFile } );

        expect( messages ).to.have.length( 1 );
        expect( messages[ 0 ] ).to.deep.equal( { id: 1, name: 'alpha', value: 10 } );
    } );
} );

describe( 'CSV Source — Transform Function', function () {
    let testFile;

    afterEach( function () {
        if ( testFile ) cleanupFile( testFile );
    } );

    it( 'applies transform to each row', async function () {
        testFile = createTempCsv( 'x,y\n1,2\n3,4' );

        const transform = function ( row ) {
            return { sum: row.x + row.y, product: row.x * row.y };
        };

        const { messages } = await collectMessages( { path: testFile, transform } );

        expect( messages ).to.have.length( 2 );
        expect( messages[ 0 ] ).to.deep.equal( { sum: 3, product: 2 } );
        expect( messages[ 1 ] ).to.deep.equal( { sum: 7, product: 12 } );
    } );

    it( 'skips row when transform returns null', async function () {
        testFile = createTempCsv( 'id,value\n1,10\n2,20\n3,30' );

        const transform = function ( row ) {
            return row.value > 15 ? row : null;
        };

        const { messages } = await collectMessages( { path: testFile, transform } );

        expect( messages ).to.have.length( 2 );
        expect( messages[ 0 ].id ).to.equal( 2 );
        expect( messages[ 1 ].id ).to.equal( 3 );
    } );
} );

describe( 'CSV Source — Range Filtering (Row-Based)', function () {
    let testFile;

    afterEach( function () {
        if ( testFile ) cleanupFile( testFile );
    } );

    it( 'filters by startMsgId (row index)', async function () {
        testFile = createTempCsv( 'id,value\n1,10\n2,20\n3,30\n4,40\n5,50' );

        const { messages } = await collectMessages( { path: testFile, startMsgId: 2 } );

        expect( messages ).to.have.length( 3 );
        expect( messages[ 0 ].id ).to.equal( 3 );  // Row index 2 (0-based)
    } );

    it( 'filters by endMsgId (row index)', async function () {
        testFile = createTempCsv( 'id,value\n1,10\n2,20\n3,30\n4,40\n5,50' );

        const { messages } = await collectMessages( { path: testFile, endMsgId: 2 } );

        expect( messages ).to.have.length( 3 );  // Rows 0, 1, 2 (inclusive)
        expect( messages[ 2 ].id ).to.equal( 3 );
    } );

    it( 'filters by startMsgId and endMsgId together', async function () {
        testFile = createTempCsv( 'id,value\n1,10\n2,20\n3,30\n4,40\n5,50' );

        const { messages } = await collectMessages( { path: testFile, startMsgId: 1, endMsgId: 3 } );

        expect( messages ).to.have.length( 3 );  // Rows 1, 2, 3
        expect( messages[ 0 ].id ).to.equal( 2 );
        expect( messages[ 2 ].id ).to.equal( 4 );
    } );
} );

describe( 'CSV Source — Range Filtering (Field-Based)', function () {
    let testFile;

    afterEach( function () {
        if ( testFile ) cleanupFile( testFile );
    } );

    it( 'filters by idField and startMsgId', async function () {
        testFile = createTempCsv( 'id,value\n100,10\n200,20\n300,30\n400,40' );

        const { messages } = await collectMessages( {
            path: testFile,
            idField: 'id',
            startMsgId: 200
        } );

        expect( messages ).to.have.length( 3 );
        expect( messages[ 0 ].id ).to.equal( 200 );
    } );

    it( 'filters by idField and endMsgId', async function () {
        testFile = createTempCsv( 'id,value\n100,10\n200,20\n300,30\n400,40' );

        const { messages } = await collectMessages( {
            path: testFile,
            idField: 'id',
            endMsgId: 200
        } );

        expect( messages ).to.have.length( 2 );  // 100, 200 (inclusive)
        expect( messages[ 1 ].id ).to.equal( 200 );
    } );

    it( 'filters by idField with startMsgId and endMsgId', async function () {
        testFile = createTempCsv( 'id,value\n100,10\n200,20\n300,30\n400,40\n500,50' );

        const { messages } = await collectMessages( {
            path: testFile,
            idField: 'id',
            startMsgId: 200,
            endMsgId: 400
        } );

        expect( messages ).to.have.length( 3 );  // 200, 300, 400
        expect( messages[ 0 ].id ).to.equal( 200 );
        expect( messages[ 2 ].id ).to.equal( 400 );
    } );

    it( 'handles non-sequential ids', async function () {
        testFile = createTempCsv( 'id,value\n10,a\n50,b\n30,c\n70,d\n20,e' );

        const { messages } = await collectMessages( {
            path: testFile,
            idField: 'id',
            startMsgId: 25,
            endMsgId: 60
        } );

        // Starts at first id >= 25 (which is 50), ends at first id >= 60 (which is 70)
        // But 70 >= 60, so break after 70
        expect( messages[ 0 ].id ).to.equal( 50 );
    } );
} );

describe( 'CSV Source — Callbacks', function () {
    let testFile;

    afterEach( function () {
        if ( testFile ) cleanupFile( testFile );
    } );

    it( 'emits structured starting and headers status (ADR-018)', async function () {
        testFile = createTempCsv( 'id,name\n1,test' );

        const { statusMessages } = await collectMessages( { path: testFile } );

        const starting = statusMessages.find( ( s ) => s.phase === 'starting' );
        expect( starting ).to.deep.equal( {
            status: 'green',
            connected: true,
            phase: 'starting',
            path: testFile
        } );

        const headers = statusMessages.find( ( s ) => s.phase === 'headers' );
        expect( headers ).to.deep.equal( {
            status: 'green',
            connected: true,
            phase: 'headers',
            headers: [ 'id', 'name' ]
        } );
    } );

    it( 'emits structured complete status with the uniform count field (ADR-018)', async function () {
        testFile = createTempCsv( 'id\n1\n2\n3' );

        const { statusMessages } = await collectMessages( { path: testFile } );

        const complete = statusMessages.find( ( s ) => s.phase === 'complete' );
        expect( complete ).to.deep.equal( {
            status: 'green',
            connected: false,
            phase: 'complete',
            count: 3,
            skipped: 0
        } );
    } );

    it( 'reports the produced-message count on completion', async function () {
        testFile = createTempCsv( 'id\n1\n2\n3\n4\n5' );

        const { count } = await collectMessages( { path: testFile } );

        expect( count ).to.equal( 5 );
    } );

    it( 'count reflects filtered rows only', async function () {
        testFile = createTempCsv( 'id\n1\n2\n3\n4\n5' );

        const { count } = await collectMessages( { path: testFile, startMsgId: 2, endMsgId: 3 } );

        expect( count ).to.equal( 2 );  // Only rows 2 and 3
    } );
} );

// ============================================================================
// STRUCTURED ERROR REPORTING — ADR-018
// ============================================================================
// When the run loop fails (file not found, permission denied, mid-stream
// read error, etc.), errors are surfaced via onStatus({status: 'red',
// error: {code, message}}) when the caller supplies one. Callers without
// onStatus see a classified console.error fallback so failures are never
// silently swallowed.

describe( 'CSV Source — Structured Error Reporting', function () {

    /**
     * Drive a single error scenario through start() and resolve once we
     * observe either an onStatus call (the structured-error path) or the
     * fallback console.error (no-handler path). The async run loop's
     * .catch settles via setImmediate, so we use a short polling timeout.
     */
    const driveErrorScenario = function ( config, onStatus ) {
        return new Promise( ( resolve ) => {
            const stopFn = start( {
                onMessage: function () { /* no-op */ },
                ...config,
                onStatus,
                onShutdown: null,
                shutdownOnComplete: false
            } );
            // Allow the async run() Promise to settle and fire .catch.
            // 50ms is comfortably more than the test takes locally.
            setTimeout( () => {
                stopFn();
                resolve();
            }, 50 );
        } );
    };

    it( 'routes file-not-found errors to onStatus with code SOURCE_UNREACHABLE', async function () {
        const statusCalls = [];
        const onStatus = function ( s ) {
            statusCalls.push( s );
        };
        const missingPath = path.join( os.tmpdir(), `does-not-exist-${Date.now()}.csv` );

        await driveErrorScenario( { path: missingPath }, onStatus );

        const errorCalls = statusCalls.filter( ( s ) => typeof s === 'object' && s.status === 'red' );
        expect( errorCalls ).to.have.lengthOf( 1 );
        expect( errorCalls[ 0 ].error.code ).to.equal( 'SOURCE_UNREACHABLE' );
        expect( errorCalls[ 0 ].error.message ).to.be.a( 'string' );
        expect( errorCalls[ 0 ].error.message.length ).to.be.greaterThan( 0 );
        // A terminal red is a transition — it carries the uniform
        // payload fields, phase 'errored' per the ADR-018 two-tier rule.
        expect( errorCalls[ 0 ].connected ).to.equal( false );
        expect( errorCalls[ 0 ].phase ).to.equal( 'errored' );
    } );

    it( 'routes permission-denied errors to onStatus with code SOURCE_UNREACHABLE', async function () {
        // Create a temp file, strip read permission, then point CSV at it.
        // Skipped on platforms where chmod cannot remove read access for the
        // process owner (Windows; ignored here since the suite is POSIX).
        const tmpDir = os.tmpdir();
        const filePath = path.join( tmpDir, `nrperm-${Date.now()}-${Math.random().toString( 36 ).slice( 2 )}.csv` );
        fs.writeFileSync( filePath, 'id\n1\n', 'utf8' );
        fs.chmodSync( filePath, 0o000 );

        const statusCalls = [];
        const onStatus = function ( s ) {
            statusCalls.push( s );
        };

        try {
            await driveErrorScenario( { path: filePath }, onStatus );

            const errorCalls = statusCalls.filter( ( s ) => typeof s === 'object' && s.status === 'red' );
            expect( errorCalls ).to.have.lengthOf( 1 );
            expect( errorCalls[ 0 ].error.code ).to.equal( 'SOURCE_UNREACHABLE' );
            expect( errorCalls[ 0 ].connected ).to.equal( false );
            expect( errorCalls[ 0 ].phase ).to.equal( 'errored' );
        } finally {
            // Restore permission so cleanup works regardless of the test outcome.
            try {
                fs.chmodSync( filePath, 0o600 );
            } catch {
                // Ignore chmod failures (test cleanup is best-effort).
            }
            cleanupFile( filePath );
        }
    } );

    it( 'routes is-a-directory errors to onStatus with code SOURCE_UNREACHABLE', async function () {
        // Pointing CSV at a directory raises EISDIR — covers the third
        // arm of the SOURCE_UNREACHABLE classifier.
        const statusCalls = [];
        const onStatus = function ( s ) {
            statusCalls.push( s );
        };

        await driveErrorScenario( { path: os.tmpdir() }, onStatus );

        const errorCalls = statusCalls.filter( ( s ) => typeof s === 'object' && s.status === 'red' );
        expect( errorCalls ).to.have.lengthOf( 1 );
        expect( errorCalls[ 0 ].error.code ).to.equal( 'SOURCE_UNREACHABLE' );
        expect( errorCalls[ 0 ].connected ).to.equal( false );
        expect( errorCalls[ 0 ].phase ).to.equal( 'errored' );
    } );

    it( 'routes a mid-stream pipeline failure to onStatus with code READ_ERROR', async function () {
        // A rejection that is not an fs open error — here the pipeline's
        // own onMessage throwing — takes the READ_ERROR catch-all arm of
        // the classifier, not SOURCE_UNREACHABLE.
        const filePath = createTempCsv( 'id\n1\n2\n' );
        const statusCalls = [];
        const onStatus = function ( s ) {
            statusCalls.push( s );
        };

        try {
            await driveErrorScenario( {
                path: filePath,
                onMessage: function () {
                    throw new Error( 'pipeline exploded' );
                }
            }, onStatus );

            const errorCalls = statusCalls.filter( ( s ) => typeof s === 'object' && s.status === 'red' );
            expect( errorCalls ).to.have.lengthOf( 1 );
            expect( errorCalls[ 0 ].error.code ).to.equal( 'READ_ERROR' );
            expect( errorCalls[ 0 ].error.message ).to.equal( 'pipeline exploded' );
            expect( errorCalls[ 0 ].connected ).to.equal( false );
            expect( errorCalls[ 0 ].phase ).to.equal( 'errored' );
        } finally {
            cleanupFile( filePath );
        }
    } );

    it( 'classifies a reason-less rejection as READ_ERROR with a stringified message', async function () {
        // `await onMessage( msg )` rejecting with NO reason hands the
        // catch an undefined err. The classifier's defensive legs must
        // still produce a code and a string message — never a crash on
        // property access of undefined.
        const filePath = createTempCsv( 'id\n1\n' );
        const statusCalls = [];
        const onStatus = function ( s ) {
            statusCalls.push( s );
        };

        try {
            await driveErrorScenario( {
                path: filePath,
                onMessage: function () {
                    // The reason-less rejection IS the scenario under test.
                    return Promise.reject();
                }
            }, onStatus );

            const errorCalls = statusCalls.filter( ( s ) => typeof s === 'object' && s.status === 'red' );
            expect( errorCalls ).to.have.lengthOf( 1 );
            expect( errorCalls[ 0 ].error.code ).to.equal( 'READ_ERROR' );
            expect( errorCalls[ 0 ].error.message ).to.equal( 'undefined' );
            expect( errorCalls[ 0 ].phase ).to.equal( 'errored' );
        } finally {
            cleanupFile( filePath );
        }
    } );

    it( 'falls back to console.error when no onStatus is provided', async function () {
        const originalConsoleError = console.error;
        const errorCalls = [];
        console.error = function ( ...args ) {
            errorCalls.push( args.join( ' ' ) );
        };
        const missingPath = path.join( os.tmpdir(), `does-not-exist-${Date.now()}.csv` );

        try {
            await driveErrorScenario( { path: missingPath }, null );

            expect( errorCalls ).to.have.lengthOf( 1 );
            expect( errorCalls[ 0 ] ).to.include( 'CSV source error' );
            expect( errorCalls[ 0 ] ).to.include( '[SOURCE_UNREACHABLE]' );
        } finally {
            console.error = originalConsoleError;
        }
    } );

} );

describe( 'CSV Source — Stop Function', function () {
    let testFile;

    afterEach( function () {
        if ( testFile ) cleanupFile( testFile );
    } );

    it( 'stops processing when stop function is called', async function () {
        testFile = createTempCsv( 'id\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10' );

        const messages = [];
        let stopFn;

        await new Promise( ( resolve ) => {
            stopFn = start( {
                path: testFile,
                delayMs: 50,
                onMessage: function ( msg ) {
                    messages.push( msg );
                    if ( messages.length === 3 ) {
                        stopFn();
                    }
                },
                onStatus: function ( s ) {
                    if ( s.phase === 'complete' || s.phase === 'stopped' ) {
                        resolve();
                    }
                },
                shutdownOnComplete: false
            } );

            // Safety timeout
            setTimeout( resolve, 1000 );
        } );

        expect( messages.length ).to.be.lessThanOrEqual( 4 );  // May process one more after stop
    } );

    it( 'settles a forced stop exactly once when the loop exits late (double-settle guard)', async function () {
        // The scenario the settled-guard exists for: the loop is stuck
        // inside `await onMessage`, the stop's time budget forces the
        // stream closed (settle one), and the loop's LATE exit fires
        // `finished.then( settle )` a second time. The guard must swallow
        // the second settle quietly while the run's end is still
        // reported through onStatus.
        testFile = createTempCsv( 'id\n1\n2\n3\n' );

        const statuses = [];
        const delivered = [];
        let notifyNext = null;
        let releaseGate;
        const gate = new Promise( ( resolve ) => {
            releaseGate = resolve;
        } );
        let signalStarted;
        const firstMessageStarted = new Promise( ( resolve ) => {
            signalStarted = resolve;
        } );

        const stopFn = start( {
            path: testFile,
            onMessage: function ( msg ) {
                delivered.push( msg );
                signalStarted();
                return gate;
            },
            onStatus: function ( s ) {
                statuses.push( s );
                if ( notifyNext ) {
                    const fn = notifyNext;
                    notifyNext = null;
                    fn( s );
                }
            },
            shutdownOnComplete: false
        } );

        await firstMessageStarted;
        await stopFn( { timeout: 20 } );

        const forcedNotes = statuses.filter( ( s ) => s.note && s.note.includes( 'forced' ) );
        expect( forcedNotes ).to.have.lengthOf( 1 );

        // Unstick the loop; its exit must still be reported (complete,
        // or errored if the destroyed stream rejects the iterator).
        const nextStatus = new Promise( ( resolve ) => {
            notifyNext = resolve;
        } );
        releaseGate();
        const finalStatus = await nextStatus;

        expect( [ 'complete', 'errored' ] ).to.include( finalStatus.phase );
        // One extra macrotask so `finished.then( settle )` has run —
        // this is the second settle the guard absorbs.
        await new Promise( ( resolve ) => {
            setImmediate( resolve );
        } );
        expect( delivered ).to.have.lengthOf( 1 );
        expect( statuses.filter( ( s ) => s.note && s.note.includes( 'forced' ) ) ).to.have.lengthOf( 1 );
    } );
} );

describe( 'CSV Source — Edge Cases', function () {
    let testFile;

    afterEach( function () {
        if ( testFile ) cleanupFile( testFile );
    } );

    it( 'handles file with only headers', async function () {
        testFile = createTempCsv( 'id,name,value' );

        const { messages, count } = await collectMessages( { path: testFile } );

        expect( messages ).to.have.length( 0 );
        expect( count ).to.equal( 0 );
    } );

    it( 'handles single data row', async function () {
        testFile = createTempCsv( 'id\n42' );

        const { messages } = await collectMessages( { path: testFile } );

        expect( messages ).to.have.length( 1 );
        expect( messages[ 0 ].id ).to.equal( 42 );
    } );

    it( 'returns 0 rows when range has no matches', async function () {
        testFile = createTempCsv( 'id\n100\n200\n300' );

        const { messages } = await collectMessages( {
            path: testFile,
            idField: 'id',
            startMsgId: 500,
            endMsgId: 600
        } );

        expect( messages ).to.have.length( 0 );
    } );
} );

describe( 'CSV Source — stopFn timeout symmetry (ADR-018)', function () {
    let testFile;

    afterEach( function () {
        if ( testFile ) cleanupFile( testFile );
    } );

    // Per ADR-018, the source's stop function accepts `{ timeout }` and
    // force-destroys the read stream when graceful exit doesn't complete in
    // time. This test wedges the run loop inside an `await onMessage()` that
    // never resolves, then triggers the force-destroy path with a short
    // timeout.
    it( 'force-destroys the read stream and emits yellow status when stop exceeds timeout', async function () {
        testFile = createTempCsv( 'id\n1\n2\n3\n4\n5' );

        // onMessage that never resolves — wedges the run loop on the first
        // message so the stopped flag cannot drain the loop naturally.
        const wedgedOnMessage = function () {
            return new Promise( () => { /* never resolves */ } );
        };

        const statusMessages = [];
        const stopFn = start( {
            path: testFile,
            onMessage: wedgedOnMessage,
            onStatus: ( s ) => statusMessages.push( s ),
            onShutdown: null,
            shutdownOnComplete: false
        } );

        // Wait long enough for the loop to wedge inside onMessage.
        await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );

        // Stop with a short budget — expect it to return via the
        // forced-stop path, not hang forever.
        const stopStart = Date.now();
        await stopFn( { timeout: 100 } );
        const stopElapsed = Date.now() - stopStart;

        // Returned via the forced timer (~100ms), not stuck on the wedge.
        expect( stopElapsed ).to.be.lessThan( 1000 );
        expect( stopElapsed ).to.be.at.least( 90 );

        // Forced-stop yellow status was emitted.
        const yellowStop = statusMessages.find(
            ( s ) => s && s.status === 'yellow' && s.phase === 'stopped'
        );
        expect( yellowStop ).to.not.equal( undefined );
        expect( yellowStop.note ).to.contain( 'forced' );
    } );

    it( 'resolves quickly when run loop has already exited', async function () {
        testFile = createTempCsv( 'id\n1' );

        const stopFn = start( {
            path: testFile,
            onMessage: function () { /* sync, returns immediately */ },
            onStatus: null,
            onShutdown: null,
            shutdownOnComplete: false
        } );

        // Wait for the run loop to fully consume the file and exit.
        await new Promise( ( resolve ) => setTimeout( resolve, 100 ) );

        // Stop after exit — should resolve essentially instantly because
        // `finished` already resolved via the run().catch().finally() chain.
        const stopStart = Date.now();
        await stopFn( { timeout: 5000 } );
        const stopElapsed = Date.now() - stopStart;

        expect( stopElapsed ).to.be.lessThan( 50 );
    } );

    it( 'calls onShutdown when shutdownOnComplete is true (direct-API contract)', async function () {
        // Direct (non-flow) callers can rely on the source's
        // shutdownOnComplete behaviour. This test pins the contract
        // so future refactors can't drop it silently. (Inside a
        // flow, the runtime overrides shutdownOnComplete to false
        // to avoid the recursive-await deadlock — that's covered
        // separately in `src/flow/test/handle-lifecycle.specs.js`.)
        testFile = createTempCsv( 'id\n1\n2' );

        const shutdownCalls = [];
        await new Promise( function ( resolve ) {
            start( {
                path: testFile,
                onMessage: function () { /* drop */ },
                onStatus: null,
                onShutdown: function () {
                    shutdownCalls.push( Date.now() );
                    resolve();
                    return Promise.resolve();
                },
                shutdownOnComplete: true
            } );
        } );

        expect( shutdownCalls ).to.have.length( 1 );
    } );
} );

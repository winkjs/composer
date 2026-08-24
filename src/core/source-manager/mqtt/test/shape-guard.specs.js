// core/source-manager/mqtt/test/shape-guard.specs.js

/* eslint-disable no-underscore-dangle */

/**
 * @fileoverview MQTT source — payload shape guard and transform
 * return boundary.
 *
 * A valid JSON document can be a scalar (`null`, `1`, `true`,
 * `"text"`) or a bare array. Such a payload decodes cleanly but is
 * not a usable record: the metadata attach would throw in strict
 * mode and kill the process. The guard skips it with one per-record
 * DECODE_ERROR report (skip-classify-continue, ADR-018) and the
 * stream continues. The attach itself is inside the guarded region
 * too: a codec returning a frozen record, or one with a non-writable
 * `_topic`, is skipped with a report — never an escaped throw.
 *
 * The transform return boundary is pinned here as well: a
 * null/undefined return stays an intentional silent drop (counted);
 * a scalar or array return is one per-record CALLBACK_FAILED.
 *
 * Both decode paths are driven: JSON strings and the real
 * MessagePack codec (it also decodes top-level scalars). The codec
 * path adds an `undefined` case — a codec `unpack` can return it,
 * `JSON.parse` cannot.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createMQTTSourceClient } from '../client.js';
import { msgpackCodec } from '../../../codec/index.js';
import { createMockClient } from './test-helpers.js';

// The rejected payload shapes, named as the report must name them.
// `json` drives the JSON.parse path; `value` drives the codec path.
const BAD_PAYLOADS = [
    { name: 'null',       json: 'null',    value: null,        shape: 'null' },
    { name: 'a number',   json: '1',       value: 1,           shape: 'a number' },
    { name: 'a boolean',  json: 'true',    value: true,        shape: 'a boolean' },
    { name: 'a string',   json: '"text"',  value: 'text',      shape: 'a string' },
    { name: 'a bare array', json: '[1,2,3]', value: [ 1, 2, 3 ], shape: 'an array' }
];

// Per-record DECODE_ERROR reports only — the ratio-rule health flip
// reuses the same code and must not be counted here.
const perRecordDecodeReports = function ( statusLog ) {
    return statusLog.filter(
        ( s ) => s.error &&
                 s.error.code === 'DECODE_ERROR' &&
                 !( /decode-error ratio/ ).test( s.error.message )
    );
};

describe( 'MQTT Source — payload shape guard', function () {

    let mockClient;
    let mockConnect;
    let receivedMessages;
    let statusLog;
    const packet = { properties: {} };

    // Fresh client per test; returns the stop fn for metrics access.
    const makeClient = function ( extra = {} ) {
        return createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: ( msg ) => receivedMessages.push( msg ),
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: mockConnect,
            ...extra
        } );
    };

    beforeEach( function () {
        mockClient = createMockClient();
        mockConnect = sinon.stub().returns( mockClient );
        receivedMessages = [];
        statusLog = [];
    } );

    afterEach( function () {
        sinon.restore();
    } );

    // --------------------------------------------------------------------
    // The guard, through the JSON decode path.
    // --------------------------------------------------------------------

    BAD_PAYLOADS.forEach( function ( { name, json, shape } ) {
        it( `JSON path: skips ${name} payload, reports DECODE_ERROR, and continues`, function () {
            const stop = makeClient();

            mockClient._emit( 'message', 'test/topic', Buffer.from( json ), packet );

            // Skipped, classified, named — never delivered.
            expect( receivedMessages ).to.have.length( 0 );
            const reports = perRecordDecodeReports( statusLog );
            expect( reports ).to.have.length( 1 );
            expect( reports[ 0 ].status ).to.equal( 'yellow' );
            expect( reports[ 0 ].error.message ).to.contain( 'test/topic' );
            expect( reports[ 0 ].error.message ).to.contain( `payload decoded to ${shape}` );
            expect( reports[ 0 ].error.message ).to.contain( 'a record object is required' );
            expect( stop._metrics().skipped ).to.equal( 1 );

            // The stream continues: the next good message is delivered.
            mockClient._emit( 'message', 'test/topic', Buffer.from( '{"ok": 1}' ), packet );
            expect( receivedMessages ).to.have.length( 1 );
            expect( receivedMessages[ 0 ].ok ).to.equal( 1 );
        } );
    } );

    // --------------------------------------------------------------------
    // The guard, through the codec decode path (real MessagePack).
    // --------------------------------------------------------------------

    BAD_PAYLOADS.forEach( function ( { name, value, shape } ) {
        it( `codec path: skips ${name} payload, reports DECODE_ERROR, and continues`, function () {
            const stop = makeClient( { codec: msgpackCodec } );

            mockClient._emit( 'message', 'test/topic', msgpackCodec.pack( value ), packet );

            expect( receivedMessages ).to.have.length( 0 );
            const reports = perRecordDecodeReports( statusLog );
            expect( reports ).to.have.length( 1 );
            expect( reports[ 0 ].error.message ).to.contain( `payload decoded to ${shape}` );
            expect( stop._metrics().skipped ).to.equal( 1 );

            mockClient._emit( 'message', 'test/topic', msgpackCodec.pack( { ok: 1 } ), packet );
            expect( receivedMessages ).to.have.length( 1 );
        } );
    } );

    it( 'codec path: skips an undefined unpack result — JSON.parse cannot produce it, a codec can', function () {
        const stop = makeClient( { codec: { unpack: () => undefined } } );

        mockClient._emit( 'message', 'test/topic', Buffer.from( 'x' ), packet );

        expect( receivedMessages ).to.have.length( 0 );
        const reports = perRecordDecodeReports( statusLog );
        expect( reports ).to.have.length( 1 );
        expect( reports[ 0 ].error.message ).to.contain( 'payload decoded to undefined' );
        expect( stop._metrics().skipped ).to.equal( 1 );
    } );

    // --------------------------------------------------------------------
    // Pass-through pin: array-valued FIELDS are a designed pattern
    // (esPairwiseCorrelation → vectorDistance) and must keep working.
    // --------------------------------------------------------------------

    it( 'passes a record whose fields hold array values untouched', function () {
        makeClient();

        const record = { assetId: 'pump01', vector: [ 0.1, 0.2, 0.3 ] };
        mockClient._emit( 'message', 'test/topic', Buffer.from( JSON.stringify( record ) ), packet );

        expect( receivedMessages ).to.have.length( 1 );
        expect( receivedMessages[ 0 ].vector ).to.deep.equal( [ 0.1, 0.2, 0.3 ] );
        expect( receivedMessages[ 0 ]._topic ).to.equal( 'test/topic' );
        expect( perRecordDecodeReports( statusLog ) ).to.have.length( 0 );
    } );

    // --------------------------------------------------------------------
    // The attach is inside the guarded region: a record the metadata
    // assignment cannot write to is skipped with a report — never an
    // escaped throw (strict mode makes the assignment throw).
    // --------------------------------------------------------------------

    it( 'skips a frozen record from a codec with a DECODE_ERROR report — no escaped throw', function () {
        const stop = makeClient( { codec: { unpack: () => Object.freeze( { value: 1 } ) } } );

        const emitFrozen = function () {
            mockClient._emit( 'message', 'test/topic', Buffer.from( 'x' ), packet );
        };
        expect( emitFrozen ).to.not.throw();

        expect( receivedMessages ).to.have.length( 0 );
        expect( perRecordDecodeReports( statusLog ) ).to.have.length( 1 );
        expect( stop._metrics().skipped ).to.equal( 1 );
    } );

    it( 'skips a record with a non-writable _topic with a DECODE_ERROR report — no escaped throw', function () {
        const makeRecord = function () {
            const record = { value: 1 };
            Object.defineProperty( record, '_topic', { value: 'locked', writable: false } );
            return record;
        };
        makeClient( { codec: { unpack: makeRecord } } );

        const emitLocked = function () {
            mockClient._emit( 'message', 'test/topic', Buffer.from( 'x' ), packet );
        };
        expect( emitLocked ).to.not.throw();

        expect( receivedMessages ).to.have.length( 0 );
        expect( perRecordDecodeReports( statusLog ) ).to.have.length( 1 );
    } );

} );

describe( 'MQTT Source — transform return boundary', function () {

    let mockClient;
    let mockConnect;
    let receivedMessages;
    let statusLog;
    const packet = { properties: {} };

    const makeClient = function ( transform ) {
        return createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            transform,
            onMessage: ( msg ) => receivedMessages.push( msg ),
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: mockConnect
        } );
    };

    const callbackReports = function () {
        return statusLog.filter( ( s ) => s.error && s.error.code === 'CALLBACK_FAILED' );
    };

    beforeEach( function () {
        mockClient = createMockClient();
        mockConnect = sinon.stub().returns( mockClient );
        receivedMessages = [];
        statusLog = [];
    } );

    afterEach( function () {
        sinon.restore();
    } );

    // A null/undefined return is the documented intentional drop:
    // counted, never reported.
    [ null, undefined ].forEach( function ( dropValue ) {
        it( `drops a ${dropValue === null ? 'null' : 'undefined'} return silently with the counter advanced`, function () {
            const stop = makeClient( () => dropValue );

            mockClient._emit( 'message', 'test/topic', Buffer.from( '{"value": 1}' ), packet );

            expect( receivedMessages ).to.have.length( 0 );
            expect( callbackReports() ).to.have.length( 0 );
            expect( stop._metrics().skipped ).to.equal( 1 );
        } );
    } );

    // A scalar or array return is user code handing back an unusable
    // record — one per-record CALLBACK_FAILED, stream continues.
    [
        { name: 'a number',  returned: 42,          shape: 'a number' },
        { name: 'a boolean', returned: false,       shape: 'a boolean' },
        { name: 'a string',  returned: 'oops',      shape: 'a string' },
        { name: 'an array',  returned: [ 1, 2, 3 ], shape: 'an array' }
    ].forEach( function ( { name, returned, shape } ) {
        it( `reports CALLBACK_FAILED when the transform returns ${name}, and continues`, function () {
            let calls = 0;
            const stop = makeClient( ( msg ) => {
                calls += 1;
                return calls === 1 ? returned : msg;
            } );

            mockClient._emit( 'message', 'test/topic', Buffer.from( '{"value": 1}' ), packet );

            expect( receivedMessages ).to.have.length( 0 );
            const reports = callbackReports();
            expect( reports ).to.have.length( 1 );
            expect( reports[ 0 ].status ).to.equal( 'yellow' );
            expect( reports[ 0 ].error.message ).to.contain( 'test/topic' );
            expect( reports[ 0 ].error.message ).to.contain( `transform returned ${shape}` );
            expect( stop._metrics().skipped ).to.equal( 1 );

            // The stream continues: the next message passes through.
            mockClient._emit( 'message', 'test/topic', Buffer.from( '{"value": 2}' ), packet );
            expect( receivedMessages ).to.have.length( 1 );
            expect( receivedMessages[ 0 ].value ).to.equal( 2 );
        } );
    } );

} );

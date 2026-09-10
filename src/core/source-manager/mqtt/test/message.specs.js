// core/source-manager/mqtt/test/message.specs.js

/* eslint-disable no-underscore-dangle */

/**
 * @fileoverview MQTT source — message decode, transform, and dispatch.
 *
 * Covers payload decoding (codec and JSON fallback), decode-error
 * handling, `_topic` / `_dedupId` attachment, and the transform hook
 * (including its null/undefined drop semantics). Split from the
 * original client.specs.js; assertions unchanged. Uses sinon stubs
 * to mock mqtt.connect — no broker required.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createMQTTSourceClient } from '../client.js';
import { WINK_NAMESPACE } from '../constants.js';
import { createMockClient } from './test-helpers.js';
import { logger } from '../../../logger/index.js';

describe( 'MQTT Source — Message Handling', function () {

    let mockClient;
    let mockConnect;
    let receivedMessages;

    beforeEach( function () {
        mockClient = createMockClient();
        mockConnect = sinon.stub().returns( mockClient );
        receivedMessages = [];
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'decodes JSON payload and delivers to onMessage', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://127.0.0.1',
            topics: 'test/topic',
            onMessage: ( msg ) => receivedMessages.push( msg ),
            mqttConnectFn: mockConnect
        } );

        const payload = Buffer.from( JSON.stringify( { value: 42 } ) );
        const packet = { properties: {} };

        mockClient._emit( 'message', 'test/topic', payload, packet );

        expect( receivedMessages ).to.have.length( 1 );
        expect( receivedMessages[ 0 ].value ).to.equal( 42 );
    } );

    it( 'attaches topic as _topic', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://127.0.0.1',
            topics: 'edge/+/enriched',
            onMessage: ( msg ) => receivedMessages.push( msg ),
            mqttConnectFn: mockConnect
        } );

        const payload = Buffer.from( '{"value": 1}' );
        const packet = { properties: {} };

        mockClient._emit( 'message', 'edge/pump01/enriched', payload, packet );

        expect( receivedMessages[ 0 ]._topic ).to.equal( 'edge/pump01/enriched' );
    } );

    it( 'attaches dedupId as _dedupId', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://127.0.0.1',
            topics: 'test/topic',
            onMessage: ( msg ) => receivedMessages.push( msg ),
            mqttConnectFn: mockConnect
        } );

        const payload = Buffer.from( '{"value": 1}' );
        const packet = {
            properties: {
                userProperties: {
                    [ WINK_NAMESPACE.dedupId ]: 'abc-123'
                }
            }
        };

        mockClient._emit( 'message', 'test/topic', payload, packet );

        expect( receivedMessages[ 0 ]._dedupId ).to.equal( 'abc-123' );
    } );

    it( 'uses codec.unpack when provided', function () {
        const customCodec = {
            unpack: sinon.stub().returns( { decoded: true } )
        };

        createMQTTSourceClient( {
            brokerUrl: 'mqtt://127.0.0.1',
            topics: 'test/topic',
            codec: customCodec,
            onMessage: ( msg ) => receivedMessages.push( msg ),
            mqttConnectFn: mockConnect
        } );

        const payload = Buffer.from( 'binary-data' );
        const packet = { properties: {} };

        mockClient._emit( 'message', 'test/topic', payload, packet );

        expect( customCodec.unpack.calledWith( payload ) ).to.equal( true );
        expect( receivedMessages[ 0 ].decoded ).to.equal( true );
    } );

    it( 'falls back to JSON.parse when codec not provided', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://127.0.0.1',
            topics: 'test/topic',
            onMessage: ( msg ) => receivedMessages.push( msg ),
            mqttConnectFn: mockConnect
        } );

        const payload = Buffer.from( '{"fallback": true}' );
        const packet = { properties: {} };

        mockClient._emit( 'message', 'test/topic', payload, packet );

        expect( receivedMessages[ 0 ].fallback ).to.equal( true );
    } );

    it( 'reports a decode failure as a structured per-record DECODE_ERROR and continues', function () {
        const statusLog = [];

        createMQTTSourceClient( {
            brokerUrl: 'mqtt://127.0.0.1',
            topics: 'test/topic',
            onMessage: ( msg ) => receivedMessages.push( msg ),
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: mockConnect
        } );

        const packet = { properties: {} };
        mockClient._emit( 'message', 'test/topic', Buffer.from( 'not-valid-json' ), packet );

        // The bad record was skipped, classified, and named its topic.
        expect( receivedMessages ).to.have.length( 0 );
        const reports = statusLog.filter(
            ( s ) => s.error &&
                     s.error.code === 'DECODE_ERROR' &&
                     !( /decode-error ratio/ ).test( s.error.message )
        );
        expect( reports ).to.have.length( 1 );
        expect( reports[ 0 ].status ).to.equal( 'yellow' );
        expect( reports[ 0 ].error.message ).to.contain( 'test/topic' );
        expect( reports[ 0 ].error.message ).to.contain( 'message skipped' );

        // The stream continues: the next good message is delivered.
        mockClient._emit( 'message', 'test/topic', Buffer.from( '{"ok": 1}' ), packet );
        expect( receivedMessages ).to.have.length( 1 );
    } );

    // The parser's own message can echo a fragment of the payload
    // (Node 22: `Unexpected token 'o', "not-valid-json" is not valid
    // JSON`). Payload text is data and stays below the warn level. The
    // report names the topic and the size instead.
    it( 'the DECODE_ERROR detail names the topic and the byte length, never the payload text', function () {
        const statusLog = [];
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://127.0.0.1',
            topics: 'test/topic',
            onMessage: () => { /* no-op */ },
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: mockConnect
        } );

        const packet = { properties: {} };
        mockClient._emit( 'message', 'test/topic', Buffer.from( 'secret-looking-text' ), packet );

        // One failure in one message also flips the ratio rule; that
        // health report is not the per-record one under test.
        const reports = statusLog.filter(
            ( s ) => s.error &&
                     s.error.code === 'DECODE_ERROR' &&
                     !( /decode-error ratio/ ).test( s.error.message )
        );
        expect( reports ).to.have.length( 1 );
        expect( reports[ 0 ].error.message ).to.equal(
            'topic \'test/topic\': payload of 19 bytes could not be decoded — message skipped'
        );
        expect( reports[ 0 ].error.message ).to.not.contain( 'secret-looking-text' );
    } );

    // The two cases below flip the facade's debug flag explicitly, so
    // both arms of the guard run whatever COMPOSER_LOG_LEVEL the test
    // process started with.
    const withDebug = function ( on, body ) {
        const wasOn = logger.debugOn;
        logger.debugOn = on;
        try {
            body();
        } finally {
            logger.debugOn = wasOn;
        }
    };

    it( 'the parser\'s own reason goes to one debug line when debug is on', function () {
        const debugStub = sinon.stub( logger, 'debug' );
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://127.0.0.1',
            topics: 'test/topic',
            onMessage: () => { /* no-op */ },
            mqttConnectFn: mockConnect
        } );

        withDebug( true, function () {
            mockClient._emit( 'message', 'test/topic', Buffer.from( 'not-valid-json' ), { properties: {} } );
        } );

        expect( debugStub.calledOnce ).to.equal( true );
        const line = debugStub.firstCall.args[ 0 ];
        expect( line ).to.contain( 'winkComposer/mqttSource: decode failed [DECODE_ERROR]: topic \'test/topic\': ' );
        expect( line ).to.contain( 'not-valid-json' );
    } );

    it( 'no debug line is built when debug is off', function () {
        const debugStub = sinon.stub( logger, 'debug' );
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://127.0.0.1',
            topics: 'test/topic',
            onMessage: () => { /* no-op */ },
            mqttConnectFn: mockConnect
        } );

        withDebug( false, function () {
            mockClient._emit( 'message', 'test/topic', Buffer.from( 'not-valid-json' ), { properties: {} } );
        } );

        expect( debugStub.called ).to.equal( false );
    } );

    it( 'applies transform function when provided', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://127.0.0.1',
            topics: 'test/topic',
            transform: ( msg ) => ( { ...msg, transformed: true } ),
            onMessage: ( msg ) => receivedMessages.push( msg ),
            mqttConnectFn: mockConnect
        } );

        const payload = Buffer.from( '{"original": true}' );
        const packet = { properties: {} };

        mockClient._emit( 'message', 'test/topic', payload, packet );

        expect( receivedMessages[ 0 ].original ).to.equal( true );
        expect( receivedMessages[ 0 ].transformed ).to.equal( true );
    } );

    it( 'does not deliver if transform returns null', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://127.0.0.1',
            topics: 'test/topic',
            transform: () => null,
            onMessage: ( msg ) => receivedMessages.push( msg ),
            mqttConnectFn: mockConnect
        } );

        const payload = Buffer.from( '{"value": 1}' );
        const packet = { properties: {} };

        mockClient._emit( 'message', 'test/topic', payload, packet );

        expect( receivedMessages ).to.have.length( 0 );
    } );

    it( 'does not deliver if transform returns undefined', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://127.0.0.1',
            topics: 'test/topic',
            transform: () => undefined,
            onMessage: ( msg ) => receivedMessages.push( msg ),
            mqttConnectFn: mockConnect
        } );

        const payload = Buffer.from( '{"value": 1}' );
        const packet = { properties: {} };

        mockClient._emit( 'message', 'test/topic', payload, packet );

        expect( receivedMessages ).to.have.length( 0 );
    } );

} );

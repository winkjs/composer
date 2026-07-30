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
            brokerUrl: 'mqtt://localhost',
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
            brokerUrl: 'mqtt://localhost',
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
            brokerUrl: 'mqtt://localhost',
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
            brokerUrl: 'mqtt://localhost',
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
            brokerUrl: 'mqtt://localhost',
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
            brokerUrl: 'mqtt://localhost',
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

    it( 'applies transform function when provided', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
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
            brokerUrl: 'mqtt://localhost',
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
            brokerUrl: 'mqtt://localhost',
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

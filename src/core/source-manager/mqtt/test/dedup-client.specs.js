// core/source-manager/mqtt/test/dedup-client.specs.js

/* eslint-disable no-underscore-dangle, no-empty-function */

/**
 * @fileoverview MQTT source — deduplication through the client path.
 *
 * Covers dedup as the message handler exercises it: duplicate skip,
 * skip logging, the no-`dedupId` bypass, window-size eviction, and
 * the `_dedup` test surface. The dedup module's own unit tests live
 * in dedup.specs.js — this file tests the integration through
 * `createMQTTSourceClient`. Split from the original client.specs.js;
 * assertions unchanged. Uses sinon stubs to mock mqtt.connect — no
 * broker required.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createMQTTSourceClient } from '../client.js';
import { WINK_NAMESPACE } from '../constants.js';
import { createMockClient } from './test-helpers.js';

describe( 'MQTT Source — Deduplication', function () {

    let mockClient;
    let mockConnect;
    let receivedMessages;
    let statusLog;

    beforeEach( function () {
        mockClient = createMockClient();
        mockConnect = sinon.stub().returns( mockClient );
        receivedMessages = [];
        statusLog = [];
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'skips duplicate messages with same dedupId', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: ( msg ) => receivedMessages.push( msg ),
            onStatus: ( msg ) => statusLog.push( msg ),
            mqttConnectFn: mockConnect
        } );

        const payload = Buffer.from( '{"value": 1}' );
        const packet = {
            properties: {
                userProperties: {
                    [ WINK_NAMESPACE.dedupId ]: 'dup-id-123'
                }
            }
        };

        // First message
        mockClient._emit( 'message', 'test/topic', payload, packet );
        // Duplicate
        mockClient._emit( 'message', 'test/topic', payload, packet );
        // Another duplicate
        mockClient._emit( 'message', 'test/topic', payload, packet );

        expect( receivedMessages ).to.have.length( 1 );
    } );

    it( 'counts a duplicate skip in the metrics — it is normal operation, not a status event', function () {
        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: ( msg ) => receivedMessages.push( msg ),
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: mockConnect
        } );

        const payload = Buffer.from( '{"value": 1}' );
        const packet = {
            properties: {
                userProperties: {
                    [ WINK_NAMESPACE.dedupId ]: 'dup-id-456'
                }
            }
        };

        mockClient._emit( 'message', 'test/topic', payload, packet );
        mockClient._emit( 'message', 'test/topic', payload, packet );

        // The skip lives in the onMetrics counters — the status
        // channel carries transitions and error reports only.
        const snap = stop._metrics();
        expect( snap.dedupHits ).to.equal( 1 );
        expect( snap.dedupMisses ).to.equal( 1 );
        expect( snap.delivered ).to.equal( 1 );
        expect( snap.skipped ).to.equal( 1 );
        expect( statusLog.filter( ( s ) => s.error ) ).to.have.length( 0 );
    } );

    it( 'counts messages without a dedup id as bypassed', function () {
        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: ( msg ) => receivedMessages.push( msg ),
            mqttConnectFn: mockConnect
        } );

        mockClient._emit( 'message', 'test/topic', Buffer.from( '{"value": 1}' ), { properties: {} } );

        const snap = stop._metrics();
        expect( snap.dedupBypassed ).to.equal( 1 );
        expect( snap.dedupMisses ).to.equal( 0 );
        expect( snap.delivered ).to.equal( 1 );
    } );

    it( 'processes messages without dedupId', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: ( msg ) => receivedMessages.push( msg ),
            mqttConnectFn: mockConnect
        } );

        const payload1 = Buffer.from( '{"value": 1}' );
        const payload2 = Buffer.from( '{"value": 2}' );
        const packet = { properties: {} };

        mockClient._emit( 'message', 'test/topic', payload1, packet );
        mockClient._emit( 'message', 'test/topic', payload2, packet );

        expect( receivedMessages ).to.have.length( 2 );
    } );

    it( 'handles missing userProperties', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: ( msg ) => receivedMessages.push( msg ),
            mqttConnectFn: mockConnect
        } );

        const payload = Buffer.from( '{"value": 1}' );
        const packet = {};  // No properties at all

        mockClient._emit( 'message', 'test/topic', payload, packet );

        expect( receivedMessages ).to.have.length( 1 );
    } );

    it( 'processes different dedupIds', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: ( msg ) => receivedMessages.push( msg ),
            mqttConnectFn: mockConnect
        } );

        const payload = Buffer.from( '{"value": 1}' );

        for ( let i = 0; i < 5; i += 1 ) {
            const packet = {
                properties: {
                    userProperties: {
                        [ WINK_NAMESPACE.dedupId ]: `id-${i}`
                    }
                }
            };
            mockClient._emit( 'message', 'test/topic', payload, packet );
        }

        expect( receivedMessages ).to.have.length( 5 );
    } );

    it( 'respects custom dedupMaxEntries (ADR-022 count bound through the client)', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            dedupMaxEntries: 3,
            onMessage: ( msg ) => receivedMessages.push( msg ),
            mqttConnectFn: mockConnect
        } );

        const payload = Buffer.from( '{"value": 1}' );

        // Add 4 messages to fill and overflow window of 3
        for ( let i = 0; i < 4; i += 1 ) {
            const packet = {
                properties: {
                    userProperties: {
                        [ WINK_NAMESPACE.dedupId ]: `id-${i}`
                    }
                }
            };
            mockClient._emit( 'message', 'test/topic', payload, packet );
        }

        // id-0 should be evicted, so duplicate of id-0 will be processed
        const evictedPacket = {
            properties: {
                userProperties: {
                    [ WINK_NAMESPACE.dedupId ]: 'id-0'
                }
            }
        };
        mockClient._emit( 'message', 'test/topic', payload, evictedPacket );

        expect( receivedMessages ).to.have.length( 5 );  // 4 unique + 1 after eviction
    } );

    it( 'exposes dedup cache for testing', function () {
        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        expect( stop._dedup ).to.be.an( 'object' );
        expect( stop._dedup.isDuplicate ).to.be.a( 'function' );
    } );

} );

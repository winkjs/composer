// core/source-manager/mqtt/test/e2e-mqtt-source.specs.js

/* eslint-disable no-process-env, no-await-in-loop, no-invalid-this, no-underscore-dangle, no-empty-function, require-await, no-unused-vars */

/**
 * @fileoverview End-to-end tests for MQTT source with real Mosquitto broker.
 *
 * Requires running Mosquitto MQTT broker:
 *   brew services start mosquitto
 *   OR
 *   docker run -p 1883:1883 eclipse-mosquitto
 *
 * Tests are skipped if Mosquitto is not available.
 *
 * Tests the full flow: MQTT Emitter → Mosquitto → MQTT Source
 * with deduplication verification.
 */

import { expect } from 'chai';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import mqtt from 'mqtt';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

import { createMQTTSourceClient } from '../client.js';
import { createEmitter } from '../../../emitter-manager/mqtt/emitter.js';
import { jsonCodec } from '../../../codec/index.js';

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883';
const TEST_TOPIC = `wink-test/${Date.now()}`;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if Mosquitto is available.
 *
 * @returns {Promise<boolean>} True if broker is reachable
 */
const isMosquittoAvailable = async function () {
    return new Promise( function ( resolve ) {
        const client = mqtt.connect( MQTT_BROKER_URL, {
            connectTimeout: 3000,
            reconnectPeriod: 0  // Don't reconnect for availability check
        } );

        const timeout = setTimeout( function () {
            client.end( true );
            resolve( false );
        }, 3000 );

        client.on( 'connect', function () {
            clearTimeout( timeout );
            client.end( true );
            resolve( true );
        } );

        client.on( 'error', function () {
            clearTimeout( timeout );
            client.end( true );
            resolve( false );
        } );
    } );
};

/**
 * Wait for a condition to be true.
 *
 * @param {function} conditionFn - Function that returns true when condition is met
 * @param {number} [maxWaitMs=5000] - Maximum wait time
 * @param {number} [checkInterval=50] - Check interval
 * @returns {Promise<boolean>} True if condition met, false if timeout
 */
const waitFor = async function ( conditionFn, maxWaitMs = 5000, checkInterval = 50 ) {
    const startTime = Date.now();

    while ( ( Date.now() - startTime ) < maxWaitMs ) {
        if ( conditionFn() ) {
            return true;
        }
        await new Promise( ( r ) => setTimeout( r, checkInterval ) );
    }

    return false;
};

// ============================================================================
// E2E TESTS
// ============================================================================

describe( 'MQTT Source E2E Tests', function () {

    // E2E tests may take longer
    this.timeout( 30000 );

    let mosquittoAvailable = false;

    before( async function () {
        mosquittoAvailable = await isMosquittoAvailable();

        if ( !mosquittoAvailable ) {
            console.log( '  [SKIP] Mosquitto not available - skipping E2E tests' );
            console.log( '         Run: brew services start mosquitto' );
            console.log( '         Or:  docker run -p 1883:1883 eclipse-mosquitto' );
        }
    } );

    beforeEach( function () {
        if ( !mosquittoAvailable ) {
            this.skip();
        }
    } );

    // ========================================================================
    // Basic Source Functionality
    // ========================================================================

    describe( 'Basic Source Functionality', function () {

        let stopSource;

        afterEach( async function () {
            if ( stopSource ) {
                await stopSource();
                stopSource = null;
            }
        } );

        it( 'should connect to broker and subscribe', async function () {
            const statusLog = [];

            stopSource = createMQTTSourceClient( {
                brokerUrl: MQTT_BROKER_URL,
                topics: TEST_TOPIC,
                onMessage: () => {},
                onStatus: ( s ) => statusLog.push( s )
            } );

            // Wait for the structured running status — connected and
            // subscribed against the real broker.
            const connected = await waitFor(
                () => statusLog.some( ( s ) => s.phase === 'running' ),
                5000
            );

            expect( connected ).to.equal( true );
            const running = statusLog.find( ( s ) => s.phase === 'running' );
            expect( running.status ).to.equal( 'green' );
            expect( running.connected ).to.equal( true );
        } );

        it( 'should receive messages from broker', async function () {
            const receivedMessages = [];
            const topic = `${TEST_TOPIC}/receive`;

            stopSource = createMQTTSourceClient( {
                brokerUrl: MQTT_BROKER_URL,
                topics: topic,
                onMessage: ( msg ) => receivedMessages.push( msg )
            } );

            // Wait for subscription
            await waitFor( () => stopSource._isSubscribed(), 5000 );

            // Publish a test message directly via mqtt.js
            const publisher = mqtt.connect( MQTT_BROKER_URL );
            await new Promise( ( resolve ) => publisher.on( 'connect', resolve ) );

            publisher.publish( topic, JSON.stringify( { test: 'value', num: 42 } ) );

            // Wait for message
            const received = await waitFor( () => receivedMessages.length > 0, 5000 );

            publisher.end();

            expect( received ).to.equal( true );
            expect( receivedMessages[ 0 ].test ).to.equal( 'value' );
            expect( receivedMessages[ 0 ].num ).to.equal( 42 );
        } );

    } );

    // ========================================================================
    // Emitter → Source Integration
    // ========================================================================

    describe( 'Emitter → Source Integration', function () {

        let emitter;
        let stopSource;
        let storePath;

        beforeEach( async function () {
            const uniqueId = `e2e-${Date.now()}-${Math.random().toString( 36 ).slice( 2, 8 )}`;
            storePath = path.join( os.tmpdir(), uniqueId );
        } );

        afterEach( async function () {
            if ( stopSource ) {
                await stopSource();
                stopSource = null;
            }

            if ( emitter ) {
                await emitter.shutdown();
                emitter = null;
            }

            if ( storePath ) {
                try {
                    await fs.rm( storePath, { recursive: true, force: true } );
                } catch {
                    // Ignore cleanup errors
                }
            }
        } );

        it( 'should receive messages sent by emitter', async function () {
            const receivedMessages = [];
            const topic = `${TEST_TOPIC}/emitter-test`;

            // Create source
            stopSource = createMQTTSourceClient( {
                brokerUrl: MQTT_BROKER_URL,
                topics: topic,
                codec: jsonCodec,
                onMessage: ( msg ) => receivedMessages.push( msg )
            } );

            // Wait for subscription
            await waitFor( () => stopSource._isSubscribed(), 5000 );

            // Create emitter
            emitter = await createEmitter( {
                brokerUrl: MQTT_BROKER_URL,
                codec: jsonCodec,
                storePath
            } );

            // Wait for emitter to connect
            await waitFor( () => emitter.getHealth().connected, 5000 );

            // Publish via emitter
            await emitter.publishNow( topic, { sensor: 'temp', value: 25.5 } );

            // Wait for message
            const received = await waitFor( () => receivedMessages.length > 0, 5000 );

            expect( received ).to.equal( true );
            expect( receivedMessages[ 0 ].sensor ).to.equal( 'temp' );
            expect( receivedMessages[ 0 ].value ).to.equal( 25.5 );
        } );

        it( 'should attach dedupId from emitter', async function () {
            const receivedMessages = [];
            const topic = `${TEST_TOPIC}/dedupid-test`;

            // Create source
            stopSource = createMQTTSourceClient( {
                brokerUrl: MQTT_BROKER_URL,
                topics: topic,
                codec: jsonCodec,
                onMessage: ( msg ) => receivedMessages.push( msg )
            } );

            await waitFor( () => stopSource._isSubscribed(), 5000 );

            // Create emitter
            emitter = await createEmitter( {
                brokerUrl: MQTT_BROKER_URL,
                codec: jsonCodec,
                storePath
            } );

            await waitFor( () => emitter.getHealth().connected, 5000 );

            // Publish — dedupId is generated internally and propagates via MQTT v5
            // user properties (winkDedupId). Per ADR-018 the publishNow
            // return is `{ ok: true }` with no per-message metadata; the receiver
            // side attaches `_dedupId` from the wire-level user property.
            emitter.publishNow( topic, { test: 1 } );

            // Wait for message
            await waitFor( () => receivedMessages.length > 0, 5000 );

            expect( receivedMessages[ 0 ]._dedupId ).to.match( /^[0-9a-f-]{36}$/ );
        } );

        it( 'should attach topic from wildcard subscription', async function () {
            const receivedMessages = [];
            const baseTopic = `${TEST_TOPIC}/wildcard`;

            // Create source with wildcard
            stopSource = createMQTTSourceClient( {
                brokerUrl: MQTT_BROKER_URL,
                topics: `${baseTopic}/+`,
                codec: jsonCodec,
                onMessage: ( msg ) => receivedMessages.push( msg )
            } );

            await waitFor( () => stopSource._isSubscribed(), 5000 );

            // Create emitter
            emitter = await createEmitter( {
                brokerUrl: MQTT_BROKER_URL,
                codec: jsonCodec,
                storePath
            } );

            await waitFor( () => emitter.getHealth().connected, 5000 );

            // Publish to specific subtopic
            await emitter.publishNow( `${baseTopic}/sensor1`, { id: 'sensor1' } );
            await emitter.publishNow( `${baseTopic}/sensor2`, { id: 'sensor2' } );

            // Wait for messages
            await waitFor( () => receivedMessages.length >= 2, 5000 );

            const topics = receivedMessages.map( ( m ) => m._topic );
            expect( topics ).to.include( `${baseTopic}/sensor1` );
            expect( topics ).to.include( `${baseTopic}/sensor2` );
        } );

    } );

    // ========================================================================
    // Deduplication E2E
    // ========================================================================

    describe( 'Deduplication E2E', function () {

        let stopSource;

        afterEach( async function () {
            if ( stopSource ) {
                await stopSource();
                stopSource = null;
            }
        } );

        it( 'should deduplicate messages with same winkDedupId', async function () {
            const receivedMessages = [];
            const topic = `${TEST_TOPIC}/dedup-e2e`;

            // Create source
            stopSource = createMQTTSourceClient( {
                brokerUrl: MQTT_BROKER_URL,
                topics: topic,
                onMessage: ( msg ) => receivedMessages.push( msg )
            } );

            await waitFor( () => stopSource._isSubscribed(), 5000 );

            // Publish same message twice with same dedupId via raw MQTT
            const publisher = mqtt.connect( MQTT_BROKER_URL, { protocolVersion: 5 } );
            await new Promise( ( resolve ) => publisher.on( 'connect', resolve ) );

            const dedupId = 'test-dedup-id-12345';
            const payload = JSON.stringify( { value: 1 } );
            const opts = {
                qos: 1,
                properties: {
                    userProperties: {
                        winkDedupId: dedupId,
                        winkTimestamp: Date.now().toString(),
                        winkVersion: '1.0'
                    }
                }
            };

            // Publish twice with same dedupId
            publisher.publish( topic, payload, opts );
            publisher.publish( topic, payload, opts );
            publisher.publish( topic, payload, opts );

            // Wait for processing
            await new Promise( ( r ) => setTimeout( r, 500 ) );

            publisher.end();

            // Should only receive one message; the two skips live in
            // the onMetrics counters, not on the status channel.
            expect( receivedMessages ).to.have.length( 1 );
            expect( stopSource._metrics().dedupHits ).to.equal( 2 );
        } );

        it( 'should process messages with different dedupIds', async function () {
            const receivedMessages = [];
            const topic = `${TEST_TOPIC}/dedup-diff`;

            // Create source
            stopSource = createMQTTSourceClient( {
                brokerUrl: MQTT_BROKER_URL,
                topics: topic,
                onMessage: ( msg ) => receivedMessages.push( msg )
            } );

            await waitFor( () => stopSource._isSubscribed(), 5000 );

            // Publish messages with different dedupIds
            const publisher = mqtt.connect( MQTT_BROKER_URL, { protocolVersion: 5 } );
            await new Promise( ( resolve ) => publisher.on( 'connect', resolve ) );

            for ( let i = 0; i < 5; i += 1 ) {
                const opts = {
                    qos: 1,
                    properties: {
                        userProperties: {
                            winkDedupId: `unique-id-${i}`,
                            winkTimestamp: Date.now().toString(),
                            winkVersion: '1.0'
                        }
                    }
                };
                publisher.publish( topic, JSON.stringify( { index: i } ), opts );
            }

            // Wait for all messages
            await waitFor( () => receivedMessages.length >= 5, 5000 );

            publisher.end();

            expect( receivedMessages ).to.have.length( 5 );
        } );

    } );

} );


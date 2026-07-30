// core/emitter-manager/mqtt/test/e2e-mqtt-cold-start.specs.js

/* eslint-disable no-process-env, no-await-in-loop, no-invalid-this, no-underscore-dangle */

/**
 * @fileoverview End-to-end cold-start pin: messages published the moment a
 * flow starts all reach the broker — with and without the first-connack
 * grace.
 *
 * This is the regression pin for the wire-time `sleep(240)` removal. That
 * sleep papered over a real 2025 loss: the old async disk store lost
 * QoS-1 messages published before the FIRST connack (ADR-021 has the
 * diagnosis; its synchronous memory store closed the gap). These tests
 * prove, against a real Mosquitto, that cold-start publishing is safe by
 * construction now:
 *  - with the default grace, the factory resolves already connected and
 *    immediate publishes flow straight through;
 *  - with the grace disabled, publishes racing the handshake buffer in
 *    the client and arrive complete (the fast-tier twin of the slow
 *    recovery spec's pre-connack test);
 *  - through the full flow API, wiring awaits the factory, so a source
 *    pushing from message one loses nothing.
 *
 * Requires a running Mosquitto (docker compose up -d); tests self-skip
 * when the broker is unreachable.
 */

import { expect } from 'chai';
import { describe, it, before, beforeEach, afterEach } from 'mocha';
import mqtt from 'mqtt';

import { createEmitter } from '../emitter.js';
import * as mqttEmitterModule from '../index.js';
import { jsonCodec } from '../../../codec/index.js';
import { ENV_VARS } from '../../../env-vars.js';
import { flow } from '../../../../composer.js';

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883';

/**
 * Probe the broker once; resolves true when reachable within 3 s.
 * Same shape as the source e2e's probe — availability check only,
 * no reconnect.
 *
 * @returns {Promise<boolean>}
 */
const isMosquittoAvailable = function () {
    return new Promise( function ( resolve ) {
        const client = mqtt.connect( MQTT_BROKER_URL, {
            connectTimeout: 3000,
            reconnectPeriod: 0
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
}; // isMosquittoAvailable()

/**
 * Poll until conditionFn returns true or maxWaitMs elapses.
 *
 * @param {Function} conditionFn - checked every checkInterval ms
 * @param {number} [maxWaitMs]
 * @param {number} [checkInterval]
 * @returns {Promise<boolean>} true when the condition was met in time
 */
const waitFor = async function ( conditionFn, maxWaitMs = 10000, checkInterval = 50 ) {
    const startTime = Date.now();
    while ( ( Date.now() - startTime ) < maxWaitMs ) {
        if ( conditionFn() ) {
            return true;
        }
        await new Promise( ( r ) => setTimeout( r, checkInterval ) );
    }
    return false;
}; // waitFor()

/**
 * Connect a QoS-1 subscriber and resolve once the subscription is
 * acknowledged, so nothing published afterwards can be missed. Collects
 * each payload's parsed JSON.
 *
 * @param {string} topicFilter - MQTT topic filter to subscribe to
 * @returns {Promise<{client: Object, received: Array}>}
 */
const subscribeAndCollect = function ( topicFilter ) {
    return new Promise( ( resolve, reject ) => {
        const received = [];
        const client = mqtt.connect( MQTT_BROKER_URL, { reconnectPeriod: 1000 } );
        client.on( 'message', ( topic, payload ) => {
            received.push( JSON.parse( payload.toString() ) );
        } );
        client.on( 'connect', () => {
            client.subscribe( topicFilter, { qos: 1 }, ( err ) => {
                if ( err ) {
                    reject( err );
                    return;
                }
                resolve( { client, received } );
            } );
        } );
    } );
}; // subscribeAndCollect()

describe( 'MQTT emitter E2E — cold start (grace + pre-connack pin)', function () {

    this.timeout( 30000 );

    let mosquittoAvailable = false;
    let activeEmitter = null;
    let activeSubscriber = null;
    let pipelineHandle = null;

    before( async function () {
        mosquittoAvailable = await isMosquittoAvailable();
        if ( !mosquittoAvailable ) {
            console.log( '  [SKIP] Mosquitto not available - skipping cold-start E2E tests' );
            console.log( '         Run: docker compose up -d' );
        }
    } );

    beforeEach( function () {
        if ( !mosquittoAvailable ) {
            this.skip();
        }
    } );

    afterEach( async function () {
        if ( pipelineHandle && pipelineHandle.shutdown ) {
            await pipelineHandle.shutdown();
            pipelineHandle = null;
        }
        if ( activeEmitter ) {
            await Promise.resolve( activeEmitter.shutdown() ).catch( () => undefined );
            activeEmitter = null;
        }
        if ( activeSubscriber ) {
            activeSubscriber.end( true );
            activeSubscriber = null;
        }
    } );

    it( 'default grace: the factory resolves connected; immediate publishes all arrive', async function () {
        const TOPIC = `coldstart/grace/${Date.now()}`;
        const TOTAL = 200;

        const captured = await subscribeAndCollect( TOPIC );
        activeSubscriber = captured.client;

        activeEmitter = await createEmitter( {
            brokerUrl: MQTT_BROKER_URL,
            codec: jsonCodec
        } );

        // The grace resolved on the real connack, not the budget.
        expect( activeEmitter.getHealth().connected ).to.equal( true );

        // Publish in a tight loop with ZERO delay — the exact pattern a
        // fast source produces at flow start.
        for ( let i = 0; i < TOTAL; i += 1 ) {
            const result = activeEmitter.publishNow( TOPIC, { _harnessId: i } );
            expect( result.ok, `publish #${i} must be accepted` ).to.equal( true );
        }

        const allReceived = await waitFor( () => captured.received.length >= TOTAL, 20000 );
        expect( allReceived, 'every immediate publish must reach the subscriber' ).to.equal( true );

        const ids = new Set( captured.received.map( ( m ) => m._harnessId ) );
        expect( ids.size, 'unique-id coverage must be complete' ).to.equal( TOTAL );
    } );

    it( 'grace disabled: publishes racing the handshake still all arrive — the 2025 loss stays shut', async function () {
        const TOPIC = `coldstart/nograce/${Date.now()}`;
        const TOTAL = 200;

        const captured = await subscribeAndCollect( TOPIC );
        activeSubscriber = captured.client;

        activeEmitter = createEmitter( {
            brokerUrl: MQTT_BROKER_URL,
            connectGraceMs: 0,
            codec: jsonCodec
        } );

        // Synchronous return: the handshake cannot have completed yet.
        expect( activeEmitter.getHealth().connected ).to.equal( false );

        for ( let i = 0; i < TOTAL; i += 1 ) {
            const result = activeEmitter.publishNow( TOPIC, { _harnessId: i } );
            expect( result.ok, `pre-connack publish #${i} must be accepted` ).to.equal( true );
        }

        const allReceived = await waitFor( () => captured.received.length >= TOTAL, 20000 );
        expect( allReceived, 'every pre-connack publish must reach the subscriber' ).to.equal( true );

        const ids = new Set( captured.received.map( ( m ) => m._harnessId ) );
        expect( ids.size, 'zero loss across the first connack' ).to.equal( TOTAL );
    } );

    it( 'full flow API: wiring awaits the grace; a source pushing from message one loses nothing', async function () {
        const TOTAL = 100;
        const runId = `coldstart-${Date.now()}`;

        // emit-if topics are `${edgeDeviceId}/${partitionId}/...`; the
        // wildcard plus the per-run runId filter keeps this robust
        // against other traffic on a shared broker.
        const captured = await subscribeAndCollect( `${ENV_VARS.edgeDeviceId}/#` );
        activeSubscriber = captured.client;

        pipelineHandle = await flow( 'cold-start-e2e' )
            .emitter( mqttEmitterModule, { brokerUrl: MQTT_BROKER_URL, codec: jsonCodec } )
            .assetId( 'id' )
            .emitIf( 'alert', ( _msg ) => true, { target: 'mqtt', insightType: 'log' } )
            .run();

        // Push from message one — no settling delay of any kind. The
        // removed sleep(240) is exactly the settling delay that used to
        // sit between run() and this loop.
        for ( let i = 0; i < TOTAL; i += 1 ) {
            const maybePromise = pipelineHandle.processMessage( { id: 'CS1', runId, seq: i } );
            if ( maybePromise instanceof Promise ) {
                await maybePromise;
            }
        }

        const mine = () => captured.received.filter( ( m ) => m.runId === runId );
        const allReceived = await waitFor( () => mine().length >= TOTAL, 20000 );
        expect( allReceived, 'every flow emission from message one must arrive' ).to.equal( true );

        const seqs = new Set( mine().map( ( m ) => m.seq ) );
        expect( seqs.size, 'sequence coverage must be complete' ).to.equal( TOTAL );
    } );

} );

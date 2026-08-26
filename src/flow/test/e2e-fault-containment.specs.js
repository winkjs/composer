// flow/test/e2e-fault-containment.specs.js

/* eslint-disable no-invalid-this, no-process-env */

/**
 * @fileoverview End-to-end dispatch-guard check on a real broker.
 *
 * Requires running Mosquitto (docker compose up -d, or brew services
 * start mosquitto). Skips itself when the broker is not reachable.
 *
 * The scenario the guard exists for: an unattended box on a live
 * feed receives one poison message mid-stream. Here the poison is
 * real wire data — a MessagePack payload whose int64-tagged field
 * decodes to a BigInt. The payload passes the source's shape guard
 * (it IS a record object), then throws inside esPairwiseCorrelation,
 * which assigns fields into a Float64Array before its finiteness
 * check can flag them. The flow must skip that one message, report
 * one red MESSAGE_HANDLER_FAILED, and keep processing the stream.
 */

import { expect } from 'chai';
import { describe, it, before, beforeEach, afterEach } from 'mocha';
import mqtt from 'mqtt';

import { flow } from '../../composer.js';
import * as mqttSource from '../../core/source-manager/mqtt/index.js';
import { msgpackCodec } from '../../core/codec/index.js';

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883';
const TEST_TOPIC = `wink-test/fault-containment/${Date.now()}`;

// Reachability probe, same shape as the other e2e suites: connect
// with a short timeout, no reconnect, and always close the probe.
const isMosquittoAvailable = function () {
    return new Promise( function ( resolve ) {
        const client = mqtt.connect( MQTT_BROKER_URL, {
            connectTimeout: 3000,
            reconnectPeriod: 0
        } );
        const timer = setTimeout( function () {
            client.end( true );
            resolve( false );
        }, 3000 );
        client.on( 'connect', function () {
            clearTimeout( timer );
            client.end( true );
            resolve( true );
        } );
        client.on( 'error', function () {
            clearTimeout( timer );
            client.end( true );
            resolve( false );
        } );
    } );
};

// Poll until `check()` returns true or the budget runs out.
const waitFor = function ( check, maxMs = 5000 ) {
    return new Promise( function ( resolve ) {
        const started = Date.now();
        const poll = setInterval( function () {
            if ( check() || ( ( Date.now() - started ) > maxMs ) ) {
                clearInterval( poll );
                resolve();
            }
        }, 25 );
    } );
};

describe( 'E2E — dispatch guard on a real broker', function () {

    let mosquittoUp = false;
    let handle = null;
    let publisher = null;

    before( async function () {
        this.timeout( 5000 );
        mosquittoUp = await isMosquittoAvailable();
        if ( !mosquittoUp ) {
            console.log( '  [SKIP] Mosquitto not available - skipping E2E fault-containment tests' );
        }
    } );

    beforeEach( function () {
        if ( !mosquittoUp ) {
            this.skip();
        }
    } );

    afterEach( async function () {
        if ( publisher ) {
            await new Promise( ( r ) => publisher.end( false, {}, r ) );
            publisher = null;
        }
        if ( handle ) {
            await handle.shutdown().catch( () => null );
            handle = null;
        }
    } );

    it( 'skips one wire-real poison message mid-stream and keeps detecting', async function () {
        this.timeout( 15000 );

        const statuses = [];
        let metrics = null;

        handle = await flow( 'e2eFaultContainment' )
            .source( mqttSource, {
                brokerUrl: MQTT_BROKER_URL,
                topics: TEST_TOPIC,
                codec: msgpackCodec,
                cleanStart: true,
                clientId: `wink-e2e-fault-${Date.now()}`,
                onStatus: ( s ) => statuses.push( s ),
                onMetrics: ( m ) => {
                    metrics = m;
                }
            } )
            .assetId( 'assetId' )
            .esPairwiseCorrelation( 'corr', [ 'a', 'b' ],
                { correlations: 'cv' },
                { minSamples: 2 } )
            .run();

        // Wait for the source to reach its running (subscribed) phase.
        await waitFor( () => statuses.some( ( s ) => s.phase === 'running' ) );

        publisher = mqtt.connect( MQTT_BROKER_URL, { reconnectPeriod: 0 } );
        await new Promise( ( r ) => publisher.on( 'connect', r ) );

        const publish = function ( obj ) {
            return new Promise( ( r ) => {
                publisher.publish( TEST_TOPIC, Buffer.from( msgpackCodec.pack( obj ) ), { qos: 1 }, r );
            } );
        };

        await publish( { assetId: 's1', a: 1.5, b: 2.5 } );
        // The poison: an int64-tagged field arrives as a BigInt.
        await publish( { assetId: 's1', a: 3n, b: 2.0 } );
        await publish( { assetId: 's1', a: 1.7, b: 2.4 } );
        await publish( { assetId: 's1', a: 1.9, b: 2.2 } );

        // All four messages were handed to the flow; one failed there.
        await waitFor( () => metrics && metrics.delivered >= 4 );
        expect( metrics.delivered ).to.equal( 4 );

        const reports = statuses.filter(
            ( s ) => s.error && s.error.code === 'MESSAGE_HANDLER_FAILED'
        );
        expect( reports ).to.have.length( 1 );
        expect( reports[ 0 ].status ).to.equal( 'red' );
        expect( reports[ 0 ].error.message ).to.contain( 'BigInt' );

        // Detection continued: no escalation, no terminal phase.
        expect( statuses.filter( ( s ) => s.phase === 'errored' ) ).to.have.length( 0 );
    } );

} );

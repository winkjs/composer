// core/source-manager/mqtt/test/lifecycle.specs.js

/* eslint-disable no-underscore-dangle, no-empty-function */

/**
 * @fileoverview MQTT source — connection, subscription, and reconnection.
 *
 * Covers the connect → subscribe path (QoS, structured status
 * payloads, subscription state tracking) and the offline / reconnect /
 * error event handling. The client maps mqtt.js events onto the status
 * reporter (status.js) — these tests pin the mapping; the reporter's
 * own rules are pinned in status*.specs.js. Uses sinon stubs to mock
 * mqtt.connect — no broker required.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createMQTTSourceClient } from '../client.js';
import { QOS, METRICS_INTERVAL_MS } from '../constants.js';
import { createMockClient } from './test-helpers.js';

describe( 'MQTT Source — Connection and Subscription', function () {

    let mockClient;
    let mockConnect;
    let statusLog;

    beforeEach( function () {
        mockClient = createMockClient();
        mockConnect = sinon.stub().returns( mockClient );
        statusLog = [];
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'emits the structured starting status at creation', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost:1883',
            topics: 'test/topic',
            onMessage: () => {},
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: mockConnect
        } );

        expect( statusLog ).to.have.length( 1 );
        expect( statusLog[ 0 ].status ).to.equal( 'green' );
        expect( statusLog[ 0 ].connected ).to.equal( false );
        expect( statusLog[ 0 ].phase ).to.equal( 'starting' );
    } );

    it( 'subscribes with QoS 1 on connect', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        mockClient._emit( 'connect' );

        expect( mockClient.subscribe.calledWith(
            sinon.match.array,
            { qos: QOS },
            sinon.match.func
        ) ).to.equal( true );
    } );

    it( 'emits green phase running once the subscription is acknowledged', function ( done ) {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: [ 'topic/one', 'topic/two' ],
            onMessage: () => {},
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: mockConnect
        } );

        mockClient._emit( 'connect' );

        setImmediate( function () {
            const running = statusLog.filter( ( s ) => s.phase === 'running' );
            expect( running ).to.have.length( 1 );
            expect( running[ 0 ].status ).to.equal( 'green' );
            expect( running[ 0 ].connected ).to.equal( true );
            done();
        } );
    } );

    it( 'emits red SUBSCRIBE_FAILED when the broker refuses the subscription', function ( done ) {
        mockClient.subscribe.callsFake( function ( topics, opts, cb ) {
            if ( cb ) {
                setImmediate( () => cb( new Error( 'not authorised' ) ) );
            }
        } );

        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: mockConnect
        } );

        mockClient._emit( 'connect' );

        setImmediate( function () {
            const reds = statusLog.filter( ( s ) => s.status === 'red' );
            expect( reds ).to.have.length( 1 );
            expect( reds[ 0 ].error.code ).to.equal( 'SUBSCRIBE_FAILED' );
            expect( reds[ 0 ].error.message ).to.equal( 'not authorised' );
            expect( reds[ 0 ].connected ).to.equal( true );
            done();
        } );
    } );

    it( 'tracks subscription state', function ( done ) {
        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        expect( stop._isSubscribed() ).to.equal( false );

        mockClient._emit( 'connect' );

        setImmediate( function () {
            expect( stop._isSubscribed() ).to.equal( true );
            done();
        } );
    } );

    it( 'resets subscription state on offline', function ( done ) {
        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        mockClient._emit( 'connect' );

        setImmediate( function () {
            expect( stop._isSubscribed() ).to.equal( true );

            mockClient._emit( 'offline' );
            expect( stop._isSubscribed() ).to.equal( false );
            done();
        } );
    } );

} );

describe( 'MQTT Source — Reconnection', function () {

    let mockClient;
    let mockConnect;
    let statusLog;

    beforeEach( function () {
        mockClient = createMockClient();
        mockConnect = sinon.stub().returns( mockClient );
        statusLog = [];
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'emits yellow phase offline with connected false on disconnect', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: mockConnect
        } );

        mockClient._emit( 'offline' );

        const offlines = statusLog.filter( ( s ) => s.phase === 'offline' );
        expect( offlines ).to.have.length( 1 );
        expect( offlines[ 0 ].status ).to.equal( 'yellow' );
        expect( offlines[ 0 ].connected ).to.equal( false );
    } );

    it( 'emits yellow phase reconnecting on a reconnect attempt', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: mockConnect
        } );

        mockClient._emit( 'reconnect' );

        const reconnecting = statusLog.filter( ( s ) => s.phase === 'reconnecting' );
        expect( reconnecting ).to.have.length( 1 );
        expect( reconnecting[ 0 ].status ).to.equal( 'yellow' );
    } );

    it( 'attaches CONNECT_FAILED when the transport reports an error', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: mockConnect
        } );

        mockClient._emit( 'error', new Error( 'connect ECONNREFUSED' ) );

        const withError = statusLog.filter( ( s ) => s.error );
        expect( withError ).to.have.length( 1 );
        expect( withError[ 0 ].status ).to.equal( 'yellow' );
        expect( withError[ 0 ].error.code ).to.equal( 'CONNECT_FAILED' );
        expect( withError[ 0 ].error.message ).to.equal( 'connect ECONNREFUSED' );
    } );

} );

describe( 'MQTT Source — health/metrics cadence timer', function () {

    let mockClient;
    let mockConnect;
    let fakeTimers;

    beforeEach( function () {
        mockClient = createMockClient();
        mockConnect = sinon.stub().returns( mockClient );
        // Fake only the interval machinery — setImmediate stays real
        // for the mock client's subscribe/end callbacks.
        fakeTimers = sinon.useFakeTimers( {
            toFake: [ 'setInterval', 'clearInterval' ]
        } );
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'emits onMetrics once per METRICS_INTERVAL_MS', function () {
        const metrics = [];
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            onMetrics: ( m ) => metrics.push( m ),
            mqttConnectFn: mockConnect
        } );
        // The starting transition emits one snapshot at creation —
        // baseline past it; the cadence is what this test pins.
        const baseline = metrics.length;

        fakeTimers.tick( METRICS_INTERVAL_MS * 3 );

        expect( metrics.length ).to.equal( baseline + 3 );
        expect( metrics[ 0 ] ).to.have.all.keys(
            'delivered', 'skipped', 'decodeErrors', 'reconnects',
            'dedupHits', 'dedupMisses', 'dedupBypassed', 'dedupCacheSize'
        );
    } );

    it( 'stop() clears the cadence timer', async function () {
        const metrics = [];
        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            onMetrics: ( m ) => metrics.push( m ),
            mqttConnectFn: mockConnect
        } );

        await stop();
        const after = metrics.length;

        fakeTimers.tick( METRICS_INTERVAL_MS * 5 );

        expect( metrics.length ).to.equal( after );
    } );

    it( 'exposes the counter snapshot via stop._metrics for tests and soaks', function () {
        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        const snap = stop._metrics();

        expect( snap ).to.deep.equal( {
            delivered: 0,
            skipped: 0,
            decodeErrors: 0,
            reconnects: 0,
            dedupHits: 0,
            dedupMisses: 0,
            dedupBypassed: 0,
            dedupCacheSize: 0
        } );
    } );

} );

// core/source-manager/mqtt/test/shutdown.specs.js

/* eslint-disable no-underscore-dangle, no-empty-function */

/**
 * @fileoverview MQTT source — graceful shutdown.
 *
 * Covers the `stopFn({ timeout })` contract: Promise return,
 * client.end invocation, status logging, graceful-close default
 * (force=false), and the forced-close fallback when graceful close
 * exceeds the timeout. Split from the original client.specs.js;
 * assertions unchanged. Uses sinon stubs to mock mqtt.connect — no
 * broker required.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createMQTTSourceClient } from '../client.js';
import { createMockClient } from './test-helpers.js';

describe( 'MQTT Source — Shutdown', function () {

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

    it( 'stop() returns a Promise', function () {
        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        const result = stop();
        expect( result ).to.be.instanceOf( Promise );
    } );

    it( 'stop() calls client.end', async function () {
        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        await stop();

        expect( mockClient.end.calledOnce ).to.equal( true );
    } );

    it( 'stop() emits green phase stopped with connected false', async function () {
        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: mockConnect
        } );

        await stop();

        const stops = statusLog.filter( ( s ) => s.phase === 'stopped' );
        expect( stops ).to.have.length( 1 );
        expect( stops[ 0 ].status ).to.equal( 'green' );
        expect( stops[ 0 ].connected ).to.equal( false );
        expect( 'note' in stops[ 0 ] ).to.equal( false );
    } );

    it( 'exposes client for testing', function () {
        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        expect( stop._client ).to.equal( mockClient );
    } );

    // Per ADR-018, source stop accepts `{ timeout }` and races
    // graceful close against the timeout. On timeout, calls
    // `client.end(true)` (forced) instead of `client.end(false)`
    // (graceful) so the flow's drain cannot hang.
    it( 'stop() accepts { timeout } and uses graceful close (force=false) by default', async function () {
        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        await stop( { timeout: 5000 } );

        // First call to client.end uses force=false (graceful).
        const firstCall = mockClient.end.firstCall;
        expect( firstCall.args[ 0 ] ).to.equal( false );
    } );

    it( 'stop() force-closes (client.end with force=true) when graceful exceeds timeout', async function () {
        // Mock client.end to never invoke its callback for the first
        // (graceful) call so the timeout can fire. The second (forced)
        // call is allowed to invoke its callback so the Promise resolves.
        const slowClient = {
            on: sinon.stub().callsFake( function () {} ),
            subscribe: sinon.stub(),
            end: sinon.stub().callsFake( function ( force, opts, cb ) {
                if ( force === true && cb ) {
                    setImmediate( cb );
                }
                // force === false: never invoke callback (simulates wedge)
            } )
        };
        const slowConnect = sinon.stub().returns( slowClient );

        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: slowConnect
        } );

        const stopStart = Date.now();
        await stop( { timeout: 50 } );
        const stopElapsed = Date.now() - stopStart;

        // First call (graceful, force=false) was issued.
        expect( slowClient.end.firstCall.args[ 0 ] ).to.equal( false );
        // Second call (forced, force=true) fired after timeout.
        expect( slowClient.end.secondCall.args[ 0 ] ).to.equal( true );
        // Timeout fired roughly when expected, not hung.
        expect( stopElapsed ).to.be.at.least( 45 );
        expect( stopElapsed ).to.be.lessThan( 1000 );
        // The forced stop is reported with the sources' shared `note`
        // convention: yellow, phase stopped, wording matches CSV.
        const forced = statusLog.filter( ( s ) => s.phase === 'stopped' );
        expect( forced ).to.have.length( 1 );
        expect( forced[ 0 ].status ).to.equal( 'yellow' );
        expect( forced[ 0 ].note ).to.equal( 'Stop took longer than 50ms — forced.' );
    } );

    it( 'a late graceful close after the forced close settles once — no double status, no double resolve', async function () {
        // The real race: the broker completes the graceful close AFTER
        // the force timer already closed the socket. Both callbacks
        // fire; the stop must settle exactly once.
        let gracefulCb = null;
        const racyClient = {
            on: sinon.stub().callsFake( function () {} ),
            subscribe: sinon.stub(),
            end: sinon.stub().callsFake( function ( force, opts, cb ) {
                if ( force === true && cb ) {
                    setImmediate( cb );
                } else {
                    gracefulCb = cb;  // held back; fired late below
                }
            } )
        };
        const racyConnect = sinon.stub().returns( racyClient );

        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: racyConnect
        } );

        await stop( { timeout: 20 } );

        // The graceful close completes late — after settle.
        gracefulCb();
        await new Promise( ( r ) => setImmediate( r ) );

        const stops = statusLog.filter( ( s ) => s.phase === 'stopped' );
        expect( stops ).to.have.length( 1 );
        expect( stops[ 0 ].note ).to.contain( 'forced' );
    } );

} );

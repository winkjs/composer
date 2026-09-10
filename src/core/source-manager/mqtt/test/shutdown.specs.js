// core/source-manager/mqtt/test/shutdown.specs.js

/* eslint-disable no-underscore-dangle, no-empty-function */

/**
 * @fileoverview MQTT source — the `stopFn( { timeout } )` contract on
 * the mock client.
 *
 * The mock models the library's `disconnecting` latch (mqtt.js 5.15.1,
 * `client.js:731-734`): a second `end()` only invokes its callback. So
 * these cases assert what actually detaches the socket: `end( true )`
 * when the client is not connected, and `stream.destroy()` from the
 * timer when a graceful close hangs. Timers are faked; `setImmediate`
 * stays real for the mock's callbacks. The same shapes are proven on
 * the real client in `shutdown-detach.specs.js`.
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
    let fakeTimers;

    const makeSource = function ( client ) {
        mockConnect = sinon.stub().returns( client );
        return createMQTTSourceClient( {
            brokerUrl: 'mqtt://127.0.0.1',
            topics: 'test/topic',
            onMessage: () => {},
            onStatus: ( s ) => statusLog.push( s ),
            mqttConnectFn: mockConnect
        } );
    }; // makeSource()

    const stopsReported = function () {
        return statusLog.filter( ( s ) => s.phase === 'stopped' );
    }; // stopsReported()

    const oneImmediateTurn = function () {
        return new Promise( ( r ) => setImmediate( r ) );
    }; // oneImmediateTurn()

    beforeEach( function () {
        mockClient = createMockClient();
        statusLog = [];
        fakeTimers = sinon.useFakeTimers( {
            toFake: [ 'setTimeout', 'clearTimeout' ]
        } );
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'stop() returns a Promise', function () {
        const stop = makeSource( mockClient );

        const result = stop();
        expect( result ).to.be.instanceOf( Promise );
    } );

    it( 'exposes client for testing', function () {
        const stop = makeSource( mockClient );

        expect( stop._client ).to.equal( mockClient );
    } );

    it( 'not connected: stop() forces the close at once, arms no timer, and reports a clean stop', async function () {
        const stop = makeSource( mockClient );

        await stop( { timeout: 5000 } );

        expect( mockClient.end.calledOnce ).to.equal( true );
        expect( mockClient.end.firstCall.args[ 0 ] ).to.equal( true );
        expect( mockClient.stream.destroyed ).to.equal( true );
        // The source never reaches for the stream itself here: the
        // forced end is what destroys it.
        expect( mockClient.stream.destroy.called ).to.equal( false );
        expect( fakeTimers.countTimers() ).to.equal( 0 );

        const stops = stopsReported();
        expect( stops ).to.have.length( 1 );
        expect( stops[ 0 ].status ).to.equal( 'green' );
        expect( stops[ 0 ].connected ).to.equal( false );
        expect( 'note' in stops[ 0 ] ).to.equal( false );
    } );

    it( 'connected: stop() closes gracefully, clears its timer, and reports a clean stop', async function () {
        const stop = makeSource( mockClient );
        mockClient._emit( 'connect' );

        await stop( { timeout: 5000 } );

        expect( mockClient.end.calledOnce ).to.equal( true );
        expect( mockClient.end.firstCall.args[ 0 ] ).to.equal( false );
        expect( mockClient.stream.destroy.called ).to.equal( false );
        expect( fakeTimers.countTimers() ).to.equal( 0 );

        const stops = stopsReported();
        expect( stops ).to.have.length( 1 );
        expect( stops[ 0 ].status ).to.equal( 'green' );
        expect( 'note' in stops[ 0 ] ).to.equal( false );
    } );

    it( 'the link dropped before stop(): the forced close is taken at once', async function () {
        const stop = makeSource( mockClient );
        mockClient._emit( 'connect' );
        mockClient._emit( 'offline' );

        await stop( { timeout: 5000 } );

        expect( mockClient.end.calledOnce ).to.equal( true );
        expect( mockClient.end.firstCall.args[ 0 ] ).to.equal( true );
        expect( fakeTimers.countTimers() ).to.equal( 0 );
        expect( stopsReported()[ 0 ].status ).to.equal( 'green' );
    } );

    it( 'connected and the graceful close hangs: the timer destroys the stream, makes no second end() call, and reports the forced stop', async function () {
        const hungClient = createMockClient( { hangOnEnd: true } );
        const stop = makeSource( hungClient );
        hungClient._emit( 'connect' );

        const pending = stop( { timeout: 50 } );
        expect( hungClient.stream.destroyed ).to.equal( false );

        fakeTimers.tick( 50 );
        await pending;

        expect( hungClient.stream.destroy.calledOnce ).to.equal( true );
        expect( hungClient.stream.destroyed ).to.equal( true );
        // One end() call, the graceful one. A second call would be a
        // no-op behind the library's latch, so the source does not
        // make it.
        expect( hungClient.end.calledOnce ).to.equal( true );
        expect( hungClient.end.firstCall.args[ 0 ] ).to.equal( false );

        // The forced stop is reported with the sources' shared `note`
        // convention: yellow, phase stopped, wording matches CSV.
        const stops = stopsReported();
        expect( stops ).to.have.length( 1 );
        expect( stops[ 0 ].status ).to.equal( 'yellow' );
        expect( stops[ 0 ].connected ).to.equal( false );
        expect( stops[ 0 ].note ).to.equal( 'Stop took longer than 50ms — forced.' );
    } );

    it( 'the late graceful callback after the destroy settles nothing — one status, one resolve', async function () {
        const hungClient = createMockClient( { hangOnEnd: true } );
        const stop = makeSource( hungClient );
        hungClient._emit( 'connect' );

        const pending = stop( { timeout: 20 } );
        fakeTimers.tick( 20 );
        await pending;

        // The mock's destroy() fires the hung graceful callback on the
        // next immediate turn, as the library's `close` event would.
        await oneImmediateTurn();

        const stops = stopsReported();
        expect( stops ).to.have.length( 1 );
        expect( stops[ 0 ].note ).to.contain( 'forced' );
    } );

    it( 'a second stop() returns the first promise and adds no report', async function () {
        const hungClient = createMockClient( { hangOnEnd: true } );
        const stop = makeSource( hungClient );
        hungClient._emit( 'connect' );

        const first = stop( { timeout: 30 } );
        const second = stop( { timeout: 30 } );
        expect( second ).to.equal( first );

        fakeTimers.tick( 30 );
        await first;
        await oneImmediateTurn();

        expect( hungClient.end.calledOnce ).to.equal( true );
        expect( stopsReported() ).to.have.length( 1 );

        // After settle, a third call still returns the same promise.
        expect( stop() ).to.equal( first );
    } );

} );

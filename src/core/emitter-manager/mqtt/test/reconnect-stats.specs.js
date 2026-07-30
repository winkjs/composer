// core/emitter-manager/mqtt/test/reconnect-stats.specs.js

/**
 * @fileoverview MQTT emitter — the `reconnects` counter in
 * `getHealth().stats`.
 *
 * The release-soak signature policy (`core/test-utils/soak-signature.js`)
 * needs "a mid-run reconnect was present" as an observable fact.
 * mqtt.js fires 'connect' on EVERY connack, including the first; only
 * the later ones are reconnects.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createEmitter } from '../emitter.js';
import { makeMockClient, testCodec } from './test-helpers.js';

describe( 'mqtt emitter — reconnects counter', function () {

    let mock;
    let emitter;

    beforeEach( function () {
        mock = makeMockClient();
    } );

    afterEach( async function () {
        if ( emitter ) {
            await emitter.shutdown().catch( () => null );
            emitter = null;
        }
        sinon.restore();
    } );

    it( 'counts reconnects — the first connect is not a reconnect', function () {
        emitter = createEmitter( {
            brokerUrl: 'mqtt://localhost',
            connectGraceMs: 0,
            codec: testCodec,
            mqttConnectFn: sinon.stub().returns( mock.client )
        } );

        expect( emitter.getHealth().stats.reconnects ).to.equal( 0 );

        mock.eventHandlers.connect();
        expect( emitter.getHealth().stats.reconnects ).to.equal( 0 );

        mock.eventHandlers.offline();
        mock.eventHandlers.connect();
        expect( emitter.getHealth().stats.reconnects ).to.equal( 1 );

        mock.eventHandlers.offline();
        mock.eventHandlers.connect();
        expect( emitter.getHealth().stats.reconnects ).to.equal( 2 );
    } );

    it( 'counts a reconnect even without an offline event in between', function () {
        // mqtt.js can complete a reconnect cycle where the client sees
        // two connacks without the 'offline' event firing in between
        // (fast broker restart). The counter keys on connacks after the
        // first, not on offline transitions.
        emitter = createEmitter( {
            brokerUrl: 'mqtt://localhost',
            connectGraceMs: 0,
            codec: testCodec,
            mqttConnectFn: sinon.stub().returns( mock.client )
        } );

        mock.eventHandlers.connect();
        mock.eventHandlers.connect();
        expect( emitter.getHealth().stats.reconnects ).to.equal( 1 );
    } );

} );

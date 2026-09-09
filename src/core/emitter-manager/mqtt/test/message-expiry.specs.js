// core/emitter-manager/mqtt/test/message-expiry.specs.js

/**
 * @fileoverview MQTT emitter — the per-message expiry lookup.
 *
 * `options.type` selects a row of `MESSAGE_EXPIRY`. The table is a
 * dictionary indexed by a caller-supplied key, so it must have no
 * prototype. Before the fix, `options.type = 'constructor'` resolved
 * to `Object`, a function, and mqtt-packet destroyed the stream with
 * an error that carries no `code`. mqtt.js swallows such an error, so
 * no handler saw it, and the poison packet replayed on every reconnect.
 * Every later message was lost (the infrastructure review of
 * 2026-09-08, reproduced against a live broker).
 *
 * The rule under test (ADR-018 §1.9): one message with a strange
 * option costs at most that message, never the connection. Here it
 * costs nothing: an unknown or prototype key falls back to the
 * default expiry, and the packet goes out with a number.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';

import { createEmitter } from '../emitter.js';
import { MESSAGE_EXPIRY } from '../constants.js';
import { makeMockClient, fireConnect, testCodec } from './test-helpers.js';

describe( 'mqtt emitter — message expiry lookup', function () {

    let mock;
    let emitter;

    beforeEach( async function () {
        mock = makeMockClient();
        emitter = await createEmitter( {
            brokerUrl: 'mqtt://127.0.0.1',
            connectGraceMs: 0,
            codec: testCodec,
            mqttConnectFn: () => mock.client
        } );
        fireConnect( mock.eventHandlers );
    } );

    afterEach( async function () {
        await emitter.shutdown( { timeout: 100 } ).catch( () => undefined );
    } );

    const expiryOfPublish = function ( options ) {
        const result = emitter.publishNow( 'wink/x', { v: 1 }, options );
        expect( result ).to.deep.equal( { ok: true } );
        const call = mock.publishCalls[ mock.publishCalls.length - 1 ];
        return call.opts.properties.messageExpiryInterval;
    }; // expiryOfPublish()

    it( 'the table has no prototype, so no caller key can reach Object.prototype', function () {
        expect( Object.getPrototypeOf( MESSAGE_EXPIRY ) ).to.equal( null );
        expect( Object.keys( MESSAGE_EXPIRY ) ).to.have.members( [ 'telemetry', 'status', 'default' ] );
    } );

    it( 'a prototype key falls back to the default expiry and the packet carries a number', function () {
        const prototypeKeys = [ 'constructor', '__proto__', 'toString', 'hasOwnProperty' ];

        for ( const key of prototypeKeys ) {
            const expiry = expiryOfPublish( { type: key } );
            expect( typeof expiry, `type: ${key}` ).to.equal( 'number' );
            expect( expiry, `type: ${key}` ).to.equal( MESSAGE_EXPIRY.default );
        }
        expect( emitter.getHealth().stats.unacked ).to.equal( prototypeKeys.length );
    } );

    it( 'the two configured keys select their rows', function () {
        expect( expiryOfPublish( { type: 'telemetry' } ) ).to.equal( 3600 );
        expect( expiryOfPublish( { type: 'status' } ) ).to.equal( 86400 );
    } );

    it( 'no options, an empty options object, and an unknown key all use the default', function () {
        expect( expiryOfPublish( undefined ) ).to.equal( MESSAGE_EXPIRY.default );
        expect( expiryOfPublish( {} ) ).to.equal( MESSAGE_EXPIRY.default );
        expect( expiryOfPublish( { type: 'no-such-type' } ) ).to.equal( MESSAGE_EXPIRY.default );
    } );

} );

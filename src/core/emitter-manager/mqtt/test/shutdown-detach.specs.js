// core/emitter-manager/mqtt/test/shutdown-detach.specs.js

/**
 * @fileoverview MQTT emitter — shutdown detaches the transport, proven
 * against the real mqtt.js client and an in-process fake broker.
 *
 * The mock-based drain specs pin the drain arithmetic. They cannot pin
 * the one fact this file exists for: in mqtt.js 5.15.1 a second
 * `end()` returns at once once the first set `disconnecting`
 * (`client.js:731-734`). Before the fix, the force step called
 * `end( true )` from a timer after a graceful `end( false )`, so the
 * socket, the keepalive timer, and the library's wait for an empty
 * outgoing map all survived a settled `shutdown()`. In a headless
 * flow the process could not exit on its own (the infrastructure
 * review of 2026-09-08, `probe-mqtt-emitter-shutdown-force.txt`).
 *
 * The fake broker speaks just enough MQTT 5: it answers CONNECT with
 * CONNACK, optionally answers PUBLISH with PUBACK, and never closes
 * its side. It listens with `allowHalfOpen`, so a client half-close
 * after DISCONNECT gets no FIN back, which is what a hung broker
 * looks like on the wire. No external service is involved.
 *
 * Two shapes are pinned (ADR-018 §7, the detach at the deadline):
 * - the broker never acknowledges: shutdown rejects with the exact
 *   count and the stream is destroyed at once;
 * - the broker acknowledges and then hangs the DISCONNECT: shutdown
 *   resolves clean after the close budget, and the stream is
 *   destroyed by the timer.
 */

import net from 'node:net';
import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import mqtt from 'mqtt';

import { createEmitter } from '../emitter.js';
import { testCodec } from './test-helpers.js';

/** CONNACK, MQTT 5: session present 0, reason code 0, no properties. */
const CONNACK_V5 = Buffer.from( [ 0x20, 0x03, 0x00, 0x00, 0x00 ] );

const PACKET_CONNECT = 1;
const PACKET_PUBLISH = 3;

const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );

/**
 * Splits one TCP chunk into MQTT control packets: the type from the
 * fixed header, then the body behind the variable-length remaining
 * length. The packets in this spec are small and arrive whole, so a
 * packet never spans two chunks here.
 *
 * @param {Buffer} buf - One chunk from the socket
 * @returns {Array<{type: number, body: Buffer}>}
 */
const framePackets = function ( buf ) {
    const packets = [];
    let offset = 0;
    while ( offset < buf.length ) {
        // The packet type is the high nibble of the first byte. The
        // remaining length is base 128, low group first, with the high
        // bit of each byte saying another byte follows.
        const type = Math.floor( buf[ offset ] / 16 );
        let multiplier = 1;
        let remaining = 0;
        let pos = offset + 1;
        let byte = 128;
        while ( byte >= 128 ) {
            byte = buf[ pos ];
            remaining += ( byte % 128 ) * multiplier;
            multiplier *= 128;
            pos += 1;
        }
        packets.push( { type, body: buf.subarray( pos, pos + remaining ) } );
        offset = pos + remaining;
    }
    return packets;
}; // framePackets()

/**
 * Builds the PUBACK for a QoS-1 PUBLISH body: the packet id follows
 * the topic. A two-byte remaining length means reason code 0.
 *
 * @param {Buffer} body - The PUBLISH body
 * @returns {Buffer}
 */
const pubackFor = function ( body ) {
    const topicLength = body.readUInt16BE( 0 );
    const packetId = body.readUInt16BE( 2 + topicLength );
    return Buffer.from( [ 0x40, 0x02, Math.floor( packetId / 256 ), packetId % 256 ] );
}; // pubackFor()

/**
 * Starts the fake broker on a free port.
 *
 * @param {Object} options
 * @param {boolean} options.acks - Whether PUBLISH gets a PUBACK
 * @returns {Promise<{server: Object, sockets: Array, port: number}>}
 */
const startFakeBroker = function ( { acks } ) {
    const sockets = [];
    const server = net.createServer( { allowHalfOpen: true }, ( sock ) => {
        sockets.push( sock );
        sock.on( 'data', ( buf ) => {
            for ( const packet of framePackets( buf ) ) {
                if ( packet.type === PACKET_CONNECT ) {
                    sock.write( CONNACK_V5 );
                } else if ( packet.type === PACKET_PUBLISH && acks ) {
                    sock.write( pubackFor( packet.body ) );
                }
                // DISCONNECT and everything else: ignored. The broker
                // never closes its side.
            }
        } );
        sock.on( 'error', () => undefined );
    } );
    return new Promise( ( resolve ) => {
        server.listen( 0, '127.0.0.1', () => {
            resolve( { server, sockets, port: server.address().port } );
        } );
    } );
}; // startFakeBroker()

/** Polls a condition every 10 ms, up to a budget. */
const until = async function ( condition, budgetMs ) {
    const deadline = Date.now() + budgetMs;
    while ( !condition() && Date.now() < deadline ) {
        // eslint-disable-next-line no-await-in-loop
        await sleep( 10 );
    }
    return condition();
}; // until()

describe( 'mqtt emitter — shutdown detaches the transport (fake broker)', function () {

    let broker = null;
    let client = null;
    let emitter = null;

    const makeEmitter = function ( port ) {
        return createEmitter( {
            brokerUrl: `mqtt://127.0.0.1:${port}`,
            codec: testCodec,
            connectGraceMs: 2000,
            mqttConnectFn: ( url, opts ) => {
                client = mqtt.connect( url, opts );
                return client;
            }
        } );
    }; // makeEmitter()

    afterEach( async function () {
        if ( emitter ) {
            await Promise.resolve( emitter.shutdown( { timeout: 50 } ) ).catch( () => undefined );
            emitter = null;
        }
        if ( client && client.stream && !client.stream.destroyed ) {
            client.stream.destroy();
        }
        client = null;
        if ( broker ) {
            broker.sockets.forEach( ( sock ) => sock.destroy() );
            await new Promise( ( resolve ) => broker.server.close( resolve ) );
            broker = null;
        }
    } );

    it( 'a broker that never acknowledges: shutdown rejects with the count and destroys the stream at once', async function () {
        broker = await startFakeBroker( { acks: false } );
        emitter = await makeEmitter( broker.port );
        expect( emitter.getHealth().connected ).to.equal( true );

        expect( emitter.publishNow( 'wink/a', { v: 1 } ).ok ).to.equal( true );
        await sleep( 50 );
        expect( emitter.getHealth().stats.unacked ).to.equal( 1 );

        // A half-open server sees the client's FIN as 'end' and a reset
        // as 'error'; either means the link went down on the wire.
        const brokerSawClose = new Promise( ( resolve ) => {
            broker.sockets[ 0 ].once( 'end', resolve );
            broker.sockets[ 0 ].once( 'error', resolve );
            broker.sockets[ 0 ].once( 'close', resolve );
        } );

        let thrown = null;
        await emitter.shutdown( { timeout: 300 } ).catch( ( err ) => {
            thrown = err;
        } );

        expect( thrown ).to.be.an( 'error' );
        expect( thrown.code ).to.equal( 'SHUTDOWN_TIMEOUT' );
        expect( thrown.dropped ).to.deep.equal( { count: 1 } );
        expect( client.stream.destroyed, 'the client stream must be destroyed' ).to.equal( true );

        const closed = await Promise.race( [ brokerSawClose.then( () => true ), sleep( 1000 ).then( () => false ) ] );
        expect( closed, 'the broker side must see the close within a second' ).to.equal( true );
    } );

    it( 'a broker that acknowledges and hangs the DISCONNECT: shutdown resolves clean and the timer destroys the stream', async function () {
        broker = await startFakeBroker( { acks: true } );
        emitter = await makeEmitter( broker.port );

        expect( emitter.publishNow( 'wink/a', { v: 1 } ).ok ).to.equal( true );
        const acked = await until( () => emitter.getHealth().stats.unacked === 0, 500 );
        expect( acked, 'the fake broker acknowledges the publish' ).to.equal( true );

        const started = Date.now();
        await emitter.shutdown( { timeout: 400 } );
        const elapsed = Date.now() - started;

        // The drain had nothing to wait for, so the whole budget was the
        // close budget, and the broker hung the DISCONNECT for all of it.
        expect( elapsed ).to.be.at.least( 300 );
        expect( elapsed ).to.be.below( 1500 );
        expect( client.stream.destroyed, 'the timer must destroy the stream' ).to.equal( true );
    } );

} );

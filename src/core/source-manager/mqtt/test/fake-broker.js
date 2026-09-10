// core/source-manager/mqtt/test/fake-broker.js

/**
 * @fileoverview A fake MQTT broker for the source's detach specs.
 *
 * It speaks just enough MQTT 5. It answers CONNECT with CONNACK and
 * SUBSCRIBE with SUBACK, each only when asked to. It ignores every
 * other packet, DISCONNECT included, and never closes its side. It
 * listens with `allowHalfOpen`, so the client's FIN after DISCONNECT
 * gets no FIN back. That is what a hung broker looks like on the
 * wire. No external service is involved.
 *
 * The emitter's `shutdown-detach.specs.js` carries the same fake for
 * its own legs; this one adds SUBACK because a source subscribes.
 */

import net from 'node:net';

/** CONNACK, MQTT 5: session present 0, reason code 0, no properties. */
const CONNACK_V5 = Buffer.from( [ 0x20, 0x03, 0x00, 0x00, 0x00 ] );

const PACKET_CONNECT = 1;
const PACKET_SUBSCRIBE = 8;

/**
 * Splits one TCP chunk into MQTT control packets: the type from the
 * fixed header, then the body behind the variable-length remaining
 * length. The packets in these specs are small and arrive whole, so a
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
 * Builds the SUBACK for a SUBSCRIBE body: the packet id is its first
 * two bytes. No properties, and one reason code, 1 = granted QoS 1.
 *
 * @param {Buffer} body - The SUBSCRIBE body
 * @returns {Buffer}
 */
const subackFor = function ( body ) {
    return Buffer.from( [ 0x90, 0x04, body[ 0 ], body[ 1 ], 0x00, 0x01 ] );
}; // subackFor()

/**
 * Starts the fake broker on a free port.
 *
 * @param {Object} [options]
 * @param {boolean} [options.connack=true] - Whether CONNECT gets a CONNACK
 * @param {boolean} [options.suback=true] - Whether SUBSCRIBE gets a SUBACK
 * @returns {Promise<{server: Object, sockets: Array, port: number}>}
 */
export const startFakeBroker = function ( { connack = true, suback = true } = {} ) {
    const sockets = [];
    const server = net.createServer( { allowHalfOpen: true }, ( sock ) => {
        sockets.push( sock );
        sock.on( 'data', ( buf ) => {
            for ( const packet of framePackets( buf ) ) {
                if ( ( packet.type === PACKET_CONNECT ) && connack ) {
                    sock.write( CONNACK_V5 );
                } else if ( ( packet.type === PACKET_SUBSCRIBE ) && suback ) {
                    sock.write( subackFor( packet.body ) );
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

/**
 * Releases the fake broker: destroys every accepted socket, then
 * closes the listener.
 *
 * @param {Object} broker - The object `startFakeBroker` resolved
 * @returns {Promise<void>}
 */
export const stopFakeBroker = function ( broker ) {
    broker.sockets.forEach( ( sock ) => sock.destroy() );
    return new Promise( ( resolve ) => broker.server.close( resolve ) );
}; // stopFakeBroker()

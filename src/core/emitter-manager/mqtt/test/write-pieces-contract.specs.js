// core/emitter-manager/mqtt/test/write-pieces-contract.specs.js

/**
 * @fileoverview Contract: the emitter's in-flight ceiling fits one
 * socket write.
 *
 * libuv 1.52 and later (the version inside Node 24 and Node 26)
 * refuses one socket write call that carries more than 1,048,576
 * buffer pieces. The call fails with `write EINVAL` and the connection
 * drops. Source: `uv__check_before_write` in libuv `src/unix/stream.c`,
 * added by libuv PR #5014. mqtt-packet corks the socket for every
 * packet and uncorks on the next tick, so every publish accepted inside
 * one event-loop turn leaves in ONE write call. MQTT_INFLIGHT_ID_LIMIT
 * (33,000) is sized so that the whole cap fits one call (constants.js).
 *
 * This spec measures the pieces per publish instead of trusting the
 * number written in that comment. It drives the real mqtt.js client and
 * the real mqtt-packet encoder over a fake transport. The transport
 * counts the pieces of every write call and plays the broker: it
 * answers CONNECT with CONNACK and every PUBLISH with PUBACK. One burst
 * of publishes must arrive as one write call, and pieces per publish
 * times MQTT_INFLIGHT_ID_LIMIT must stay under the libuv limit.
 *
 * The spec runs over both shipped codecs. The JSON codec sets the
 * payload-format flag, which costs two more pieces, so it is the larger
 * of the two and the one the ceiling is sized for. When this spec fails
 * after an mqtt or mqtt-packet upgrade, re-derive the ceiling before
 * touching any number here.
 *
 * Found 2026-10-31 while certifying Node 26: the hardening tier's
 * fire-hose spec failed with `write EINVAL` on Node 24 and 26 and
 * passed on Node 22, which bundles libuv 1.51.
 */

import { Duplex } from 'node:stream';
import { createRequire } from 'node:module';
import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import mqtt from 'mqtt';

import { createEmitter } from '../emitter.js';
import { MQTT_INFLIGHT_ID_LIMIT } from '../constants.js';
import { jsonCodec, msgpackCodec } from '../../../codec/index.js';

// The copy of mqtt-packet that mqtt itself loads, so the measured
// encoder is the one that runs in production.
const mqttPacket = createRequire( import.meta.resolve( 'mqtt' ) )( 'mqtt-packet' );

/**
 * libuv's cap on buffer pieces in one write call. `uv__check_before_write`
 * returns UV_EINVAL when `nbufs > 1024 * 1024` (libuv 1.52.0, PR #5014).
 * @type {number}
 */
const LIBUV_MAX_PIECES_PER_WRITE = 1024 * 1024;

/**
 * Publishes per burst. One thousand is far above anything else the
 * client writes in the same turn, and far below the pressure limit of
 * the test emitter.
 * @type {number}
 */
const BURST = 1000;

/**
 * Pieces per publish measured 2026-10-31 with mqtt 5.15.1 and
 * mqtt-packet 9.0.2. The constants.js comment relies on the JSON
 * figure. The msgpack codec sends no payload-format flag, which saves
 * two pieces.
 */
const EXPECTED_PIECES = { json: 29, msgpack: 27 };

const MQTT_V5 = { protocolVersion: 5 };

/**
 * Builds the fake transport: a duplex stream that counts the pieces of
 * every write call and plays the broker.
 *
 * @returns {{ transport: Duplex, counts: Object }} the stream and its counters
 */
const makeTransport = function () {
    const counts = { writeCalls: 0, largestWrite: 0, publishes: 0, parseErrors: 0 };
    const parser = mqttPacket.parser( MQTT_V5 );
    let transport = null;

    parser.on( 'error', function () {
        counts.parseErrors += 1;
    } );

    // The broker side: acknowledge the connection and every publish,
    // and end the readable side when the client says goodbye.
    parser.on( 'packet', function ( packet ) {
        if ( packet.cmd === 'connect' ) {
            transport.push( mqttPacket.generate(
                { cmd: 'connack', reasonCode: 0, sessionPresent: false }, MQTT_V5
            ) );
            return;
        }
        if ( packet.cmd === 'publish' ) {
            counts.publishes += 1;
            transport.push( mqttPacket.generate(
                { cmd: 'puback', messageId: packet.messageId, reasonCode: 0 }, MQTT_V5
            ) );
            return;
        }
        if ( packet.cmd === 'disconnect' ) {
            transport.push( null );
        }
    } );

    // One write call. Node hands every corked piece to `writev` as one
    // array, exactly as net.Socket hands them to libuv.
    const absorb = function ( chunks, cb ) {
        counts.writeCalls += 1;
        counts.largestWrite = Math.max( counts.largestWrite, chunks.length );
        for ( const { chunk } of chunks ) {
            parser.parse( chunk );
        }
        cb();
    }; // absorb()

    transport = new Duplex( {
        read: function () {
            // Data arrives through push() from the parser's packet handler.
        },
        write: function ( chunk, encoding, cb ) {
            absorb( [ { chunk } ], cb );
        },
        writev: absorb
    } );

    return { transport, counts };
}; // makeTransport()

/**
 * Resolves when the predicate holds, checked once per event-loop turn.
 * Rejects after `maxTurns` turns so a broken fake cannot hang the suite.
 *
 * @param {function} predicate - Returns true when the wait is over
 * @param {number} maxTurns - Turns to wait before giving up
 * @returns {Promise<void>}
 */
const settle = function ( predicate, maxTurns ) {
    return new Promise( function ( resolve, reject ) {
        let turns = 0;
        const check = function () {
            if ( predicate() ) {
                resolve();
                return;
            }
            turns += 1;
            if ( turns > maxTurns ) {
                reject( new Error( `not settled after ${maxTurns} turns` ) );
                return;
            }
            setImmediate( check );
        };
        check();
    } );
}; // settle()

describe( 'mqtt emitter — one burst fits one socket write (libuv 1.52 limit)', function () {

    let emitter = null;

    afterEach( async function () {
        if ( emitter ) {
            await emitter.shutdown( { timeout: 2000 } );
            emitter = null;
        }
    } );

    /**
     * Creates the emitter over the fake transport. The connect function
     * mirrors `mqtt.connect`: it builds the client over a stream builder
     * and attaches the same no-op error listener the library attaches.
     *
     * @param {Object} codec - The codec under measurement
     * @param {Duplex} transport - The fake transport
     * @returns {{ pending: Promise<Object>, builderCalls: function }} the factory promise and a reader of stream-builder calls
     */
    const openEmitter = function ( codec, transport ) {
        let calls = 0;
        const mqttConnectFn = function ( url, opts ) {
            const client = new mqtt.MqttClient( function () {
                calls += 1;
                return transport;
            }, opts );
            client.on( 'error', function () {
                // The emitter's own error handler reports it.
            } );
            return client;
        };
        const pending = createEmitter( {
            brokerUrl: 'mqtt://127.0.0.1',
            connectGraceMs: 2000,
            codec,
            maxQueueSize: 10000,
            mqttConnectFn
        } );
        return { pending, builderCalls: () => calls };
    }; // openEmitter()

    [
        { name: 'json', codec: jsonCodec },
        { name: 'msgpack', codec: msgpackCodec }
    ].forEach( function ( { name, codec } ) {

        it( `${name} codec: ${BURST} publishes leave in one write, and the ceiling fits the libuv limit`, async function () {
            const { transport, counts } = makeTransport();
            const { pending, builderCalls } = openEmitter( codec, transport );
            emitter = await pending;
            // The fake broker answered CONNECT, so the burst below is
            // written, not stored for a later connection.
            expect( emitter.getHealth().connected ).to.equal( true );

            let accepted = 0;
            for ( let i = 0; i < BURST; i += 1 ) {
                const result = emitter.publishNow( 'contract/pieces', { i, value: 0.5 } );
                if ( result.ok ) {
                    accepted += 1;
                }
            }
            expect( accepted ).to.equal( BURST );

            await settle( () => emitter.getHealth().stats.published === BURST, 1000 );

            // The measurement is real: the fake broker saw every publish
            // and the connection never dropped.
            expect( counts.parseErrors ).to.equal( 0 );
            expect( counts.publishes ).to.equal( BURST );
            expect( builderCalls() ).to.equal( 1 );

            // The whole burst left in one write call, so the largest
            // call is an exact multiple of the burst.
            expect( counts.largestWrite % BURST ).to.equal( 0 );
            const piecesPerPublish = counts.largestWrite / BURST;
            expect( piecesPerPublish ).to.equal( EXPECTED_PIECES[ name ] );

            // The contract: even the full cap fits one write call.
            expect( piecesPerPublish * MQTT_INFLIGHT_ID_LIMIT ).to.be.at.most( LIBUV_MAX_PIECES_PER_WRITE );
        } );
    } );
} );

// benchmark/mqtt-source/lib/publisher.js

/**
 * @fileoverview Payload and packet generator shared by both harnesses.
 *
 * Key design choices:
 *   - Payload template is built once and serialized to a Buffer once per
 *     message (`Buffer.from(JSON.stringify(...))`). The subscriber sees the
 *     same work a real MQTT message would cost to parse.
 *   - A monotonic sequence number and a wall-clock timestamp are embedded
 *     so the subscriber can compute per-message latency.
 *   - For the stub harness we also return a pre-built `packet` with the
 *     shape mqtt.js hands to 'message' listeners (topic, payload, packet).
 *   - Variable-size pad is deterministic per sequence number so payloads
 *     share no structural sharing that would distort JSON.parse timings.
 */

import { WINK_NAMESPACE } from '../../../src/core/mqtt-protocol.js';

const DEFAULT_TOPIC = 'bench/mqtt-source';

const buildPadString = function ( sizeBytes ) {
    if ( sizeBytes <= 0 ) {
        return '';
    }
    // 'x' is a single-byte char, so length == byte length for the pad field.
    return 'x'.repeat( sizeBytes );
};

const createPayloadGenerator = function ( targetSizeBytes ) {
    // Build one message without the pad to measure overhead.
    const skeleton = {
        assetId: 'asset-001',
        ts: 0,
        seq: 0,
        temperature: 23.5,
        pressure: 101.3,
        flowRate: 12.7,
        pad: ''
    };
    const skeletonJson = JSON.stringify( skeleton );
    const overhead = Buffer.byteLength( skeletonJson, 'utf8' );
    const padLen = Math.max( 0, targetSizeBytes - overhead );
    const padString = buildPadString( padLen );

    // Mutable template object reused across calls to avoid per-message object
    // literal allocation in the generator itself. The harness measures the
    // subscriber side, not the publisher side, so the subscriber still gets a
    // fresh Buffer + fresh string to parse, which is the realistic cost.
    const template = {
        assetId: 'asset-001',
        ts: 0,
        seq: 0,
        temperature: 23.5,
        pressure: 101.3,
        flowRate: 12.7,
        pad: padString
    };

    let seq = 0;

    const nextPayload = function () {
        seq += 1;
        template.seq = seq;
        template.ts = Date.now();
        return Buffer.from( JSON.stringify( template ) );
    };

    const reset = function () {
        seq = 0;
    };

    return { nextPayload, reset, overhead, padLen, targetSizeBytes };
};

const createPacketGenerator = function ( options ) {
    const { payloadBytes, topic = DEFAULT_TOPIC, dedup = true } = options;
    const payloadGen = createPayloadGenerator( payloadBytes );
    let dedupCounter = 0;

    // Returns { topic, payload, packet } — the three args mqtt.js passes to
    // its 'message' event listener. `packet.properties.userProperties`
    // carries winkDedupId in MQTT v5.
    const nextPacket = function () {
        const payload = payloadGen.nextPayload();
        if ( dedup ) {
            dedupCounter += 1;
            return {
                topic,
                payload,
                packet: {
                    properties: {
                        userProperties: {
                            [ WINK_NAMESPACE.dedupId ]: `d-${dedupCounter}`
                        }
                    }
                }
            };
        }
        return {
            topic,
            payload,
            packet: { properties: {} }
        };
    };

    return {
        nextPacket,
        nextPayload: payloadGen.nextPayload,
        topic,
        overhead: payloadGen.overhead,
        targetSizeBytes: payloadBytes
    };
};

export { createPayloadGenerator, createPacketGenerator, DEFAULT_TOPIC };

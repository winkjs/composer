// benchmark/mqtt-source/harness-stub.js

/**
 * @fileoverview Stub-injected throughput harness for the MQTT source.
 *
 * Does NOT talk to a broker. Uses the `mqttConnectFn` config hook in
 * createMQTTSourceClient to inject a fake client whose 'message' event
 * handler is invoked directly by the harness loop.
 *
 * Measures what the composer code path alone can sustain: decode (JSON.parse),
 * dedup lookup, field mutation, and onMessage dispatch. Excludes mqtt.js
 * packet parsing, TCP, and broker work — which is the point. The delta
 * between this and harness-broker.js is the cost of the I/O stack.
 */

import { cpus } from 'node:os';

import { createMQTTSourceClient } from '../../src/core/source-manager/mqtt/client.js';

import { parseArgs } from './lib/args.js';
import { createStats } from './lib/stats.js';
import { createGCTracer } from './lib/gc-tracer.js';
import { createHeapSampler } from './lib/heap-sampler.js';
import { createPacketGenerator } from './lib/publisher.js';
import { printSummary, writeCsv, summarizeHeapSamples } from './lib/report.js';

// ============================================================================
// FAKE MQTT CLIENT
// ============================================================================

/**
 * Produce a fake mqtt.js client compatible with createMQTTSourceClient.
 * It captures event handlers and exposes them for direct invocation.
 */
const createFakeClient = function () {
    const handlers = Object.create( null );
    const client = {
        on: function ( event, handler ) {
            handlers[ event ] = handler;
        },
        subscribe: function ( topics, opts, cb ) {
            if ( cb ) {
                cb( null );
            }
        },
        end: function ( force, opts, cb ) {
            if ( cb ) {
                cb();
            }
        }
    };
    return { client, handlers };
};

// ============================================================================
// CORE RUNNER
// ============================================================================

const sleep = function ( ms ) {
    return new Promise( function ( resolve ) {
        setTimeout( resolve, ms );
    } );
};

const runOnce = async function ( params ) {
    const { rate, payloadBytes, durationS, warmupS } = params;

    const packetGen = createPacketGenerator( {
        payloadBytes,
        dedup: params.dedup
    } );

    const latency = createStats();
    let delivered = 0;
    let skipped = 0;
    let errors = 0;

    const { client, handlers } = createFakeClient();

    const onStatus = function ( msg ) {
        if ( msg && msg.startsWith( 'Decode error' ) ) {
            errors += 1;
        } else if ( msg && msg.startsWith( 'Duplicate skipped' ) ) {
            skipped += 1;
        }
    };

    // Set up a latency hook: record hrtime just before emit, record again
    // inside onMessage. hrtime.bigint() → Number(ns) → µs.
    let latencyStartNs = 0n;

    const stop = createMQTTSourceClient( {
        brokerUrl: 'mqtt://stub',
        topics: [ packetGen.topic ],
        onMessage: function () {
            const endNs = process.hrtime.bigint();
            const dtUs = Number( endNs - latencyStartNs ) / 1000;
            latency.add( dtUs );
            delivered += 1;
        },
        onStatus,
        mqttConnectFn: function () {
            return client;
        },
        cleanStart: true
    } );

    // Simulate broker 'connect' so the client marks itself subscribed.
    handlers.connect();

    // Reference to the client's message handler; invoked directly.
    const deliver = handlers.message;

    // Warmup phase — runs but is not measured.
    const warmupDeadline = Date.now() + ( warmupS * 1000 );
    while ( Date.now() < warmupDeadline ) {
        const pkt = packetGen.nextPacket();
        latencyStartNs = process.hrtime.bigint();
        deliver( pkt.topic, pkt.payload, pkt.packet );
        if ( delivered % 10000 === 0 ) {
            await sleep( 0 );
        }
    }

    // Reset counters after warmup.
    delivered = 0;
    skipped = 0;
    errors = 0;

    const gcTracer = createGCTracer();
    const heapSampler = createHeapSampler( 1000 );

    const heapStart = process.memoryUsage().heapUsed;
    const rssStart = process.memoryUsage().rss;

    gcTracer.start();
    heapSampler.start();

    const t0 = process.hrtime.bigint();
    const deadline = Date.now() + ( durationS * 1000 );

    if ( rate === 0 ) {
        // Unthrottled: tight loop with periodic yield so event loop still breathes
        // (setInterval timers for heap sampling and the stop signal both need it).
        while ( Date.now() < deadline ) {
            for ( let i = 0; i < 5000; i += 1 ) {
                const pkt = packetGen.nextPacket();
                latencyStartNs = process.hrtime.bigint();
                deliver( pkt.topic, pkt.payload, pkt.packet );
            }
            // Give the event loop a chance to fire timers and observers.
            await sleep( 0 );
        }
    } else {
        // Throttled: token-bucket pacing. Refill tokens per wall-clock tick and
        // spend them in the inner loop. Small ticks (1 ms) keep latency tight.
        const tickMs = 1;
        const perTick = rate / ( 1000 / tickMs );
        let budget = 0;
        let lastTick = Date.now();
        while ( Date.now() < deadline ) {
            const now = Date.now();
            const ticks = ( now - lastTick ) / tickMs;
            budget += ticks * perTick;
            lastTick = now;
            while ( budget >= 1 ) {
                const pkt = packetGen.nextPacket();
                latencyStartNs = process.hrtime.bigint();
                deliver( pkt.topic, pkt.payload, pkt.packet );
                budget -= 1;
            }
            await sleep( tickMs );
        }
    }

    const t1 = process.hrtime.bigint();

    const gc = gcTracer.stop();
    const heapSamples = heapSampler.stop();
    const heap = summarizeHeapSamples( heapSamples );

    await stop();

    const elapsedS = Number( t1 - t0 ) / 1e9;
    const throughput = {
        msgPerSec: delivered / elapsedS,
        delivered,
        skipped,
        errors
    };

    return {
        harness: 'stub',
        timestamp: Date.now(),
        params,
        throughput,
        latency: latency.summary(),
        gc,
        heap: {
            start: heapStart,
            end: process.memoryUsage().heapUsed,
            peak: heap.peak
        },
        rss: {
            start: rssStart,
            end: process.memoryUsage().rss,
            peak: heap.rssPeak
        },
        heapSamples,
        env: {
            nodeVersion: process.version,
            cpu: ( cpus()[ 0 ] && cpus()[ 0 ].model ) || 'unknown'
        },
        notes: params.rate === 0 ? 'unthrottled' : `target ${params.rate} msg/s`
    };
};

// ============================================================================
// ENTRY POINT
// ============================================================================

const main = async function () {
    const opts = parseArgs( process.argv.slice( 2 ), {
        payload: 1024,
        rate: 0,
        duration: 30,
        warmup: 5,
        dedup: true
    } );

    const params = {
        payloadBytes: Number( opts.payload ),
        rate: Number( opts.rate ),
        durationS: Number( opts.duration ),
        warmupS: Number( opts.warmup ),
        dedup: opts.dedup !== false && opts.dedup !== 'false'
    };

    const result = await runOnce( params );
    printSummary( result );

    const csvPath = new URL(
        `./results/stub.csv`,
        import.meta.url
    );
    writeCsv( csvPath.pathname, result );
};

main().catch( function ( err ) {
    // eslint-disable-next-line no-console
    console.error( err );
    process.exit( 1 );
} );

// benchmark/mqtt-source/harness-broker.js

/**
 * @fileoverview End-to-end throughput harness using a real MQTT broker.
 *
 * Runs a publisher and subscriber in the same Node process, both talking
 * to Mosquitto on mqtt://localhost:1883. The subscriber uses the production
 * createMQTTSourceClient (no stubbing). The delta vs harness-stub.js tells us
 * how much of the ceiling is owned by mqtt.js packet parsing + TCP vs our own
 * code.
 *
 * KNOWN LIMITATION — single process:
 *   Publisher and subscriber share CPU and GC. This is a conservative ceiling;
 *   moving the publisher to a separate process may raise the subscriber's
 *   ceiling. Documented in BASELINE.md.
 *
 * LATENCY PRECISION:
 *   Publish → subscribe wall-clock uses Date.now() embedded in the payload.
 *   Resolution = 1 ms. At high rates latency is probably dominated by
 *   batching within mqtt.js itself; the µs-level precision of the stub
 *   harness is not recoverable here.
 */

import { cpus } from 'node:os';

import mqtt from 'mqtt';

import { createMQTTSourceClient } from '../../src/core/source-manager/mqtt/client.js';
import { WINK_NAMESPACE } from '../../src/core/mqtt-protocol.js';

import { parseArgs } from './lib/args.js';
import { createStats } from './lib/stats.js';
import { createGCTracer } from './lib/gc-tracer.js';
import { createHeapSampler } from './lib/heap-sampler.js';
import { createPayloadGenerator, DEFAULT_TOPIC } from './lib/publisher.js';
import { printSummary, writeCsv, summarizeHeapSamples } from './lib/report.js';

const sleep = function ( ms ) {
    return new Promise( function ( resolve ) {
        setTimeout( resolve, ms );
    } );
};

const waitForConnect = function ( client ) {
    return new Promise( function ( resolve, reject ) {
        const onConn = function () {
            client.removeListener( 'error', onErr );
            resolve();
        };
        const onErr = function ( err ) {
            client.removeListener( 'connect', onConn );
            reject( err );
        };
        client.once( 'connect', onConn );
        client.once( 'error', onErr );
    } );
};

const runOnce = async function ( params ) {
    const {
        rate, payloadBytes, durationS, warmupS,
        broker, topic, dedup
    } = params;

    // ========================================================================
    // Subscriber — measured side
    // ========================================================================

    const latency = createStats();
    let delivered = 0;
    let skipped = 0;
    let errors = 0;

    const stop = createMQTTSourceClient( {
        brokerUrl: broker,
        topics: [ topic ],
        cleanStart: true,
        clientId: `bench-sub-${process.pid}`,
        onMessage: function ( msg ) {
            const rxMs = Date.now();
            if ( typeof msg.ts === 'number' ) {
                const dtMs = rxMs - msg.ts;
                // Convert ms → µs so the same column in the CSV is comparable
                // with the stub harness, even though resolution is coarser.
                latency.add( dtMs * 1000 );
            }
            delivered += 1;
        },
        onStatus: function ( s ) {
            if ( s && s.startsWith( 'Decode error' ) ) {
                errors += 1;
            } else if ( s && s.startsWith( 'Duplicate skipped' ) ) {
                skipped += 1;
            }
        }
    } );
    const subscriberClient = stop._client;                // eslint-disable-line no-underscore-dangle
    await new Promise( function ( resolve ) {             // wait for SUBACK
        const checkSubscribed = function () {
            if ( stop._isSubscribed() ) {                 // eslint-disable-line no-underscore-dangle
                resolve();
            } else {
                setTimeout( checkSubscribed, 10 );
            }
        };
        subscriberClient;                                 // keep reference for future debug
        checkSubscribed();
    } );

    // ========================================================================
    // Publisher — generator side
    // ========================================================================

    const pubClient = mqtt.connect( broker, {
        protocolVersion: 5,
        clientId: `bench-pub-${process.pid}`,
        clean: true,
        reconnectPeriod: 1000
    } );
    await waitForConnect( pubClient );

    const gen = createPayloadGenerator( payloadBytes );

    let published = 0;
    let dedupCounter = 0;

    const publish = function () {
        const payload = gen.nextPayload();
        const options = { qos: 1 };
        if ( dedup ) {
            dedupCounter += 1;
            options.properties = {
                userProperties: {
                    [ WINK_NAMESPACE.dedupId ]: `d-${dedupCounter}`
                }
            };
        }
        pubClient.publish( topic, payload, options );
        published += 1;
    };

    // ------------------------------------------------------------------------
    // Warmup — pace at the target rate (or a safe cap when unthrottled) so
    // the publish backlog inside mqtt.js does not spill into the measured
    // window. If we let warmup run unthrottled for, say, 2 s at ~1 M pub/s,
    // the broker spends the next 10+ seconds draining it into the subscriber
    // and contaminates the measurement.
    // ------------------------------------------------------------------------
    const warmupRate = rate === 0 ? 5000 : rate;
    const warmupDeadline = Date.now() + ( warmupS * 1000 );
    {
        const tickMs = 2;
        const perTick = warmupRate / ( 1000 / tickMs );
        let budget = 0;
        let lastTick = Date.now();
        while ( Date.now() < warmupDeadline ) {
            const now = Date.now();
            const ticks = ( now - lastTick ) / tickMs;
            budget += ticks * perTick;
            lastTick = now;
            while ( budget >= 1 ) {
                publish();
                budget -= 1;
            }
            await sleep( tickMs );
        }
    }
    // Drain in-flight messages and reset counters.
    await sleep( 1500 );
    delivered = 0;
    skipped = 0;
    errors = 0;
    published = 0;

    // ------------------------------------------------------------------------
    // Measured window
    // ------------------------------------------------------------------------
    const gcTracer = createGCTracer();
    const heapSampler = createHeapSampler( 1000 );
    gcTracer.start();
    heapSampler.start();

    const heapStart = process.memoryUsage().heapUsed;
    const rssStart = process.memoryUsage().rss;

    const t0 = process.hrtime.bigint();
    const deadline = Date.now() + ( durationS * 1000 );

    if ( rate === 0 ) {
        // Unthrottled publish loop with mqtt.js backpressure check.
        // publish() returns a boolean indicating writable buffer state.
        while ( Date.now() < deadline ) {
            for ( let i = 0; i < 200; i += 1 ) {
                publish();
            }
            // Yield to let the subscriber's message handler run.
            await sleep( 0 );
        }
    } else {
        const tickMs = 2;
        const perTick = rate / ( 1000 / tickMs );
        let budget = 0;
        let lastTick = Date.now();
        while ( Date.now() < deadline ) {
            const now = Date.now();
            const ticks = ( now - lastTick ) / tickMs;
            budget += ticks * perTick;
            lastTick = now;
            while ( budget >= 1 ) {
                publish();
                budget -= 1;
            }
            await sleep( tickMs );
        }
    }

    // Mark end of the measured publish window. The subscriber may still be
    // receiving messages published before this point — we sleep to collect
    // them, but the throughput calculation uses the intended durationS
    // (publish window), not the elapsed wall clock which includes the drain.
    const t1 = process.hrtime.bigint();
    await sleep( 1000 );

    const gc = gcTracer.stop();
    const heapSamples = heapSampler.stop();
    const heap = summarizeHeapSamples( heapSamples );

    // ========================================================================
    // Teardown
    // ========================================================================
    pubClient.end( false );
    await stop();

    const elapsedS = Number( t1 - t0 ) / 1e9;
    const throughput = {
        msgPerSec: delivered / elapsedS,
        delivered,
        skipped,
        errors,
        published,
        elapsedS
    };

    return {
        harness: 'broker',
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
        notes: `${rate === 0 ? 'unthrottled' : `target ${rate} msg/s`}; published=${published}; delivered=${delivered}`
    };
};

const main = async function () {
    const opts = parseArgs( process.argv.slice( 2 ), {
        payload: 1024,
        rate: 0,
        duration: 30,
        warmup: 5,
        dedup: true,
        broker: 'mqtt://localhost:1883',
        topic: DEFAULT_TOPIC
    } );

    const params = {
        payloadBytes: Number( opts.payload ),
        rate: Number( opts.rate ),
        durationS: Number( opts.duration ),
        warmupS: Number( opts.warmup ),
        dedup: opts.dedup !== false && opts.dedup !== 'false',
        broker: String( opts.broker ),
        topic: String( opts.topic )
    };

    const result = await runOnce( params );
    printSummary( result );

    const csvPath = new URL( './results/broker.csv', import.meta.url );
    writeCsv( csvPath.pathname, result );
    process.exit( 0 );
};

main().catch( function ( err ) {
    // eslint-disable-next-line no-console
    console.error( err );
    process.exit( 1 );
} );

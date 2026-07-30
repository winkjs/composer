// benchmark/mqtt-source/leak-test.js

/**
 * @fileoverview Long-running leak test for the MQTT source subscriber path.
 *
 * Drives createMQTTSourceClient via the same stub-injected path used by
 * harness-stub.js, at a modest sustained rate. Every `snapshotIntervalMin`
 * minutes, writes a v8 heap snapshot and a JSON sample of the current
 * heap / RSS. Diff the snapshots in Chrome DevTools (Memory tab → Load)
 * to inspect retained objects.
 *
 * Why stub, not broker:
 *   We want to isolate subscriber-side leaks from publisher-side buffer
 *   growth (the broker harness has demonstrated that mqtt.js's send queue
 *   can grow unboundedly under backpressure — that's a different concern).
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeHeapSnapshot } from 'node:v8';

import { createMQTTSourceClient } from '../../src/core/source-manager/mqtt/client.js';

import { parseArgs } from './lib/args.js';
import { createPacketGenerator } from './lib/publisher.js';
import { createGCTracer } from './lib/gc-tracer.js';

const __filename = fileURLToPath( import.meta.url );
const __dirname = dirname( __filename );

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

const sleep = function ( ms ) {
    return new Promise( function ( resolve ) {
        setTimeout( resolve, ms );
    } );
};

const main = async function () {
    const opts = parseArgs( process.argv.slice( 2 ), {
        payload: 1024,
        rate: 10000,
        durationMin: 10,
        snapshotIntervalMin: 5
    } );

    const payloadBytes = Number( opts.payload );
    const rate = Number( opts.rate );
    const durationMin = Number( opts.durationMin );
    const snapshotIntervalMin = Number( opts.snapshotIntervalMin );

    const tag = new Date().toISOString().replace( /[:.]/g, '-' );
    const outDir = join( __dirname, 'results', `leak-${tag}` );
    if ( !existsSync( outDir ) ) {
        mkdirSync( outDir, { recursive: true } );
    }

    const log = function ( msg ) {
        const ts = new Date().toISOString();
        // eslint-disable-next-line no-console
        console.log( `[${ts}] ${msg}` );
    };

    log( `Leak test starting — ${durationMin} min at ${rate} msg/s, ${payloadBytes} B payloads` );
    log( `Output: ${outDir}` );

    const packetGen = createPacketGenerator( {
        payloadBytes,
        dedup: true
    } );

    let delivered = 0;
    let skipped = 0;

    const { client, handlers } = createFakeClient();

    const stop = createMQTTSourceClient( {
        brokerUrl: 'mqtt://stub',
        topics: [ packetGen.topic ],
        cleanStart: true,
        onMessage: function () {
            delivered += 1;
        },
        onStatus: function ( s ) {
            if ( s && s.startsWith( 'Duplicate skipped' ) ) {
                skipped += 1;
            }
        },
        mqttConnectFn: function () {
            return client;
        }
    } );
    handlers.connect();
    const deliver = handlers.message;

    const gcTracer = createGCTracer();
    gcTracer.start();

    const heapSamples = [];
    const recordSample = function ( phase ) {
        const mem = process.memoryUsage();
        const sample = {
            ts: new Date().toISOString(),
            elapsedMin: ( Date.now() - t0 ) / 60000,
            phase,
            heapUsedMb: mem.heapUsed / ( 1024 * 1024 ),
            heapTotalMb: mem.heapTotal / ( 1024 * 1024 ),
            externalMb: mem.external / ( 1024 * 1024 ),
            rssMb: mem.rss / ( 1024 * 1024 ),
            delivered,
            skipped
        };
        heapSamples.push( sample );
        log( `${phase}: heapUsed=${sample.heapUsedMb.toFixed( 1 )}MB rss=${sample.rssMb.toFixed( 1 )}MB delivered=${delivered}` );
        return sample;
    };

    const snapshot = function ( label ) {
        const path = join( outDir, `heap-${label}.heapsnapshot` );
        writeHeapSnapshot( path );
        log( `Wrote ${path}` );
    };

    const t0 = Date.now();
    recordSample( 'start' );
    snapshot( 'start' );

    const deadline = t0 + ( durationMin * 60 * 1000 );
    const snapshotMs = snapshotIntervalMin * 60 * 1000;
    let nextSnapshotAt = t0 + snapshotMs;
    let nextSampleAt = t0 + 30000;                // every 30s

    // Drive the subscriber at `rate` msg/s via token-bucket pacing.
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
            const pkt = packetGen.nextPacket();
            deliver( pkt.topic, pkt.payload, pkt.packet );
            budget -= 1;
        }
        if ( now >= nextSampleAt ) {
            recordSample( 'running' );
            nextSampleAt = now + 30000;
        }
        if ( now >= nextSnapshotAt ) {
            snapshot( `t-${Math.round( ( now - t0 ) / 60000 )}min` );
            nextSnapshotAt = now + snapshotMs;
        }
        await sleep( tickMs );
    }

    recordSample( 'end' );
    snapshot( 'end' );

    await stop();

    const gc = gcTracer.stop();

    const summary = {
        durationMin,
        rate,
        payloadBytes,
        delivered,
        skipped,
        gc,
        samples: heapSamples
    };

    const summaryPath = join( outDir, 'summary.json' );
    writeFileSync( summaryPath, JSON.stringify( summary, null, 2 ), 'utf8' );
    log( `Summary written to ${summaryPath}` );

    const first = heapSamples[ 0 ];
    const last = heapSamples[ heapSamples.length - 1 ];
    const heapDeltaMb = last.heapUsedMb - first.heapUsedMb;
    const rssDeltaMb = last.rssMb - first.rssMb;
    // eslint-disable-next-line no-console
    console.log( `\n=== Leak verdict ===` );
    // eslint-disable-next-line no-console
    console.log( `heapUsed delta: ${heapDeltaMb.toFixed( 1 )} MB over ${durationMin} min` );
    // eslint-disable-next-line no-console
    console.log( `rss delta     : ${rssDeltaMb.toFixed( 1 )} MB over ${durationMin} min` );
    // eslint-disable-next-line no-console
    console.log( `delivered     : ${delivered.toLocaleString()}` );
};

main().catch( function ( err ) {
    // eslint-disable-next-line no-console
    console.error( err );
    process.exit( 1 );
} );

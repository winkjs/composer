// core/emitter-manager/mqtt/test/slow-mqtt-emitter-throughput.specs.js

/* eslint-disable no-process-env, no-await-in-loop, no-invalid-this */

/**
 * @fileoverview Sustained-throughput and
 * pressure-response tests for the MQTT emitter, driven by testHarness.
 *
 * Slow tier — runs only via `npm run test:hardening`; the regular
 * `npm test` ignores `slow-*.specs.js`.
 *
 * Two concerns:
 *
 *   1. **Sustained throughput** — drive the harness flat-out, assert
 *      every `_harnessId` is received by the subscriber **at least
 *      once** (QoS 1 semantics — duplicates are allowed and expected
 *      under retry conditions). The hard assertion is set-equality on
 *      `_harnessId` (every produced id appears in the received set).
 *      The throughput number itself is logged for documentation, not
 *      asserted as a tight bound. Duplicate-count is logged as a
 *      diagnostic — a small number is healthy QoS 1; a flood would
 *      indicate a retry storm worth investigating.
 *
 *   2. **Pressure response.** Shrink `maxQueueSize` so even normal
 *      queueing exceeds it; sample `getPressure()` during the run;
 *      assert the curve rises, never exceeds 1.0, and resets after
 *      drain. (The old byte-axis twin of this test died with the
 *      disk store — ADR-021: the in-memory emitter bounds memory by
 *      message count alone, so pressure has one axis.)
 *
 * What we're actively probing for:
 *   - Memory leaks during sustained burst.
 *   - Lost messages at the subscriber side (every `_harnessId`
 *     received at least once — QoS 1 contract).
 *   - Pressure overshoot (`getPressure() > 1.0`).
 *   - Pressure non-resets after the subscriber drains.
 *   - QoS 1 retry storms (high duplicate ratio; small numbers are
 *     normal and expected under any retry).
 *   - Silent drops via `onDeliveryFailure` / `onCritical` not firing.
 *
 * Requires Mosquitto running via the repo's `docker-compose.yml`.
 * Tests skip cleanly if Mosquitto is not reachable.
 */

import { expect } from 'chai';
import { describe, it, before, beforeEach } from 'mocha';
import mqtt from 'mqtt';

import { flow } from '../../../../composer.js';
import { jsonCodec } from '../../../codec/index.js';
import * as testHarness from '../../../source-manager/test-harness/index.js';
import * as mqttEmitter from '../index.js';
import { emitters as wireEmitters } from '../../../wiring/index.js';

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const RUN_PREFIX      = `tput_${Date.now()}_${Math.random().toString( 36 ).slice( 2, 6 )}`;

// Asset class shape — one float column keeps payloads small and
// predictable so byte-axis pressure is calculable.
const assetClass = {
    name: 'tputMqtt',
    columns: {
        _harnessId: { type: 'int64' },
        partitionId: { type: 'string' },
        ts: { type: 'timestamp' },
        value: { type: 'float64', resolution: 0.01 }
    },
    insightTypes: {
        samples: {
            columns: [ '_harnessId', 'partitionId', 'ts', 'value' ],
            designatedTimestamp: 'ts'
        }
    }
};

const buildMessageTemplate = function ( messageCount, intervalMs = 0 ) {
    return {
        seed: 1,
        messageCount,
        intervalMs,
        fields: {
            partitionId: { type: 'string', values: [ 'tputMqtt' ] },
            ts: { type: 'timestamp', mode: 'monotonic-ms', seedValue: Date.now() },
            value: { type: 'float64', range: [ 0, 100 ], resolution: 0.01 }
        }
    };
};

// ============================================================================
// HELPERS
// ============================================================================

const isMosquittoAvailable = function () {
    return new Promise( function ( resolve ) {
        const c = mqtt.connect( MQTT_BROKER_URL, {
            reconnectPeriod: 0,
            connectTimeout: 3000
        } );
        let resolved = false;
        const settle = function ( ok ) {
            if ( resolved ) return;
            resolved = true;
            c.end( true );
            resolve( ok );
        };
        c.on( 'connect', () => settle( true ) );
        c.on( 'error', () => settle( false ) );
    } );
};

const formatHeap = function ( bytes ) {
    return `${( bytes / 1024 / 1024 ).toFixed( 1 )} MB`;
};

const subscribeAndCollect = async function ( topicPattern, codec ) {
    const subscriber = mqtt.connect( MQTT_BROKER_URL, { reconnectPeriod: 0 } );
    await new Promise( ( r ) => subscriber.on( 'connect', r ) );
    const ids = new Set();
    const duplicates = [];
    subscriber.on( 'message', function ( _topic, payload ) {
        try {
            const decoded = codec.unpack( payload );
            // eslint-disable-next-line no-underscore-dangle
            const id = decoded._harnessId;
            if ( ids.has( id ) ) duplicates.push( id );
            else ids.add( id );
        } catch {
            // Non-codec payload (could be from another publisher); skip.
        }
    } );
    // Subscribe at QoS 1 — broker uses subscribe-QoS for forward,
    // so QoS 0 (the default) means fire-and-forget broker→subscriber
    // with no PUBACK and no flow control. Under burst the broker
    // drops when the subscriber's TCP buffer fills (measured here
    // in a 100 k burst). QoS 1 gives full at-least-once end-to-end —
    // broker waits for subscriber-PUBACK before sending more.
    await new Promise( function ( resolve, reject ) {
        subscriber.subscribe( topicPattern, { qos: 1 }, function ( err ) {
            if ( err ) reject( err );
            else resolve();
        } );
    } );
    return {
        subscriber,
        ids,
        duplicates,
        close: function () {
            return new Promise( function ( resolve ) {
                subscriber.end( true, {}, resolve );
            } );
        }
    };
};

const waitForIdSet = async function ( idSet, expected, maxMs = 30000 ) {
    const start = Date.now();
    while ( ( Date.now() - start ) < maxMs ) {
        if ( idSet.size >= expected ) return idSet.size;
        await new Promise( ( r ) => setTimeout( r, 100 ) );
    }
    return idSet.size;
};

// Wait until the id set stops growing (no new id for `idleMs`), for
// tests where the expected count is not knowable at this layer (the
// pre-flight reject split happens inside emitIf). Cap at `maxMs`.
const waitForIdSetIdle = async function ( idSet, idleMs = 2000, maxMs = 15000 ) {
    const start = Date.now();
    let lastSize = idSet.size;
    let lastGrowth = Date.now();
    while ( ( Date.now() - start ) < maxMs ) {
        if ( idSet.size !== lastSize ) {
            lastSize = idSet.size;
            lastGrowth = Date.now();
        } else if ( ( Date.now() - lastGrowth ) >= idleMs ) {
            break;
        }
        await new Promise( ( r ) => setTimeout( r, 100 ) );
    }
    return idSet.size;
};

// Wait for getPressure() to drop to ~0 — the broker has acknowledged
// everything and the unacked counter has come back down. Subscriber-
// receive lags broker-ACK by microseconds; broker-ACK lags the publish
// callback by a tick or two. This poll closes that gap explicitly.
const waitForPressureZero = async function ( emitterHandle, maxMs = 5000 ) {
    const start = Date.now();
    while ( ( Date.now() - start ) < maxMs ) {
        if ( emitterHandle.getPressure() <= 0.001 ) return emitterHandle.getPressure();
        await new Promise( ( r ) => setTimeout( r, 25 ) );
    }
    return emitterHandle.getPressure();
};

// ============================================================================
// TESTS
// ============================================================================

describe( 'MQTT Emitter Hardening — sustained throughput and pressure response', function () {

    // Big budget — these hardening tests deliberately run long. The 100 k
    // burst test can use most of this for drain on commodity hardware.
    this.timeout( 300000 );

    let mosquittoUp = false;

    before( async function () {
        mosquittoUp = await isMosquittoAvailable();
        if ( !mosquittoUp ) {
            console.log( '  [SKIP] Mosquitto not available — start with `docker compose up -d`' );
        }
    } );

    beforeEach( function () {
        if ( !mosquittoUp ) this.skip();
    } );

    // --------------------------------------------------------------------
    // Test 1 — Sustained throughput, no loss, bounded memory
    // --------------------------------------------------------------------

    it( 'sustains a flat-out run with no message loss and bounded memory', async function () {
        // What this probes:
        //   - Every `_harnessId` produced reaches the subscriber once.
        //   - No duplicates (no QoS1 retry storm).
        //   - No silent drops or phantom DELIVERY_FAILED callbacks.
        //   - Heap doesn't grow unboundedly.
        //   - Drain on shutdown completes cleanly (post-drain pressure 0).
        //
        // Sizing rationale: 10 000 messages, `maxQueueSize` sized
        // for the burst (50 000 — well above). 10 k is realistic for
        // a sensor-batch flush scenario at the upper end. The point
        // is "every accepted publish reaches the subscriber" under
        // sustained load — pre-flight reject is tested separately.
        //
        // Design facts this test depends on (kept through ADR-021):
        //   - The unacked counter rises synchronously with the accept
        //     decision, so `getPressure()` is accurate at the very
        //     next publishNow call and pre-flight reject is reliable
        //     (the old store design's optimistic-increment lesson).
        //   - Drain-then-close in emitter.shutdown: polls the counter
        //     to 0 before letting mqtt.js close the connection, so
        //     in-flight publishes complete cleanly. Without it,
        //     force-close dropped buffered messages.
        const messageCount = 10000;
        const topicPrefix = `${RUN_PREFIX}_run`;

        if ( typeof global.gc === 'function' ) global.gc();
        const memBefore = process.memoryUsage();

        // Subscriber wildcard — flow builds the full topic from
        // edge id + partition id + specialization + insight type.
        const captured = await subscribeAndCollect( `+/tputMqtt/+/${topicPrefix}-samples`, jsonCodec );

        const deliveryFailures = [];
        const criticalCalls = [];

        const t0 = Date.now();
        const handle = await flow( 'tputMqttRun' )
            .source( testHarness, {
                messageTemplate: buildMessageTemplate( messageCount ),
                assetClass,
                shutdownOnComplete: false
            } )
            .assetClass( assetClass )
            .emitter( mqttEmitter, {
                brokerUrl: MQTT_BROKER_URL,
                codec: jsonCodec,
                maxQueueSize: 50000,     // sized well above the 10 k burst
                onDeliveryFailure: function ( err, ctx ) {
                    deliveryFailures.push( {
                        code: err && err.code,
                        message: err && err.message,
                        topic: ctx && ctx.topic
                    } );
                },
                onCritical: function ( reason, pressure ) {
                    criticalCalls.push( { reason, pressure } );
                }
            } )
            .assetId( 'partitionId' )
            .emitIf( 'emitToMqtt', ( _msg ) => true,
                { target: 'mqtt', insightType: `${topicPrefix}-samples` } )
            .run();

        await handle.whenComplete();
        const generationMs = Date.now() - t0;

        // Shutdown first — emitter's drain-then-close polls the
        // unacked counter until zero (or timeout). With maxQueueSize
        // sized above the burst, no pre-flight rejects occur; the
        // timeout just bounds total drain.
        await handle.shutdown( { timeout: 60000 } );

        // After shutdown completes, every accepted publish has been
        // ACKed by the broker; subscriber should have received them
        // all (broker is in-process for localhost). Brief grace for
        // the subscriber's own delivery loop to catch up.
        const finalCount = await waitForIdSet( captured.ids, messageCount, 10000 );

        await captured.close();

        if ( typeof global.gc === 'function' ) global.gc();
        const memAfter = process.memoryUsage();
        const observedRate = ( messageCount / generationMs ) * 1000;
        const heapDelta = memAfter.heapUsed - memBefore.heapUsed;

        console.log( '\n  [throughput] run summary:' );
        console.log( `    messages produced:  ${messageCount}` );
        console.log( `    received unique:    ${finalCount}` );
        console.log( `    duplicates:         ${captured.duplicates.length}` );
        console.log( `    missing:            ${messageCount - finalCount}` );
        console.log( `    generation time:    ${generationMs} ms` );
        console.log( `    observed rate:      ${observedRate.toFixed( 0 )} msg/s` );
        console.log( `    heap before/after:  ${formatHeap( memBefore.heapUsed )} / ${formatHeap( memAfter.heapUsed )} (Δ ${formatHeap( heapDelta )})` );
        console.log( `    delivery failures:  ${deliveryFailures.length}` );
        console.log( `    onCritical calls:   ${criticalCalls.length}` );
        if ( deliveryFailures.length > 0 ) {
            console.log( '    first 3 delivery failures:' );
            for ( const f of deliveryFailures.slice( 0, 3 ) ) {
                console.log( `      - ${f.code}: ${f.message} (topic: ${f.topic})` );
            }
        }

        // Hard assertions — the no-silent-failures contract under
        // QoS 1 semantics. "No data loss" = every produced id reaches
        // the subscriber **at least once** (duplicates are allowed by
        // QoS 1 and represent legitimate retry behaviour, not a bug).
        expect( deliveryFailures, 'no delivery failures allowed under default-config burst' )
            .to.deep.equal( [] );
        expect( finalCount, 'every produced id must reach the subscriber at least once' )
            .to.equal( messageCount );

        // Duplicates are allowed under QoS 1 — log a warning above a
        // soft threshold (would suggest a retry storm), but do not fail.
        // On a clean localhost run we typically see zero; under packet
        // loss or broker hiccups, a handful is normal.
        const duplicateRatio = captured.duplicates.length / messageCount;
        expect( duplicateRatio, 'duplicate ratio under 5% (sanity bound on retry storms)' )
            .to.be.lessThan( 0.05 );

        // Conservative throughput floor — catches catastrophic regressions
        // without flaking on slow CI hardware.
        expect( observedRate, 'observed rate floor' ).to.be.greaterThan( 500 );

        // Heap growth bounded. With maxQueueSize=10000 and ~120 B/msg
        // payload + meta, max in-flight ~1.2 MB. Allow 100 MB for
        // jit/buffers. Anything beyond that suggests a leak.
        expect( heapDelta / 1024 / 1024 ).to.be.lessThan( 100 );
    } );

    // --------------------------------------------------------------------
    // Test 1b — Higher-volume burst (probes for scale-related findings)
    // --------------------------------------------------------------------

    it( 'a 100 k fire-hose beyond window capacity: every accepted message delivers, overflow rejects cleanly', async function () {
        // What this probes (mirrors the spirit of the QDB 1 M-message finding):
        //   - Does the unacked accounting drift at scale?
        //   - Does drain throughput hit a cliff at a full in-flight
        //     window?
        //   - Is heap growth still bounded with 60 k messages held
        //     in the client's memory store?
        //
        // `maxQueueSize` sits at the MQTT id-space ceiling (60,000 —
        // see MQTT_INFLIGHT_ID_LIMIT): packet ids are 16-bit, so no
        // MQTT client can have more unacknowledged publishes than that.
        // A 100 k instantaneous burst therefore CANNOT all be buffered —
        // the pre-fix version of this test asserted it could, and was
        // satisfied only by the id allocator wrapping and silently
        // scrambling acknowledgment bookkeeping. The contract asserted
        // now:
        //   - everything the pre-flight ACCEPTS is delivered — pinned by
        //     handle.shutdown() resolving clean (a clean resolve is a
        //     delivery statement, ADR-018);
        //   - at least the full in-flight window (0.9 × 60,000) is
        //     accepted and received;
        //   - the overflow is rejected synchronously at publishNow —
        //     never accepted-then-dropped (deliveryFailures stays
        //     empty);
        //   - zero duplicates — the id-scrambling regression marker.
        const messageCount = 100000;
        const topicPrefix = `${RUN_PREFIX}_run_100k`;

        if ( typeof global.gc === 'function' ) global.gc();
        const memBefore = process.memoryUsage();

        const captured = await subscribeAndCollect( `+/tputMqtt/+/${topicPrefix}-samples`, jsonCodec );

        const deliveryFailures = [];
        const criticalCalls = [];

        const t0 = Date.now();
        const handle = await flow( 'tputMqtt100kRun' )
            .source( testHarness, {
                messageTemplate: buildMessageTemplate( messageCount ),
                assetClass,
                shutdownOnComplete: false
            } )
            .assetClass( assetClass )
            .emitter( mqttEmitter, {
                brokerUrl: MQTT_BROKER_URL,
                codec: jsonCodec,
                maxQueueSize: 60000,
                onDeliveryFailure: function ( err, ctx ) {
                    deliveryFailures.push( {
                        code: err && err.code,
                        message: err && err.message,
                        topic: ctx && ctx.topic
                    } );
                },
                onCritical: function ( reason, pressure ) {
                    criticalCalls.push( { reason, pressure } );
                }
            } )
            .assetId( 'partitionId' )
            .emitIf( 'emitToMqtt', ( _msg ) => true,
                { target: 'mqtt', insightType: `${topicPrefix}-samples` } )
            .run();

        await handle.whenComplete();
        const generationMs = Date.now() - t0;
        const tShutdownStart = Date.now();
        // Generous shutdown budget — a full 60 k in-flight window can
        // take a long drain in the worst case; 240 s is the slow-tier
        // ceiling (mocha timeout). A clean resolve here is the delivery
        // statement for everything the pre-flight accepted.
        await handle.shutdown( { timeout: 200000 } );
        const drainMs = Date.now() - tShutdownStart;
        // Subscriber wait — the accepted count is not directly
        // observable at this layer (pre-flight rejects happen inside
        // emitIf), so wait for the id set to go idle rather than for a
        // target count: after the clean drain, everything accepted is
        // already at the broker.
        const subscriberWaitStart = Date.now();
        const finalCount = await waitForIdSetIdle( captured.ids );
        const subscriberWaitMs = Date.now() - subscriberWaitStart;
        const totalMs = Date.now() - t0;

        await captured.close();

        if ( typeof global.gc === 'function' ) global.gc();
        const memAfter = process.memoryUsage();
        const productionRate = ( messageCount / generationMs ) * 1000;
        const drainRate = ( finalCount / drainMs ) * 1000;
        const e2eRate = ( finalCount / totalMs ) * 1000;
        const heapDelta = memAfter.heapUsed - memBefore.heapUsed;
        const duplicateRatio = captured.duplicates.length / messageCount;

        console.log( '\n  [throughput-100k] run summary:' );
        console.log( `    messages produced:   ${messageCount}` );
        console.log( `    received unique:     ${finalCount}` );
        console.log( `    duplicates:          ${captured.duplicates.length} (${( duplicateRatio * 100 ).toFixed( 2 )}%)` );
        console.log( `    missing:             ${messageCount - finalCount}` );
        console.log( `    generation time:     ${generationMs} ms` );
        console.log( `    shutdown drain time: ${drainMs} ms` );
        console.log( `    subscriber wait:     ${subscriberWaitMs} ms` );
        console.log( `    total e2e time:      ${totalMs} ms` );
        console.log( `    production rate:     ${productionRate.toFixed( 0 )} msg/s` );
        console.log( `    drain rate:          ${drainRate.toFixed( 0 )} msg/s` );
        console.log( `    end-to-end rate:     ${e2eRate.toFixed( 0 )} msg/s` );
        console.log( `    heap before/after:   ${formatHeap( memBefore.heapUsed )} / ${formatHeap( memAfter.heapUsed )} (Δ ${formatHeap( heapDelta )})` );
        console.log( `    delivery failures:   ${deliveryFailures.length}` );
        console.log( `    onCritical calls:    ${criticalCalls.length}` );
        if ( deliveryFailures.length > 0 ) {
            console.log( '    first 3 delivery failures:' );
            for ( const f of deliveryFailures.slice( 0, 3 ) ) {
                console.log( `      - ${f.code}: ${f.message} (topic: ${f.topic})` );
            }
        }

        // Hard assertions — the QoS 1 contract at over-capacity
        // (see the header comment): accepted-all-delivered is pinned by
        // the clean shutdown above; here we pin the floor, the clean
        // reject path, and the zero-duplicates regression marker.
        expect( deliveryFailures, 'overflow must reject at pre-flight, never accept-then-drop' )
            .to.deep.equal( [] );
        expect( finalCount, 'at least the full in-flight window must be accepted and delivered' )
            .to.be.at.least( 0.9 * 60000 );
        expect( captured.duplicates.length, 'zero duplicates — id scrambling regression marker' )
            .to.equal( 0 );

        // Heap delta bounded — generous bound for a 100 k run; the
        // real signal is "bounded" not "small", since LevelDB caches
        // and JIT profiles take several MB on first hot-path warmup.
        expect( heapDelta / 1024 / 1024, 'heap delta bounded under 250 MB at 100 k' )
            .to.be.lessThan( 250 );
    } );

    // --------------------------------------------------------------------
    // Test 2 — Pressure response
    // --------------------------------------------------------------------

    it( 'pressure rises under load, never exceeds 1.0, and resets after drain', async function () {
        // What this probes:
        //   - The pressure gauge (`unacked/maxQueueSize`) responds to
        //     producer load.
        //   - Pressure never overshoots 1.0 (the contract bound).
        //   - Pressure resets to ~0 after the broker drains.
        //
        // Sizing: very small `maxQueueSize` (10) so each in-flight
        // message moves pressure by 0.1. Otherwise localhost Mosquitto
        // drains so fast that pressure stays sub-0.01 — meaningful
        // accumulation requires either tiny queue or a stalled broker
        // (the latter is slow-mqtt-emitter-recovery.specs.js's outage
        // scenario).
        const messageCount = 200;
        const intervalMs = 1;
        const topicPrefix = `${RUN_PREFIX}_pcount`;

        const captured = await subscribeAndCollect( `+/tputMqtt/+/${topicPrefix}-samples`, jsonCodec );

        const handle = await flow( 'pressureCountRun' )
            .source( testHarness, {
                messageTemplate: buildMessageTemplate( messageCount, intervalMs ),
                assetClass,
                shutdownOnComplete: false
            } )
            .assetClass( assetClass )
            .emitter( mqttEmitter, {
                brokerUrl: MQTT_BROKER_URL,
                codec: jsonCodec,
                maxQueueSize: 10                  // 0.1 per in-flight msg
            } )
            .assetId( 'partitionId' )
            .emitIf( 'emitToMqtt', ( _msg ) => true,
                { target: 'mqtt', insightType: `${topicPrefix}-samples` } )
            .run();

        // Reach into the live emitter handle so we can poll pressure.
        const emitterHandle = wireEmitters.get().mqtt;
        expect( emitterHandle, 'mqtt emitter singleton must be wired' ).to.not.equal( undefined );
        expect( typeof emitterHandle.getPressure, 'emitter exposes getPressure' ).to.equal( 'function' );

        const samples = [];
        const sampler = setInterval( function () {
            samples.push( emitterHandle.getPressure() );
        }, 10 );  // sample faster — burst is ~200 ms wall-clock
        sampler.unref();

        await handle.whenComplete();
        clearInterval( sampler );

        // Wait for subscriber to drain, then for the unacked counter
        // to empty. Subscriber-receive lags broker-ACK by microseconds;
        // broker-ACK lags the publish callback by a tick or two. The
        // explicit pressure-zero wait closes that gap.
        await waitForIdSet( captured.ids, messageCount, 30000 );
        const drainedPressure = await waitForPressureZero( emitterHandle, 5000 );

        await handle.shutdown( { timeout: 10000 } );
        await captured.close();

        const maxPressure = Math.max( ...samples );
        const minPressure = Math.min( ...samples );
        const overshoots = samples.filter( ( p ) => p > 1.0 ).length;

        console.log( '\n  [pressure-count] run summary:' );
        console.log( `    samples taken:      ${samples.length}` );
        console.log( `    pressure min:       ${minPressure.toFixed( 3 )}` );
        console.log( `    pressure max:       ${maxPressure.toFixed( 3 )}` );
        console.log( `    pressure overshoots (>1.0): ${overshoots}` );
        console.log( `    pressure post-drain: ${drainedPressure.toFixed( 3 )}` );
        console.log( `    received unique:    ${captured.ids.size} of ${messageCount}` );

        expect( samples.length, 'sampler must have fired during run' ).to.be.greaterThan( 5 );
        expect( maxPressure, 'pressure must rise visibly under load' ).to.be.greaterThan( 0 );
        expect( maxPressure, 'pressure must not exceed 1.0' ).to.be.at.most( 1.0 );
        expect( overshoots, 'pressure must never overshoot the documented bound' ).to.equal( 0 );
        expect( drainedPressure, 'pressure must reset to 0 after drain' ).to.be.at.most( 0.001 );
    } );

} );

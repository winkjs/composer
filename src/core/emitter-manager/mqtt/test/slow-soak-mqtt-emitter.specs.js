// core/emitter-manager/mqtt/test/slow-soak-mqtt-emitter.specs.js

/* eslint-disable no-process-env, no-await-in-loop, no-invalid-this,
   no-continue, no-bitwise */

/**
 * @fileoverview Soak test for the MQTT emitter.
 *
 * The short burst tests (10 k, 100 k) cover peak throughput
 * and one-shot drain. They cannot see slow-drift failure modes:
 * memory leaks, throughput degradation, mqtt.js outgoingStore
 * accounting drift, file-descriptor leaks. This soak test runs the
 * emitter at a deployment-realistic sustained rate for a configurable
 * duration and asserts those drift modes don't appear.
 *
 * --------------------------------------------------------------------
 * HOW TO RUN
 * --------------------------------------------------------------------
 *
 *   1. Start Mosquitto with production-leaning config (see
 *      `composer/config/mosquitto.conf`):
 *
 *        docker compose up -d
 *
 *   2. Run the soak via the hardening script with `SOAK_MINUTES`
 *      set:
 *
 *        SOAK_MINUTES=15 npm run test:hardening
 *
 *      Quick smoke (2-minute soak):
 *
 *        SOAK_MINUTES=2 npm run test:hardening
 *
 *      Without `SOAK_MINUTES` (or `SOAK_MINUTES=0`), this test skips
 *      cleanly so the regular hardening tier doesn't pay the cost.
 *
 *      **No programmatic GC.** Unlike the burst tests, the soak does
 *      NOT call `global.gc()` — the goal is to observe what
 *      production sees across natural GC cycles. The burst tests
 *      need a clean heap-delta measurement (one GC at start, one at
 *      end); the soak needs the OPPOSITE — natural-pressure heap
 *      dynamics, with V8 deciding when to GC. Forced GC during a
 *      soak would mask the very pressure dynamics that surface
 *      slow drift.
 *
 * --------------------------------------------------------------------
 * ENV VARS
 * --------------------------------------------------------------------
 *
 *   SOAK_MINUTES        required. Soak duration in minutes (decimal
 *                       OK — `SOAK_MINUTES=0.5` runs 30 seconds).
 *                       0 or unset → test skips.
 *
 *   MQTT_BROKER_URL     defaults to `mqtt://localhost:1883`. Override
 *                       to point at a different broker (e.g., remote
 *                       Mosquitto, AWS IoT). For non-localhost, sized
 *                       expectations below may need adjustment.
 *
 * --------------------------------------------------------------------
 * TUNING CONSTANTS (edit in this file)
 * --------------------------------------------------------------------
 *
 *   TARGET_PRESSURE     0.5  — producer throttles when the unacked
 *                       window is more than half full. Lower = gentler
 *                       load; higher = closer to peak with more
 *                       variance.
 *
 *   PRODUCER_BATCH      100  — publishes per loop iteration. Larger
 *                       reduces per-message overhead; smaller is
 *                       smoother under backpressure.
 *
 *   PRODUCER_PACE_MS    7    — sleep between batches. With BATCH=100
 *                       and PACE=7, target rate is ~14 k msg/s,
 *                       which is 75% of the observed end-to-end peak
 *                       on commodity hardware (~19 k msg/s e2e).
 *                       Adjust these together to target a different
 *                       rate; effective rate is also pressure-bound,
 *                       so lower hardware will self-throttle.
 *
 *   SAMPLE_INTERVAL_MS  60_000 — heap + throughput sample once per
 *                       minute. Per-sample overhead is just a
 *                       `process.memoryUsage()` snapshot — no GC
 *                       trigger (see "no programmatic GC" note above).
 *
 *   maxQueueSize        50000 (passed to createEmitter) — generous
 *                       headroom above the producer's BATCH × in-
 *                       flight count so pre-flight reject is rare.
 *                       Soak tests for high-rate scenarios may need
 *                       larger; tests for backpressure should use
 *                       smaller.
 *
 * --------------------------------------------------------------------
 * WHAT TO OBSERVE
 * --------------------------------------------------------------------
 *
 *   Per-minute log line (printed during the run):
 *
 *     [soak] minute N: produced=X received=Y prodRate=R/s recvRate=R/s
 *                       heap=H MB preflight=P failures=F
 *
 *   Healthy patterns:
 *     - prodRate stable across minutes (no monotonic decrease)
 *     - recvRate within 80% of prodRate (broker keeping up)
 *     - heap oscillates around a stable centre, no upward drift
 *     - preflight rejects 0 or near-0 (sized correctly)
 *     - failures = 0 throughout (no DELIVERY_FAILED)
 *
 *   Final summary (printed at end):
 *     - heap min/max range — a tight range (under ~50 MB) is healthy;
 *       a wide range with high max suggests memory growth
 *     - early-third vs late-third recv rate — close = stable; large
 *       drop = degradation
 *     - **unique received (BitSet)** — count of distinct `_harnessId`
 *       values the subscriber actually saw. The hard delivery check.
 *     - **coverage gaps** — accepted IDs that were never received
 *       (true loss; should be 0 or near-0)
 *     - **duplicates** — received messages whose ID was seen before
 *       (QoS 1 retries; small numbers normal, flood = retry storm)
 *     - **received vs accepted** — `OK (zero loss)` if every accepted
 *       publish was received at least once; `LOSS: N missing` is a
 *       real failure
 *
 * --------------------------------------------------------------------
 * THE RELEASE GATE — SIGNATURE POLICY
 * --------------------------------------------------------------------
 *
 * The gate is strict: every lossy run fails. The run's outcome
 * (shutdown throw, delivery failures, coverage gaps, reconnect count)
 * goes to `evaluateSoakOutcome()` in
 * `src/core/test-utils/soak-signature.js`:
 *
 *   verdict `clean`      — pass.
 *   verdict `regression` — FAIL. The reason names the first
 *                          off-signature fact, or — when the loss
 *                          matches the RETIRED mqtt.js reconnect-clear
 *                          race signature — names that match as the
 *                          first diagnostic lead. Blocks the release.
 *
 * History: the policy originally carried an `acceptable` verdict that
 * tolerated a loss matching the documented upstream race (mqtt.js
 * erases its packet-id bookkeeping on every connection acceptance and
 * rebuilds it from an asynchronous store snapshot; in-flight writes
 * get overwritten). ADR-021 (2026-07-09) moved the emitter onto the
 * SYNCHRONOUS memory store, which closes that race by construction —
 * so on 2026-07-10 the operator retired the tolerance: a verdict that
 * can excuse a loss whose mechanism no longer exists is a hole, not a
 * tolerance. The signature detection survives as diagnostics only.
 *
 * The policy itself is unit-tested (`test-utils/test/
 * soak-signature.specs.js`). The reconnect count comes from the
 * emitter's own `getHealth().stats.reconnects`.
 *
 * --------------------------------------------------------------------
 * WHAT FAILURES MEAN
 * --------------------------------------------------------------------
 *
 *   `delivery failures > 0`         — async publish failure; real
 *                                     bug, investigate err.code and
 *                                     err.cause. Always a regression
 *                                     verdict.
 *
 *   `coverage gaps > floor`          — accepted IDs that the
 *                                     subscriber never received
 *                                     (true loss). With a mid-run
 *                                     reconnect and a bounded count,
 *                                     this is the documented race;
 *                                     otherwise check broker logs
 *                                     (`docker logs mosquitto`) for
 *                                     queue overflow hints, check
 *                                     subscriber config and persistent
 *                                     session state.
 *
 *   `duplicates >> 0`                — QoS 1 retry storm; check for
 *                                     PUBACK loss between subscriber
 *                                     and broker, or broker-side
 *                                     in-flight backlog issues.
 *
 *   `out-of-range ids > 0`           — BitSet was sized too small for
 *                                     the actual production count;
 *                                     bump `EXPECTED_RATE_FOR_SIZING`.
 *
 *   `heap or RSS trend rising`       — likely a leak; the assertions
 *                                     compare early-third vs late-third
 *                                     medians for BOTH `heapUsed` and
 *                                     `rss`. RSS matters because
 *                                     payload Buffers live in native
 *                                     memory that `heapUsed` never
 *                                     sees — a run can look heap-flat
 *                                     while RSS climbs to the roof.
 *                                     Profile with `--inspect` and a
 *                                     heap snapshot.
 *
 *   `late-third < 50% of early-third` — throughput degradation; check
 *                                     mqtt.js queue depth, GC metrics.
 *
 * --------------------------------------------------------------------
 * SCOPE
 * --------------------------------------------------------------------
 *
 * This soak covers part of the 24-hour-soak gap: a full 24-hour run
 * is still needed for true CI-grade soak coverage (file-descriptor
 * drift over days, broker-side queue dynamics).
 * 15 minutes is the smoke-test tier — fast leaks and rapid
 * degradation surface here; slow drift needs the longer window.
 *
 * --------------------------------------------------------------------
 * SUBSCRIBER-SIDE PERSISTENT SESSION (earlier-soak lesson)
 * --------------------------------------------------------------------
 *
 * Earlier soak runs (pre-fix) used the default mqtt.js subscriber
 * options (`clean: true`, auto-generated `clientId`). At subscriber
 * disconnect, broker dropped any messages queued for it — yielding
 * 1 missing in 15 min (10.77 M produced) and 7 missing in 30 min
 * (21.15 M produced). Loss was super-linear: more wall-clock time
 * meant more chances for the disconnect to land in a non-trivial
 * queue state.
 *
 * The fix in this file (see subscriber config below) uses
 * `clean: false` + a stable `clientId`, plus an idle-based catch-up
 * wait that exits when the broker stops delivering rather than after
 * a fixed timeout. Together these eliminate the test artifact and
 * give us a true zero-loss measurement.
 *
 * The same persistence is already correctly defaulted in composer's
 * MQTT *source* (`MQTT_SOURCE_CONFIG.cleanStart: false`,
 * `src/core/source-manager/mqtt/constants.js:75`). The source's only
 * subtlety is that the auto-generated `clientId` (`wink-source-
 * ${Date.now()}`) is process-unique, so cross-process-restart
 * persistence requires the caller to pass a stable `clientId` — a
 * known, still-open documentation gap.
 *
 * Requires Mosquitto via `composer/docker-compose.yml` with
 * production-leaning config (`composer/config/mosquitto.conf`):
 *   - `max_queued_messages 0`     unlimited per-client queue
 *   - `max_inflight_messages 1000` higher in-flight cap for QoS 1
 *   - `persistence false` (default in our config; in-memory session
 *     state is enough — we don't need cross-broker-restart durability
 *     for this test)
 */

import { expect } from 'chai';
import { describe, it, before, beforeEach } from 'mocha';
import mqtt from 'mqtt';

import { jsonCodec } from '../../../codec/index.js';
import { createEmitter } from '../emitter.js';
import { evaluateSoakOutcome } from '../../../test-utils/soak-signature.js';

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const SOAK_MINUTES    = parseFloat( process.env.SOAK_MINUTES || '0' );

const SOAK_MS              = SOAK_MINUTES * 60_000;
const SAMPLE_INTERVAL_MS   = 60_000;
const TARGET_PRESSURE      = 0.5;
const PRODUCER_BATCH       = 100;
const PRODUCER_PACE_MS     = 7;

// Mid-run memory tripwire. The end-of-run median-trend assertions can
// never fire if runaway growth OOM-kills the process first (observed
// 2026-07-08: a stalled delivery path accumulated ~790 MB/min of
// publishes in mqtt.js's in-memory _storeProcessingQueue and Node died
// at its 4 GB heap limit in minute 6 — taking every diagnostic with
// it). The sampler checks each minute and aborts the producer while
// the process is still alive, so the run FAILS with its telemetry
// intact instead of vanishing. Baseline heap for this soak is ~35 MB;
// 1.5 GB is an unambiguous runaway, not a tuning question.
const HEAP_TRIPWIRE_BYTES  = 1_500 * 1024 * 1024;
const RSS_TRIPWIRE_BYTES   = 3_000 * 1024 * 1024;

const formatHeap = function ( bytes ) {
    return `${( bytes / 1024 / 1024 ).toFixed( 1 )} MB`;
};

const median = function ( arr ) {
    const sorted = [ ...arr ].sort( ( a, b ) => a - b );
    const mid = Math.floor( sorted.length / 2 );
    return sorted.length % 2 === 1 ? sorted[ mid ] : ( sorted[ mid - 1 ] + sorted[ mid ] ) / 2;
};

/**
 * Trend assertions over the per-minute samples — memory and throughput.
 *
 * Memory: compare early-third vs late-third MEDIANS. Under natural GC,
 * raw heap oscillates between collections, so max-min range is noisy;
 * the median smooths the oscillation and reveals the trend. If late
 * samples are systematically higher, that's a leak. Up to 100% growth
 * is allowed (warmup amortising into steady state) — anything above
 * 2× the early median is suspect. The same check runs on BOTH
 * `heapUsed` (JS-heap leaks) and `rss` (native leaks — LevelDB block
 * cache, Buffers — that heapUsed cannot see). Memory must hold a
 * stable centre for the whole run, not climb toward the roof.
 *
 * Throughput: late-third median receive rate must stay within 50% of
 * the early third (no progressive degradation).
 *
 * Skips silently when fewer than 3 samples exist (sub-3-minute smoke).
 *
 * @param {Object} trends - per-minute series collected by the sampler
 * @param {Array} trends.samples - full sample objects (length gate)
 * @param {number[]} trends.heapValues - heapUsed per minute
 * @param {number[]} trends.rssValues - rss per minute
 * @param {number[]} trends.recvRates - receive rate per minute
 */
const assertStableTrends = function ( { samples, heapValues, rssValues, recvRates } ) {
    if ( samples.length >= 3 ) {
        const third = Math.floor( samples.length / 3 );
        const earlyHeap = median( heapValues.slice( 0, third ) );
        const lateHeap  = median( heapValues.slice( -third ) );
        console.log( `    early-third median heap: ${formatHeap( earlyHeap )}` );
        console.log( `    late-third median heap:  ${formatHeap( lateHeap )}` );
        expect( lateHeap, 'late-median heap within 2x early-median (no progressive leak)' )
            .to.be.lessThan( earlyHeap * 2 );
        const earlyRss = median( rssValues.slice( 0, third ) );
        const lateRss  = median( rssValues.slice( -third ) );
        console.log( `    early-third median rss:  ${formatHeap( earlyRss )}` );
        console.log( `    late-third median rss:   ${formatHeap( lateRss )}` );
        expect( lateRss, 'late-median rss within 2x early-median (no native-memory leak)' )
            .to.be.lessThan( earlyRss * 2 );
    }
    if ( recvRates.length >= 3 ) {
        const third = Math.floor( recvRates.length / 3 );
        const earlyRate = median( recvRates.slice( 0, third ) );
        const lateRate  = median( recvRates.slice( -third ) );
        console.log( `    early-third median rate: ${earlyRate.toFixed( 0 )} msg/s` );
        console.log( `    late-third median rate:  ${lateRate.toFixed( 0 )} msg/s` );
        expect( lateRate, 'late throughput within 50% of early throughput' )
            .to.be.greaterThan( earlyRate * 0.5 );
    }
}; // assertStableTrends()

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

describe( 'MQTT Emitter Soak — sustained run', function () {

    // Time budget: SOAK_MINUTES + 5 minutes for setup, drain, assertions.
    this.timeout( ( SOAK_MINUTES + 5 ) * 60_000 );

    if ( SOAK_MINUTES <= 0 ) {
        it( 'soak test skipped (set SOAK_MINUTES env var to run)', function () {
            this.skip();
        } );
        return;
    }

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

    it( `runs ${SOAK_MINUTES} min at ~${Math.floor( PRODUCER_BATCH * 1000 / PRODUCER_PACE_MS )} msg/s with bounded heap and stable throughput`, async function () {
        const topic = `soak/${Date.now()}/samples`;

        // Subscriber configuration — three deliberate choices, each
        // for a specific reason:
        //
        //   1. **QoS 1 on subscribe** (set on the call below). Broker
        //      uses the subscribe-QoS to forward, so QoS 1 makes
        //      broker→subscriber at-least-once with PUBACK + flow
        //      control. QoS 0 fire-and-forget would drop on TCP-buffer
        //      pressure (the original burst-test finding).
        //
        //   2. **Persistent session via `clean: false` + stable
        //      `clientId`**. Without this, the broker forgets the
        //      subscriber's queued messages on disconnect, and any
        //      in-flight at the disconnect window are lost. Earlier
        //      soak runs surfaced this: the 15-min run lost 1 message,
        //      the 30-min run lost 7 — super-linear growth driven by
        //      "more chances for the disconnect to land in a non-trivial
        //      queue state." With persistent session, broker keeps the
        //      queue across disconnects (in-memory persistence is
        //      enough for this — Mosquitto keeps session state in RAM
        //      while the broker is up, even with disk `persistence
        //      false`). The stable clientId is essential — auto-
        //      generated IDs change per process and break session
        //      continuity.
        //
        //   3. **BitSet-based ID coverage** (not a JS Set). At
        //      ~12 k msg/s for 120 min, the test produces ~86 M
        //      messages — a `Set<number>` of that size would
        //      dominate test heap (>2 GB) and ruin the leak signal.
        //      But pure counting (the previous design) lets a
        //      duplicate-plus-loss masking case slip through (e.g.,
        //      100 dup + 100 lost = "looks fine" but has 100 actual
        //      losses). Solution: pre-allocated `Uint8Array` bitset,
        //      one bit per expected ID. ~12 MB for 100 M IDs. Detects
        //      true loss (gaps) AND duplicates (bit-already-set on
        //      receive). Adds a constant ~12 MB to baseline heap
        //      that the leak-detection median-comparison naturally
        //      sees through.
        const subscriberClientId = `soak-sub-${Date.now()}`;
        const subscriber = mqtt.connect( MQTT_BROKER_URL, {
            reconnectPeriod: 0,
            clean: false,
            clientId: subscriberClientId
        } );
        await new Promise( ( r ) => subscriber.on( 'connect', r ) );

        // Mutable counter shared across producer + sampler + final
        // assertion. Wrapped in a single-property object so the loop-
        // condition lint check sees the variable as "modified" — Node's
        // eslint config doesn't trace mutations through closures.
        const stats = {
            produced: 0,
            received: 0,
            duplicates: 0,
            outOfRangeIds: 0,
            preflightRejects: 0,
            stopProducer: false
        };

        // BitSet for per-ID receive tracking. Sized at SOAK_MINUTES *
        // 60s * EXPECTED_RATE * 1.5 headroom for safety. EXPECTED_RATE
        // includes producer-side burst headroom; we'll never reach it,
        // but oversizing avoids out-of-range messages dropping into the
        // `outOfRangeIds` bucket on a faster-than-expected run.
        const EXPECTED_RATE_FOR_SIZING = 14000;
        const ID_CAPACITY = Math.max(
            1_000_000,                    // floor for short smoke runs
            Math.ceil( SOAK_MINUTES * 60 * EXPECTED_RATE_FOR_SIZING * 1.5 )
        );
        const receivedBits = new Uint8Array( Math.ceil( ID_CAPACITY / 8 ) );
        // Preflight-rejected IDs — typically empty (queue sized above
        // burst), but tracked individually so the final coverage check
        // can exclude them (they never reached the broker).
        const rejectedIds = new Set();

        subscriber.on( 'message', function ( _topic, payload ) {
            stats.received += 1;
            let id;
            try {
                // eslint-disable-next-line no-underscore-dangle
                id = jsonCodec.unpack( payload )._harnessId;
            } catch {
                return;     // foreign payload, skip
            }
            if ( typeof id !== 'number' || id < 0 || id >= ID_CAPACITY ) {
                stats.outOfRangeIds += 1;
                return;
            }
            const byteIdx = id >>> 3;
            const bitMask = 1 << ( id & 7 );
            if ( receivedBits[ byteIdx ] & bitMask ) {
                stats.duplicates += 1;
            } else {
                receivedBits[ byteIdx ] |= bitMask;
            }
        } );
        await new Promise( function ( resolve, reject ) {
            subscriber.subscribe( topic, { qos: 1 }, function ( err ) {
                if ( err ) reject( err );
                else resolve();
            } );
        } );

        const deliveryFailures = [];
        const criticalCalls = [];

        // Direct emitter — bypassing the flow API so we can pace the
        // producer ourselves via getPressure() feedback. Awaited: with
        // the default grace the factory resolves on the real connack.
        const emitter = await createEmitter( {
            brokerUrl: MQTT_BROKER_URL,
            codec: jsonCodec,
            maxQueueSize: 50000,
            onDeliveryFailure: function ( err, ctx ) {
                deliveryFailures.push( { code: err.code, message: err.message, topic: ctx.topic } );
            },
            onCritical: function ( reason, pressure ) {
                criticalCalls.push( { reason, pressure } );
            }
        } );

        // Producer loop — batches publishes, throttles via pressure.
        // Tracks per-ID rejection so the final coverage check can
        // exclude rejected IDs from the "should-have-been-received"
        // set (they never reached the broker, so the bit will never
        // be set; they're not loss).
        const producerLoop = async function () {
            while ( !stats.stopProducer ) {
                if ( emitter.getPressure() > TARGET_PRESSURE ) {
                    await new Promise( ( r ) => setTimeout( r, 10 ) );
                    continue;
                }
                for ( let i = 0; i < PRODUCER_BATCH; i += 1 ) {
                    const id = stats.produced + i;
                    const msg = { _harnessId: id, ts: Date.now(), value: i };
                    const result = emitter.publishNow( topic, msg );
                    if ( !result.ok ) {
                        stats.preflightRejects += 1;
                        rejectedIds.add( id );
                    }
                }
                stats.produced += PRODUCER_BATCH;
                await new Promise( ( r ) => setTimeout( r, PRODUCER_PACE_MS ) );
            }
        };

        // Sampler — runs once per minute, captures heap + per-minute rate.
        // Tracks a sample-index counter rather than computing a "minute"
        // from elapsed time; setTimeout drift makes elapsed-based
        // calculation print "minute 17" twice and skip "minute 20" on
        // long runs (each sample drifts a few ms; eventually adjacent
        // samples' Math.floor lands on the same integer or skips one).
        // Sample-index is monotonic by construction.
        const samples = [];
        const startedAt = Date.now();
        let lastProducedSample = 0;
        let lastReceivedSample = 0;
        let sampleIndex = 0;
        let memoryTripwire = null;

        const samplerLoop = async function () {
            while ( !stats.stopProducer ) {
                await new Promise( ( r ) => setTimeout( r, SAMPLE_INTERVAL_MS ) );
                if ( stats.stopProducer ) break;
                sampleIndex += 1;
                // Sample heapUsed AND rss: payload Buffers live in
                // native memory that heapUsed never sees. A leak there
                // shows only in rss.
                const mem = process.memoryUsage();
                const heap = mem.heapUsed;
                const rss = mem.rss;
                const dProd = stats.produced - lastProducedSample;
                const dRecv = stats.received - lastReceivedSample;
                lastProducedSample = stats.produced;
                lastReceivedSample = stats.received;
                samples.push( { minute: sampleIndex, heap, rss, prodRate: dProd / 60, recvRate: dRecv / 60 } );
                console.log(
                    `  [soak] minute ${sampleIndex}: produced=${stats.produced} received=${stats.received} ` +
                    `prodRate=${( dProd / 60 ).toFixed( 0 )}/s recvRate=${( dRecv / 60 ).toFixed( 0 )}/s ` +
                    `heap=${formatHeap( heap )} rss=${formatHeap( rss )} preflight=${stats.preflightRejects} failures=${deliveryFailures.length}`
                );
                // Memory tripwire — abort the producer NOW so the run
                // fails with telemetry instead of OOM-dying at the roof.
                if ( heap > HEAP_TRIPWIRE_BYTES || rss > RSS_TRIPWIRE_BYTES ) {
                    memoryTripwire = `minute ${sampleIndex}: heap ${formatHeap( heap )} / rss ${formatHeap( rss )} ` +
                        `crossed the tripwire (${formatHeap( HEAP_TRIPWIRE_BYTES )} heap / ${formatHeap( RSS_TRIPWIRE_BYTES )} rss)`;
                    console.log( `  [soak] MEMORY TRIPWIRE — ${memoryTripwire}; stopping producer` );
                    stats.stopProducer = true;
                }
            }
        };

        // Kick off producer + sampler in parallel; wait for SOAK_MS.
        const producerPromise = producerLoop();
        const samplerPromise  = samplerLoop();
        await new Promise( ( r ) => setTimeout( r, SOAK_MS ) );
        stats.stopProducer = true;
        await producerPromise;
        await samplerPromise;

        // Reconnect count — snapshot BEFORE shutdown (a reconnect
        // during teardown is not a "mid-run" reconnect for the
        // signature policy).
        const reconnects = emitter.getHealth().stats.reconnects;

        // Drain — give the broker time to forward the last in-flight.
        // A shutdown throw is CAPTURED, not rethrown: the run's verdict
        // comes from the signature policy after the coverage check, so
        // the summary and the subscriber catch-up always run.
        const tShutdownStart = Date.now();
        let shutdownError = null;
        try {
            await emitter.shutdown( { timeout: 60_000 } );
        } catch ( err ) {
            shutdownError = err;
            console.log( `  [soak] lossy shutdown: ${err.message}` );
            console.log( `  [soak] deliveryFailures (${deliveryFailures.length} total, first 10):` );
            for ( const f of deliveryFailures.slice( 0, 10 ) ) {
                console.log( `    - ${f.code}: ${f.message} (topic: ${f.topic})` );
            }
        }
        const drainMs = Date.now() - tShutdownStart;

        // Subscriber catch-up — IDLE-based wait rather than a fixed
        // timeout. Exit when either:
        //   (a) receive count reaches accepted count (clean drain), or
        //   (b) no new receive has landed for `IDLE_DRAIN_MS` (broker
        //       has truly stopped delivering — anything else stuck on
        //       broker's queue is unreachable for this subscriber).
        // Hard-capped at 5 minutes to bound test wall-clock.
        //
        // Why idle-based instead of fixed timeout:
        //   - At 12 k msg/s with a few hundred messages in flight at
        //     producer-stop, drain takes seconds, not minutes. A 90 s
        //     fixed wait wastes 80+ s on the happy path.
        //   - When messages ARE stuck on broker's queue (rare with
        //     persistent session above), the receive-count goes
        //     silent — idle detection catches that immediately rather
        //     than waiting out the full timeout.
        //
        // Variables (stats.received) ARE mutated by the subscriber's
        // message handler.
        const IDLE_DRAIN_MS = 5_000;
        const MAX_DRAIN_MS  = 300_000;
        const subscriberWaitStart = Date.now();
        const targetReceived = stats.produced - stats.preflightRejects;
        let lastReceiveCount = stats.received;
        let lastReceiveAt = Date.now();
        while ( ( Date.now() - subscriberWaitStart ) < MAX_DRAIN_MS ) {
            if ( stats.received >= targetReceived ) break;
            if ( stats.received !== lastReceiveCount ) {
                lastReceiveCount = stats.received;
                lastReceiveAt = Date.now();
            } else if ( ( Date.now() - lastReceiveAt ) > IDLE_DRAIN_MS ) {
                break;
            }
            await new Promise( ( r ) => setTimeout( r, 100 ) );
        }
        const subscriberWaitMs = Date.now() - subscriberWaitStart;

        await new Promise( function ( resolve ) {
            subscriber.end( true, {}, resolve );
        } );

        // Final readout — no GC trigger; we want what production sees
        // when shutdown completes (V8 may or may not have collected
        // recent garbage, that's the real picture).
        const finalHeap = process.memoryUsage().heapUsed;
        const totalMs = Date.now() - startedAt;
        const accepted = stats.produced - stats.preflightRejects;
        const overallProdRate = ( stats.produced / totalMs ) * 1000;
        const overallRecvRate = ( stats.received / totalMs ) * 1000;

        // Memory-trend signals: heapUsed for JS-heap leaks, rss for
        // native leaks (Buffers) the JS heap never sees.
        // Monotonic upward trend across minutes would mean a leak;
        // bounded oscillation around a stable centre is healthy.
        const heapValues = samples.map( ( s ) => s.heap );
        const heapMin    = heapValues.length > 0 ? Math.min( ...heapValues ) : 0;
        const heapMax    = heapValues.length > 0 ? Math.max( ...heapValues ) : 0;
        const heapRange  = heapMax - heapMin;
        const rssValues  = samples.map( ( s ) => s.rss );
        const rssMin     = rssValues.length > 0 ? Math.min( ...rssValues ) : 0;
        const rssMax     = rssValues.length > 0 ? Math.max( ...rssValues ) : 0;

        // Per-minute receive rate stability — degradation would show
        // as later samples being significantly lower than earlier.
        const recvRates = samples.map( ( s ) => s.recvRate );
        const recvMin   = recvRates.length > 0 ? Math.min( ...recvRates ) : 0;
        const recvMax   = recvRates.length > 0 ? Math.max( ...recvRates ) : 0;

        // **BitSet coverage check** — true loss / duplicate accounting.
        // Iterate every produced ID and verify its bit was set by the
        // subscriber's on('message') handler. Skip pre-flight-rejected
        // IDs (they never reached the broker, so absence is expected).
        // This catches the duplicate-plus-loss masking case that pure
        // count-equality misses.
        let uniqueReceived = 0;
        let coverageGaps   = 0;
        for ( let id = 0; id < stats.produced; id += 1 ) {
            if ( rejectedIds.has( id ) ) continue;
            const byteIdx = id >>> 3;
            const bitMask = 1 << ( id & 7 );
            if ( receivedBits[ byteIdx ] & bitMask ) {
                uniqueReceived += 1;
            } else {
                coverageGaps += 1;
            }
        }

        console.log( '\n  [soak] final summary:' );
        console.log( `    soak duration:       ${SOAK_MINUTES} min (${totalMs} ms total)` );
        console.log( `    produced:            ${stats.produced}` );
        console.log( `    pre-flight rejects:  ${stats.preflightRejects} (${( ( stats.preflightRejects / stats.produced ) * 100 ).toFixed( 2 )}%)` );
        console.log( `    accepted:            ${accepted}` );
        console.log( `    received (raw count): ${stats.received}` );
        console.log( `    unique received (BitSet): ${uniqueReceived}` );
        console.log( `    coverage gaps:       ${coverageGaps}` );
        console.log( `    duplicates:          ${stats.duplicates}` );
        console.log( `    out-of-range ids:    ${stats.outOfRangeIds}` );
        console.log( `    received vs accepted: ${uniqueReceived >= accepted ? 'OK (zero loss)' : 'LOSS: ' + coverageGaps + ' missing of ' + accepted} ` );
        console.log( `    overall prod rate:   ${overallProdRate.toFixed( 0 )} msg/s` );
        console.log( `    overall recv rate:   ${overallRecvRate.toFixed( 0 )} msg/s` );
        console.log( `    drain time:          ${drainMs} ms` );
        console.log( `    subscriber catch-up: ${subscriberWaitMs} ms` );
        console.log( `    heap min/max:        ${formatHeap( heapMin )} / ${formatHeap( heapMax )} (range ${formatHeap( heapRange )})` );
        console.log( `    rss min/max:         ${formatHeap( rssMin )} / ${formatHeap( rssMax )} (range ${formatHeap( rssMax - rssMin )})` );
        console.log( `    final heap:          ${formatHeap( finalHeap )}` );
        console.log( `    recv rate min/max:   ${recvMin.toFixed( 0 )} / ${recvMax.toFixed( 0 )} msg/s` );
        console.log( `    delivery failures:   ${deliveryFailures.length}` );
        console.log( `    onCritical calls:    ${criticalCalls.length}` );
        console.log( `    reconnects:          ${reconnects}` );
        console.log( `    shutdown:            ${shutdownError ? `THREW [${shutdownError.code}]` : 'clean resolve'}` );

        // Hard assertions:
        // 0. The memory tripwire did not fire. First and loudest: a
        //    tripped run means runaway in-process accumulation — the
        //    delivery verdict below is secondary to that.
        expect( memoryTripwire, `memory stayed bounded for the whole run — tripped: ${memoryTripwire}` )
            .to.equal( null );
        // 1+2. The signature policy judges the delivery outcome as one
        //    unit — shutdown throw, delivery failures, coverage gaps,
        //    and the reconnect count together. Since the 2026-07-10
        //    ruling the gate is strict: any non-clean verdict fails,
        //    and the reason carries the diagnosis (including whether
        //    the loss matches the retired reconnect-clear signature).
        const outcome = evaluateSoakOutcome( {
            shutdownError,
            deliveryFailures,
            coverageGaps,
            accepted,
            reconnects
        } );
        console.log( `    verdict:             ${outcome.verdict.toUpperCase()} — ${outcome.reason}` );
        expect( outcome.verdict, `release gate: ${outcome.reason}` )
            .to.equal( 'clean' );
        // 3. Out-of-range IDs should never happen — would indicate the
        //    BitSet was sized too small for the actual production count.
        expect( stats.outOfRangeIds, 'no out-of-range ids (BitSet capacity sufficient)' )
            .to.equal( 0 );
        // 4 + 5. Memory trends (heap AND rss) + receive-rate stability —
        //    extracted to `assertStableTrends` above, which owns the
        //    median-comparison rationale.
        assertStableTrends( { samples, heapValues, rssValues, recvRates } );
    } );

} );

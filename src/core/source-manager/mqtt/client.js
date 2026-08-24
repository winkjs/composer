// core/source-manager/mqtt/client.js

/**
 * @fileoverview MQTT client wrapper for source adapter.
 *
 * Handles:
 * - MQTT v5 connection with session persistence
 * - Topic subscription with QoS 1
 * - Deduplication via winkDedupId from user properties (ADR-022)
 * - Automatic reconnection on disconnect (owned by mqtt.js, as
 *   ADR-018 requires — reconnection is the transport library's job)
 * - Structured health/metrics reporting (via status.js)
 * - Graceful shutdown with a time budget
 *
 * Message flow:
 *   MQTT broker → subscribe → extract userProperties → check dedup cache
 *       → if duplicate: skip, count (dedupHits — not a status event)
 *       → if new: decode payload → shape guard + metadata attach
 *         → transform (optional) → onMessage(msg)
 *
 * Status shape — the ADR-018 core, plus this adapter's additions:
 *   `{status: 'green' | 'yellow' | 'red', connected, phase,
 *     error?: {code, message}}` is the shape every source shares;
 *   `msSinceLastMsg` and `note?` are MQTT-source extras.
 * Phases: `starting` → `running`, transient `offline` / `reconnecting`
 * while mqtt.js retries, `stopped` on stop. This source never emits
 * `phase: 'errored'`: mqtt.js retries forever (the ADR-018 recovering
 * posture), so there is no give-up path. A permanent outage is visible
 * as a red CONNECTION_LOST whose `connected: false` never clears — a
 * limit ADR-018 accepts for recovering sources: a wrong address and a
 * long outage look identical from here.
 *
 * `err.code` vocabulary (per-adapter, documented here per ADR-018):
 * - `INVALID_CONFIG`         — setup-time; missing or malformed config
 *   field. Thrown synchronously from the factory (ADR-018 fail-fast
 *   setup), never emitted.
 * - `DECODE_ERROR`           — runtime, yellow. Two faces: a per-record
 *   report for every payload that does not yield a usable record, and
 *   a health flip when the decode-error ratio over the last 1,000
 *   messages exceeds 1 %. The per-record face covers more than parse
 *   failures (a widening of ADR-018 §9's original wording): a payload
 *   that decodes to a scalar, null, or a bare array is rejected too,
 *   and so is a record the metadata attach cannot write to (a frozen
 *   record from a custom codec). Skip, classify, continue — the
 *   report names what arrived. A bare scalar landing here usually
 *   means a too-wide topic subscription; narrow the topic filter.
 * - `CALLBACK_FAILED`        — runtime, yellow. The user's `transform`
 *   threw, or returned a scalar or array where a record object was
 *   needed; that one message is skipped (counted in `skipped`) and
 *   the stream continues. Fix the transform function — the report
 *   names the topic and the fault. A null/undefined return is NOT
 *   this case: it is the documented intentional drop. Uniform with
 *   the CSV source (transform contract, 2026-07-11).
 * - `SUBSCRIBE_FAILED`       — runtime, red. The broker refused the
 *   subscription (typically ACL). Red immediately: nothing retries a
 *   subscribe until the next reconnect, so a deaf-but-connected source
 *   would otherwise look healthy forever.
 * - `CONNECT_FAILED`         — runtime, yellow. A transport-level error
 *   while the library retries (or a rare error event while running).
 *   Attached to the transient status once per retry streak — a storm
 *   of identical failures cannot flood the channel.
 * - `CONNECTION_LOST`        — runtime, red. Disconnected for more than
 *   30 s (strictly greater) while the library keeps retrying.
 * - `QUIET_PERIOD_EXCEEDED`  — runtime, yellow, opt-in. No packet for
 *   longer than the configured `expectedQuietPeriodMs`.
 *
 * Metrics (optional `onMetrics`, ~1 Hz + on transitions): monotonic
 * counters `{delivered, skipped, decodeErrors, reconnects, dedupHits,
 * dedupMisses, dedupBypassed, dedupCacheSize}`. `dedupBypassed` counts
 * messages that arrived without a `winkDedupId` — the signal that a
 * publisher is not stamping ids (dedup is opt-in by construction).
 *
 *   ASSUMPTIONS
 *   -----------
 *   1. The broker speaks MQTT v5 and has session persistence enabled.
 *      The queued-while-disconnected guarantee is the BROKER's — a
 *      broker without persistence (default Mosquitto image) accepts
 *      the connection but keeps nothing (see constants.js).
 *   2. mqtt.js owns reconnection entirely (ADR-018: reconnection is
 *      the transport library's job). This file
 *      never retries anything itself.
 *   3. `onMessage` keeps up with the arrival rate. Delivery is
 *      fire-and-forget; a consumer slower than the broker backs up
 *      in Node's socket buffer and mqtt.js's queue, not here.
 *   4. Publishers that want duplicate protection stamp `winkDedupId`
 *      (the emitter does). Unstamped messages pass through unfiltered
 *      and are counted in `dedupBypassed`.
 *
 *   LIMITATIONS
 *   -----------
 *   1. QoS 1 is at-least-once: duplicates WILL arrive after connection
 *      breaks. The dedup cache drops repeats within its time/count
 *      bounds (ADR-022); beyond them — or after a subscriber restart —
 *      QuestDB's at-rest dedup is the backstop.
 *   2. No broker-level flow control: the source never delays PUBACK,
 *      so nothing tells the broker to slow down (an opt-in
 *      `flowControl` is future work, post-release).
 *   3. No give-up path: mqtt.js retries forever, so a wrong broker
 *      address and a long outage look identical from here (a limit
 *      ADR-018 accepts for recovering sources) — both
 *      show as red CONNECTION_LOST whose `connected: false` never
 *      clears. The operator tells them apart, not the code.
 *   4. Safe to kill and re-create: no disk state, no side effects.
 *      The cost of a crash is the dedup cache (see dedup.js).
 *
 * Performance (benchmark/mqtt-source/BASELINE.md, 2026-04-24, M4 Max;
 * pre-ADR-022 dedup, whose replacement has the same O(1) per-message
 * profile): composer's own decode/dedup/dispatch path sustains
 * 897 k msg/s at 100 B payloads (317 k at 1 KB); end-to-end through
 * Mosquitto at QoS 1 the single-process ceiling was ~12.9 k msg/s —
 * owned by mqtt.js and the broker round-trip, not this code. At
 * 10 k msg/s steady state every cell ran clean; a 30 M-message run
 * showed no subscriber-side leak.
 *
 * @see src/core/source-manager/mqtt/status.js - The reporting rules
 * @see src/core/emitter-manager/mqtt/emitter.js - Emitter counterpart
 */

import mqtt from 'mqtt';

import {
    MQTT_SOURCE_CONFIG,
    QOS,
    WINK_NAMESPACE,
    DEFAULT_DEDUP_WINDOW_MS,
    DEFAULT_DEDUP_MAX_ENTRIES,
    METRICS_INTERVAL_MS
} from './constants.js';
import { createDedupCache } from './dedup.js';
import { createStatusReporter } from './status.js';
import { isUsableRecord, describeShape } from '../record-shape.js';

// ============================================================================
// CLIENT FACTORY
// ============================================================================

/**
 * Create MQTT source client with deduplication and structured
 * health/metrics reporting.
 *
 * @param {Object} config - Client configuration
 * @param {string} config.brokerUrl - MQTT broker URL (e.g., 'mqtt://localhost:1883')
 * @param {string|string[]} config.topics - Topic(s) to subscribe to (supports wildcards)
 * @param {function} config.onMessage - Message handler: (message) => void
 * @param {Object} [config.codec] - Codec for payload decoding (default: JSON.parse)
 * @param {function} [config.transform] - Optional message transform:
 *   (msg) => transformedMsg; return null/undefined to drop (counted in
 *   skipped); a throw or a scalar/array return skips the message
 *   (CALLBACK_FAILED) and the stream continues
 * @param {number} [config.dedupWindowMs=120000] - Dedup time bound (ADR-022)
 * @param {number} [config.dedupMaxEntries=65536] - Dedup count cap (ADR-022)
 * @param {string} [config.clientId] - MQTT client ID (auto-generated if omitted)
 * @param {function} [config.onStatus] - Status callback; receives the
 *   structured ADR-018 status payload on every transition and per decode
 *   failure (see the fileoverview for the full vocabulary)
 * @param {function} [config.onMetrics] - Counter-snapshot callback,
 *   called at ~1 Hz and on every health transition
 * @param {number} [config.expectedQuietPeriodMs] - Opt-in quiet rule:
 *   health goes yellow when no packet arrives for longer than this
 * @param {boolean} [config.cleanStart] - Override MQTT cleanStart (default: false for persistent sessions)
 * @param {function} [config.mqttConnectFn] - MQTT connect function (for testing)
 * @returns {function} Stop function that returns a Promise
 */
const createMQTTSourceClient = function ( config ) {
    const {
        brokerUrl,
        topics,
        onMessage,
        codec,
        transform,
        dedupWindowMs = DEFAULT_DEDUP_WINDOW_MS,
        dedupMaxEntries = DEFAULT_DEDUP_MAX_ENTRIES,
        clientId,
        onStatus,
        onMetrics,
        expectedQuietPeriodMs,
        cleanStart,
        mqttConnectFn = mqtt.connect
    } = config;

    // Validate required config. Per ADR-018, setup-time throws carry
    // classified err.code (INVALID_CONFIG for missing/malformed config fields).
    if ( !brokerUrl ) {
        const err = new Error( 'WinkComposer/mqtt-source: brokerUrl is required' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }
    if ( !topics || ( Array.isArray( topics ) && topics.length === 0 ) ) {
        const err = new Error( 'WinkComposer/mqtt-source: topics is required' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }
    if ( typeof onMessage !== 'function' ) {
        const err = new Error( 'WinkComposer/mqtt-source: onMessage must be a function' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }

    // Normalize topics to array
    const topicList = Array.isArray( topics ) ? topics : [ topics ];

    // Create dedup cache — time-bounded, count-capped (ADR-022)
    const dedup = createDedupCache( { windowMs: dedupWindowMs, maxEntries: dedupMaxEntries } );

    // The status reporter owns every emission rule (status.js). It
    // validates onStatus / onMetrics / expectedQuietPeriodMs itself,
    // so ALL setup throws happen before any side effect below.
    const reporter = createStatusReporter( {
        onStatus,
        onMetrics,
        expectedQuietPeriodMs,
        dedupSizeFn: dedup.size
    } );

    reporter.starting();

    // Generate client ID if not provided
    const generatedClientId = clientId || `wink-source-${Date.now()}`;

    // A persistent session is filed at the broker under the client's
    // name. The auto-generated name changes on every start, so the
    // backlog the broker saved under the previous run's name is never
    // delivered — it waits, unclaimed, until the session expires.
    // Warn once at startup; the fix is one config line. Setup path
    // only — nothing here touches the message path.
    if ( !clientId && cleanStart !== true ) {
        console.warn(
            'WinkComposer/mqtt-source: no clientId configured — this session ' +
            `is persistent under the auto-generated name '${generatedClientId}'. ` +
            'After a restart, composer connects under a NEW name, so messages ' +
            'the broker saved during the downtime are never delivered. Set a ' +
            'fixed clientId (unique on your broker) in the source config.'
        );
    }

    // Build MQTT options, allowing cleanStart override
    const mqttOptions = {
        ...MQTT_SOURCE_CONFIG,
        clientId: generatedClientId
    };

    // Map the user-facing `cleanStart` key (MQTT 5 term) onto the
    // option name mqtt.js reads (`clean`). See constants.js for the
    // 2026-07-09 defect this spelling closed.
    if ( cleanStart !== undefined ) {
        mqttOptions.clean = cleanStart;
    }

    // Create MQTT client
    const client = mqttConnectFn( brokerUrl, mqttOptions );

    // One heartbeat per second: re-evaluates the time-based health
    // rules (a silent source produces no events to evaluate on) and
    // drives the onMetrics cadence. unref'd so a stopping process is
    // not held alive by observability.
    const cadence = setInterval( reporter.tick, METRICS_INTERVAL_MS );
    cadence.unref();

    // Track subscription state
    let isSubscribed = false;

    // ========================================================================
    // EVENT HANDLERS
    // ========================================================================

    client.on( 'connect', function () {
        reporter.connected();

        // Subscribe to topics
        client.subscribe( topicList, { qos: QOS }, function ( err ) {
            if ( err ) {
                reporter.subscribeFailed( err );
            } else {
                isSubscribed = true;
                reporter.subscribed();
            }
        } );
    } );

    client.on( 'message', function ( topic, payload, packet ) {
        // Extract dedupId from MQTT v5 user properties. Guard instead
        // of `|| {}` — the fallback object would be a fresh per-message
        // allocation for every publisher that stamps no properties.
        const userProps = packet.properties && packet.properties.userProperties;
        const dedupId = userProps ? userProps[ WINK_NAMESPACE.dedupId ] : undefined;

        // Dedup is opt-in by construction (ADR-022): no id → bypass.
        if ( dedupId === null || dedupId === undefined ) {
            reporter.bypassed();
        } else if ( dedup.isDuplicate( dedupId ) ) {
            reporter.dupSkipped();
            return;
        } else {
            reporter.idAccepted();
        }

        // Decode payload, check its shape, and attach metadata — one
        // guarded region. A failure anywhere in it is skipped,
        // classified, and reported per record (ADR-018) — the stream
        // continues. The shape guard is needed because a valid JSON
        // document can be a scalar or a bare array; the attach is
        // inside the guard because a codec can return a frozen record
        // (or one with a non-writable _topic), and the assignment then
        // throws in strict mode. decodeOk() runs only when the whole
        // record survived, so the ring gets exactly one entry per
        // message.
        let message;
        try {
            if ( codec && typeof codec.unpack === 'function' ) {
                message = codec.unpack( payload );
            } else {
                message = JSON.parse( payload.toString() );
            }

            if ( !isUsableRecord( message ) ) {
                reporter.decodeFailed( `topic '${topic}': payload decoded to ${describeShape( message )} — a record object is required — message skipped` );
                return;
            }

            // Attach metadata for downstream use
            message._topic = topic;  // eslint-disable-line no-underscore-dangle
            message._dedupId = dedupId;  // eslint-disable-line no-underscore-dangle

            reporter.decodeOk();
        } catch ( err ) {
            reporter.decodeFailed( `topic '${topic}': ${err.message} — message skipped` );
            return;
        }

        // Apply optional transform. Guarded: a throw skips this one
        // message with a per-record CALLBACK_FAILED report and the
        // stream continues — user code must never propagate into
        // mqtt.js's event processing (transform contract, 2026-07-11).
        // The return is held to the same record shape as the payload:
        // null/undefined stays the intentional silent drop; a scalar
        // or array return is one per-record CALLBACK_FAILED. The
        // shape check runs only when a transform is configured, so
        // the plain path pays nothing for it.
        let finalMessage;
        if ( transform ) {
            try {
                finalMessage = transform( message );
            } catch ( err ) {
                reporter.transformFailed( `topic '${topic}': transform threw: ${err.message} — message skipped` );
                return;
            }
            if ( finalMessage === null || finalMessage === undefined ) {
                reporter.transformDropped();
                return;
            }
            if ( !isUsableRecord( finalMessage ) ) {
                reporter.transformFailed( `topic '${topic}': transform returned ${describeShape( finalMessage )} — a record object (or null/undefined to drop) is required — message skipped` );
                return;
            }
        } else {
            finalMessage = message;
        }

        // Deliver to handler
        onMessage( finalMessage );
        reporter.delivered();
    } );

    client.on( 'offline', function () {
        isSubscribed = false;
        reporter.offline();
    } );

    client.on( 'error', function ( err ) {
        reporter.connectError( err );
    } );

    client.on( 'reconnect', function () {
        reporter.reconnecting();
    } );

    // ========================================================================
    // STOP FUNCTION
    // ========================================================================

    /**
     * Stop the MQTT client, with a time budget.
     *
     * Per ADR-018, source stop functions take a `{ timeout }`. We
     * first ask the broker for a clean disconnect (`client.end(false)`),
     * which waits for any messages still being sent. If that does not
     * finish within `timeout` ms, we ask for a forced disconnect
     * (`client.end(true)`), which closes the socket right away — so the
     * rest of the shutdown can proceed even if the broker is slow or
     * unreachable. The forced path is reported with the sources' shared
     * `note` convention.
     *
     * The timer is `unref()`ed so it does not keep Node alive while a
     * clean disconnect is in progress.
     *
     * Default time budget (5000 ms) matches what sinks use.
     *
     * @param {Object} [options] - Stop options
     * @param {number} [options.timeout=5000] - Max ms to wait for clean disconnect
     * @returns {Promise<void>} Resolves once the client is closed (clean or forced)
     */
    const stop = function ( { timeout = 5000 } = {} ) {
        clearInterval( cadence );
        return new Promise( function ( resolve ) {
            let settled = false;
            let forceTimer = null;
            const onClosed = function () {
                if ( settled ) return;
                settled = true;
                if ( forceTimer ) clearTimeout( forceTimer );
                reporter.stopped();
                resolve();
            };
            forceTimer = setTimeout( function () {

                /* c8 ignore next -- defensive: settle always clears this timer (it is assigned before client.end can call back), so reaching here settled requires the timer callback to already sit in the event queue when settle runs — a race with no producer in the current design. Same guard shape as the testHarness stop. */
                if ( settled ) return;
                reporter.stopForced( timeout );
                client.end( true, {}, onClosed );
            }, timeout );
            // Don't keep Node alive on the timer while the broker is
            // closing cleanly. Either path resolves the Promise.
            forceTimer.unref();
            client.end( false, {}, onClosed );
        } );
    };

    // Expose for testing
    /* eslint-disable no-underscore-dangle */
    stop._client = client;
    stop._dedup = dedup;
    stop._isSubscribed = function () {
        return isSubscribed;
    };
    stop._metrics = reporter.snapshot;
    /* eslint-enable no-underscore-dangle */

    return stop;
};

// ============================================================================
// EXPORTS
// ============================================================================

export { createMQTTSourceClient };

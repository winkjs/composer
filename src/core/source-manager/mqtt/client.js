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
 *   setup), never emitted. Includes a `brokerUrl` whose host is
 *   `localhost` (ADR-030): the name can resolve to two addresses and
 *   the broker may listen on only one. The message names the literal
 *   to set. Refused before the client is created, at the schema (flow
 *   definition) and here (direct callers).
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
 * - `CALLBACK_FAILED`        — runtime, yellow. A piece of user code
 *   failed. It covers two cases. Case one: the user's `transform`
 *   threw, or returned a scalar or array where a record object was
 *   needed. That one message is skipped (counted in `skipped`) and
 *   the stream continues. Fix the transform function — the report
 *   names the topic and the fault. A null/undefined return is NOT
 *   this case: it is the documented intentional drop. Uniform with
 *   the CSV source (transform contract, 2026-07-11). Case two: the
 *   user's `onStatus` or `onMetrics` itself threw or rejected. The
 *   shared callback guard contains that fault (ADR-018, wired in
 *   status.js). The stream continues, and each fault is reported
 *   once with the detail.
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
 * Console classification (a token on a log line, not an `err.code`):
 * - `ADDRESS_IS_NAME`        — the `brokerUrl` host is a name other
 *   than `localhost`. One `logger.warn` line at setup, before the
 *   client is created (ADR-030). A name is allowed and the source
 *   proceeds; the line tells the operator that only a literal address
 *   is immune to a resolver that changes its answer under a running
 *   process. This source refuses and warns; it does not probe, because
 *   its posture is recovering (ADR-018 §5).
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
 *   5. No payload size cap and no intake rate cap. A flood of large
 *      messages is bounded only by the broker's own per-client limits
 *      and by TCP back-pressure on the socket. ADR-026 (proposed) is
 *      the home for a cap; the handbook states the limit.
 *
 * Performance, measured on the private benchmark harness (2026-04-24,
 * M4 Max; pre-ADR-022 dedup, whose replacement has the same O(1)
 * per-message profile): composer's own decode/dedup/dispatch path
 * sustains 897 k msg/s at 100 B payloads (317 k at 1 KB). End-to-end
 * through Mosquitto at QoS 1 the single-process ceiling was
 * ~12.9 k msg/s, owned by mqtt.js and the broker round-trip, not this
 * code. At 10 k msg/s steady state every cell ran clean; a
 * 30 M-message run showed no subscriber-side leak.
 *
 * Decisions this file follows:
 * - ADR-004 and ADR-013 — the message handler is synchronous and
 *   allocates nothing on the success path. The flow's dispatch never
 *   waits on it.
 * - ADR-018 — the adapter contract: phases, status shape, codes.
 * - ADR-022 — the dedup cache and its two bounds.
 * - ADR-027 — the callback wrapper scope. `transform` runs under the
 *   shared guard. `onMessage` is not wrapped here; the flow's dispatch
 *   guard owns it.
 * - ADR-028 — the grammar of every facade line printed here and in
 *   status.js.
 * - ADR-030 — `localhost` is refused; a name is warned about.
 * - ADR-026 (proposed) — the external-threat surface. TLS,
 *   authentication, and payload caps belong there, not here.
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
import { wrapTransform, TRANSFORM_THREW } from '../../utils/callback-guard/index.js';
import { jitteredPeriod } from '../../utils/jitter/index.js';
import { logger } from '../../logger/index.js';
import { classifyAddress, localhostRefusalMessage, nameWarningMessage } from '../../utils/address/index.js';

// ============================================================================
// ADDRESS POLICY (ADR-030)
// ============================================================================

/**
 * Classifies the broker address and refuses `localhost`. The schema
 * already refused it at flow definition; this call covers direct
 * callers and carries the classified code. The source has no
 * environment fallback for `brokerUrl`, so no env var is named.
 *
 * @param {string} brokerUrl - The broker URL as configured
 * @returns {Object} The classified address
 * @throws {Error} INVALID_CONFIG when the host is `localhost`
 */
const assertBrokerNotLocalhost = function ( brokerUrl ) {
    const address = classifyAddress( brokerUrl, 'url' );
    if ( address.kind === 'localhost' ) {
        const err = new Error(
            `winkComposer/mqttSource: ${localhostRefusalMessage( { field: 'brokerUrl', address } )}`
        );
        err.code = 'INVALID_CONFIG';
        throw err;
    }
    return address;
}; // assertBrokerNotLocalhost()

/**
 * Prints the one ADDRESS_IS_NAME line when the broker host is a name.
 *
 * @param {Object} address - The classified broker address
 */
const warnIfBrokerIsName = function ( address ) {
    if ( address.kind === 'name' ) {
        logger.warn(
            `winkComposer/mqttSource: ${nameWarningMessage( { field: 'brokerUrl', host: address.host } )}`
        );
    }
}; // warnIfBrokerIsName()

// ============================================================================
// CLIENT FACTORY
// ============================================================================

/**
 * Create MQTT source client with deduplication and structured
 * health/metrics reporting.
 *
 * @param {Object} config - Client configuration
 * @param {string} config.brokerUrl - MQTT broker URL (e.g., 'mqtt://127.0.0.1:1883'; never localhost)
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
        const err = new Error( 'winkComposer/mqttSource: brokerUrl is required' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }
    // Address policy (ADR-030): `localhost` is refused before the
    // client is created; a name is warned about just before connect.
    const brokerAddress = assertBrokerNotLocalhost( brokerUrl );
    if ( !topics || ( Array.isArray( topics ) && topics.length === 0 ) ) {
        const err = new Error( 'winkComposer/mqttSource: topics is required' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }
    if ( typeof onMessage !== 'function' ) {
        const err = new Error( 'winkComposer/mqttSource: onMessage must be a function' );
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

    // The user's transform runs under the shared callback guard, armed
    // once here — never per message. A throw inside it becomes the
    // sentinel plus one per-record CALLBACK_FAILED report through the
    // reporter; the message handler turns the sentinel into a skip.
    // The topic travels as the guard's per-call context, so the
    // success path allocates nothing (ADR-018).
    const reportTransformFault = function ( detail, topic ) {
        reporter.transformFailed( `topic '${topic}': transform threw: ${detail} — message skipped` );
    };
    const guardedTransform = transform ? wrapTransform( transform, reportTransformFault ) : null;

    // The auto-generated name carries the start time and a random
    // part, the emitter's shape. Two sources that start in the same
    // millisecond still get different names. That matters because the
    // broker allows one live connection per name. When a second client
    // arrives under a name in use, the broker disconnects the first.
    // Two clients then take the session from each other on every
    // reconnect.
    const generatedClientId = clientId || `wink-source-${Date.now()}-${Math.random().toString( 36 ).slice( 2, 9 )}`;

    // A persistent session is filed at the broker under the client's
    // name. The auto-generated name changes on every start, so the
    // backlog saved under the previous run's name is never delivered.
    // Warn once at startup. The fix is one config line, on the setup
    // path only.
    if ( !clientId && cleanStart !== true ) {
        logger.warn(
            'winkComposer/mqttSource: no clientId configured — this session ' +
            `is persistent under the auto-generated name '${generatedClientId}'. ` +
            'After a restart, composer connects under a NEW name, so messages ' +
            'the broker saved during the downtime are never delivered. Set a ' +
            'fixed clientId (unique on your broker) in the source config.'
        );
    }

    // Build MQTT options, allowing cleanStart override. The reconnect
    // period is the configured one plus a random share of up to 20%,
    // drawn once here. So a fleet that lost one broker does not retry
    // in step. The configured period is the floor.
    const mqttOptions = {
        ...MQTT_SOURCE_CONFIG,
        clientId: generatedClientId,
        reconnectPeriod: jitteredPeriod( MQTT_SOURCE_CONFIG.reconnectPeriod )
    };

    // Map the user-facing `cleanStart` key (MQTT 5 term) onto the
    // option name mqtt.js reads (`clean`). See constants.js for the
    // 2026-07-09 defect this spelling closed.
    if ( cleanStart !== undefined ) {
        mqttOptions.clean = cleanStart;
    }

    // Create MQTT client. The name warning goes first, so it prints
    // before any socket opens (ADR-030).
    warnIfBrokerIsName( brokerAddress );
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
        // A repeated MQTT 5 user property parses to an array, and an
        // array can never equal an earlier one. So any non-string id
        // bypasses too, counted in dedupBypassed rather than cached.
        if ( typeof dedupId !== 'string' ) {
            reporter.bypassed();
        } else if ( dedup.isDuplicate( dedupId ) ) {
            reporter.dupSkipped();
            return;
        } else {
            reporter.idAccepted();
        }

        // Decode the payload, check its shape, and attach metadata in
        // one guarded region. A failure anywhere in it is skipped,
        // classified, and reported per record (ADR-018). The stream
        // continues.
        //
        // The shape guard is needed because a valid JSON document can
        // be a scalar or a bare array. The attach is inside the guard
        // because a codec can return a frozen record, or one with a
        // non-writable _topic. The assignment then throws in strict
        // mode. decodeOk() runs only when the whole record survived,
        // so the ring gets exactly one entry per message.
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
            // The parser's own message can echo a fragment of the
            // payload. Payload text is data, so it stays below the
            // warn level (ADR-028). The report names the topic and
            // the size. The parser's reason goes to a debug line,
            // guarded so the hot path builds nothing when debug is off.
            reporter.decodeFailed( `topic '${topic}': payload of ${payload.length} bytes could not be decoded — message skipped` );
            if ( logger.debugOn ) {
                logger.debug( `winkComposer/mqttSource: decode failed [DECODE_ERROR]: topic '${topic}': ${err.message}` );
            }
            return;
        }

        // Apply the optional transform, pre-armed by the shared guard
        // at startup. A throw skips this one message with a per-record
        // CALLBACK_FAILED report, and the stream continues. User code
        // must never propagate into mqtt.js's event processing
        // (transform contract, 2026-07-11).
        //
        // The return is held to the same record shape as the payload.
        // A null or undefined return stays the intentional silent
        // drop. A scalar or array return is one per-record
        // CALLBACK_FAILED. The shape check runs only when a transform
        // is configured. The plain path pays nothing.
        let finalMessage;
        if ( guardedTransform ) {
            finalMessage = guardedTransform( message, topic );
            // The sentinel check runs FIRST: the sentinel is a plain
            // object, so a later isUsableRecord check would wave it
            // through into onMessage as a message.
            if ( finalMessage === TRANSFORM_THREW ) {
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

    // The stop outcome is latched on the first call. A second caller
    // receives the same promise, so it can never report a clean stop
    // while the first call is still closing.
    let stopPromise = null;

    /**
     * Stop the MQTT client, with a time budget.
     *
     * Per ADR-018, source stop functions take a `{ timeout }`. How the
     * close detaches follows the library's own rules (mqtt.js 5.15.1):
     *
     * - Not connected (the first connect still pending, the link down,
     *   or the library waiting to retry): `end( true )` at once. The
     *   library destroys the stream, clears its connect and reconnect
     *   timers, and calls back on the next tick. A graceful
     *   `end( false )` would call back at once here too, but it would
     *   not destroy the stream (`client.js:921-924`). A pending
     *   connect would then hold the process for the whole connect
     *   timeout.
     * - Connected: `end( false )` sends DISCONNECT and half-closes the
     *   socket, then waits for the broker to close its side. A timer
     *   bounds that wait. At the budget the timer destroys the stream
     *   directly. That is the call the library's own connect timeout
     *   makes. A second `end()` would do nothing: it returns at once
     *   behind the library's `disconnecting` flag (`client.js:731-734`).
     *   The forced path is reported with the sources' shared `note`
     *   convention.
     *
     * The timer is `unref()`ed so it does not keep Node alive while a
     * clean disconnect is in progress. Either path settles the promise
     * once. The default time budget (5000 ms) matches the sinks.
     *
     * @param {Object} [options] - Stop options
     * @param {number} [options.timeout=5000] - Max ms to wait for the clean disconnect
     * @returns {Promise<void>} Resolves once the client is closed (clean or forced)
     */
    const stop = function ( { timeout = 5000 } = {} ) {
        if ( stopPromise ) {
            return stopPromise;
        }
        clearInterval( cadence );
        stopPromise = new Promise( function ( resolve ) {
            let settled = false;
            const reportClean = function () {
                reporter.stopped();
            };
            const reportForced = function () {
                reporter.stopForced( timeout );
            };
            // The library's close callback also fires after the timer's
            // destroy, so the second arrival must settle nothing.
            const settle = function ( report ) {
                if ( settled ) {
                    return;
                }
                settled = true;
                report();
                resolve();
            };

            if ( !client.connected ) {
                client.end( true, {}, function () {
                    settle( reportClean );
                } );
                return;
            }

            const forceTimer = setTimeout( function () {
                client.stream.destroy();
                settle( reportForced );
            }, timeout );
            forceTimer.unref();

            client.end( false, {}, function () {
                clearTimeout( forceTimer );
                settle( reportClean );
            } );
        } );
        return stopPromise;
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

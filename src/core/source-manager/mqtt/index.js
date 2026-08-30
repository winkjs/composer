// core/source-manager/mqtt/index.js

/**
 * @fileoverview MQTT source adapter for winkComposer.
 *
 * Subscribes to edge composer MQTT outputs with deduplication for QoS 1.
 * Extracts winkDedupId from MQTT v5 user properties to filter retransmissions.
 *
 * Adapter contract (ADR-018):
 * - Module-level exports: `id`, `configSchema`, `start`,
 *   `durabilityClass`, and the default aggregate referencing the same
 *   constants.
 * - `start( config )` returns a `stopFn({ timeout })`.
 * - Lifecycle and error contract details: see `client.js` file header.
 *
 * Durability (ADR-018): `'broker-queue'` — the source connects with a
 * persistent broker session (`cleanStart: false`), so while it is
 * disconnected the broker holds every QoS-1 message published to its
 * subscribed topics and replays them on reconnect. What the source has
 * not yet acknowledged is not lost; the broker owns the queue.
 *
 * `configSchema` declares the user-supplied config fields. The flow
 * runtime calls `validateWithSchema( mqtt.configSchema, sourceConfig )`
 * at DSL time (in `flow.source()`), so typos and bad types are caught
 * before the flow ever runs. Per ADR-018 the schema is authoritative
 * for the fields it covers; `client.js` does not re-enforce them. The
 * schema carries `_propertyNames`, so an unknown key (e.g. the typo
 * `brokerURL`) is rejected at definition time.
 *
 * Runtime-injected callbacks (`onMessage`, `onShutdown`) are not part
 * of `configSchema` — the wiring layer adds them to the config at start
 * time, after DSL validation. A user-supplied `onMessage` would be
 * silently overwritten; the unknown-key rejection turns that mistake
 * into a fail-fast error instead.
 *
 *   ASSUMPTIONS
 *   -----------
 *   1. Inside a flow, the runtime injects `onMessage` / `onShutdown`
 *      and wraps `onStatus`; a direct caller of `start()` supplies
 *      `onMessage` itself and owns calling the returned stop function.
 *   2. Config passed through the DSL was validated by this schema;
 *      `client.js` re-checks only the three fields a direct caller
 *      could omit (brokerUrl, topics, onMessage).
 *
 *   LIMITATIONS
 *   -----------
 *   1. This is an infinite source: it never emits `phase: 'complete'`,
 *      so a flow's `whenComplete()` resolves only via `shutdown()`.
 *   2. Duplicate filtering is opt-in per message: only messages that
 *      carry `winkDedupId` are protected. Watch the `dedupBypassed`
 *      counter to spot publishers that are not stamping ids.
 *
 * Usage in flow:
 *   import mqtt from './core/source-manager/mqtt/index.js';
 *
 *   flow( 'aggregator' )
 *       .source( mqtt, {
 *           brokerUrl: 'mqtt://broker:1883',
 *           topics: [ 'edge/+/enriched' ],
 *           codec: msgpackCodec,
 *           dedupWindowMs: 120000
 *       } )
 *
 * @see src/core/emitter-manager/mqtt/index.js - Emitter counterpart
 */

import { validators } from '../../utils/validate/index.js';
import { createMQTTSourceClient } from './client.js';

// ============================================================================
// SOURCE ADAPTER
// ============================================================================

/**
 * Source adapter identifier.
 * Used by the flow runtime to reference this adapter.
 *
 * @type {string}
 */
const id = 'mqtt';

/**
 * Crash-survival class per ADR-018. For a source the value describes
 * the INPUT it can recover after a disconnect: the persistent broker
 * session holds subscribed QoS-1 messages across the gap and replays
 * them on reconnect.
 *
 * @type {string}
 */
const durabilityClass = 'broker-queue';

/**
 * Validates that a value is a non-empty topic string or a non-empty
 * array of non-empty topic strings.
 *
 * @param {*} value
 * @returns {boolean}
 */
const isTopicOrTopicArray = function ( value ) {
    if ( typeof value === 'string' && value.length > 0 ) return true;
    if ( Array.isArray( value ) && value.length > 0 ) {
        return value.every( ( t ) => typeof t === 'string' && t.length > 0 );
    }
    return false;
};

/**
 * Schema for the MQTT source's user-supplied config. Consumed by the
 * flow runtime (`flow.source()` → `validateWithSchema`) at DSL time.
 *
 * Required:
 * - `brokerUrl` — MQTT broker URL (e.g., 'mqtt://broker.local:1883').
 * - `topics` — topic string or non-empty array of topic strings
 *   (wildcards supported).
 *
 * Optional:
 * - `codec` — payload decoder with an `unpack( buffer )` function.
 *   Default: JSON.parse of the payload.
 * - `transform` — function( msg ) → msg, applied before `onMessage`;
 *   returning null/undefined drops the message (counted in `skipped`).
 *   A throw skips that one message with a per-record CALLBACK_FAILED
 *   report and the stream continues. Uniform with the CSV source.
 * - `dedupWindowMs` — dedup time bound: a duplicate arriving within
 *   this many milliseconds of its original is dropped. Default 120000
 *   (ADR-022).
 * - `dedupMaxEntries` — dedup count cap: the memory guarantee (~8 MB
 *   worst case at the default 65536). At high rates the effective
 *   window is maxEntries ÷ rate — see ADR-022.
 * - `clientId` — MQTT client ID. Auto-generated when omitted.
 * - `cleanStart` — override the persistent-session default (false).
 * - `onStatus` — status callback. Receives the structured ADR-018
 *   status payload on every transition and per decode failure — the full
 *   vocabulary is documented in `client.js`.
 * - `onMetrics` — counter-snapshot callback, ~1 Hz plus on every
 *   health transition (delivered, skipped, decodeErrors, reconnects,
 *   dedupHits, dedupMisses, dedupBypassed, dedupCacheSize).
 * - `expectedQuietPeriodMs` — opt-in quiet rule: health goes yellow
 *   when no packet arrives for longer than this many milliseconds.
 *   Off when omitted (silence is normal for many sources).
 * - `mqttConnectFn` — MQTT connect function injection point (tests,
 *   benchmarks).
 *
 * `_propertyNames` lists every accepted key — unknown keys throw at
 * DSL time (the validator's only unknown-key mechanism).
 *
 * @type {Object}
 */
const configSchema = {
    _propertyNames: [
        'brokerUrl',
        'topics',
        'codec',
        'transform',
        'dedupWindowMs',
        'dedupMaxEntries',
        'clientId',
        'cleanStart',
        'onStatus',
        'onMetrics',
        'expectedQuietPeriodMs',
        'mqttConnectFn'
    ],
    brokerUrl: {
        type: 'string',
        required: true,
        validator: validators.nonEmptyString,
        error: 'brokerUrl must be a non-empty string (e.g., mqtt://broker.local:1883)'
    },
    topics: {
        required: true,
        validator: isTopicOrTopicArray,
        error: 'topics must be a non-empty string or a non-empty array of non-empty strings'
    },
    codec: {
        type: 'object',
        required: false,
        validator: ( v ) => v !== null && typeof v.unpack === 'function',
        error: 'codec must be an object with an unpack() function'
    },
    transform: {
        type: 'function',
        required: false,
        error: 'transform must be a function( msg ) returning a msg (or null/undefined to drop)'
    },
    dedupWindowMs: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'dedupWindowMs must be a positive integer (milliseconds; default 120000)'
    },
    dedupMaxEntries: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'dedupMaxEntries must be a positive integer (default 65536)'
    },
    clientId: {
        type: 'string',
        required: false,
        validator: validators.noSpaces,
        error: 'clientId must be a string without spaces'
    },
    cleanStart: {
        type: 'boolean',
        required: false,
        error: 'cleanStart must be a boolean'
    },
    onStatus: {
        type: 'function',
        required: false,
        error: 'onStatus must be a function'
    },
    onMetrics: {
        type: 'function',
        required: false,
        error: 'onMetrics must be a function'
    },
    expectedQuietPeriodMs: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'expectedQuietPeriodMs must be a positive integer (milliseconds)'
    },
    mqttConnectFn: {
        type: 'function',
        required: false,
        error: 'mqttConnectFn must be a function (test/benchmark injection point)'
    }
};

/**
 * Start the MQTT source.
 *
 * Called by the flow runtime (flow/run.js) with config from flow DSL.
 * Returns a stop function for graceful shutdown.
 *
 * @param {Object} config - Source configuration
 * @param {string} config.brokerUrl - MQTT broker URL
 * @param {string|string[]} config.topics - Topic(s) to subscribe to
 * @param {function} config.onMessage - Message handler (injected by the flow runtime)
 * @param {Object} [config.codec] - Codec for payload decoding
 * @param {function} [config.transform] - Optional message transform
 * @param {number} [config.dedupWindowMs=120000] - Dedup time bound (ADR-022)
 * @param {number} [config.dedupMaxEntries=65536] - Dedup count cap (ADR-022)
 * @param {string} [config.clientId] - MQTT client ID
 * @param {function} [config.onStatus] - Structured status callback (ADR-018)
 * @param {function} [config.onMetrics] - Counter-snapshot callback (~1 Hz + transitions)
 * @param {number} [config.expectedQuietPeriodMs] - Opt-in quiet rule threshold
 * @returns {function} Stop function that returns a Promise
 */
const start = function ( config ) {
    return createMQTTSourceClient( config );
};

// ============================================================================
// EXPORTS
// ============================================================================

export { id, configSchema, durabilityClass, start };
export default { id, configSchema, durabilityClass, start };

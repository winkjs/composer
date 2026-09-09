// core/emitter-manager/mqtt/index.js

/**
 * @fileoverview MQTT Emitter - Production Ready for Edge Deployment
 *
 * ARCHITECTURE OVERVIEW:
 *
 * Fire-and-forget publishing with QoS 1. Messages buffer in the mqtt.js
 * client's synchronous in-memory store and ride out broker outages
 * while the process lives; delivery is confirmed per message by the
 * broker's acknowledgment.
 *
 * STARTUP POSTURE: recovering (ADR-018). Setup never fails because the
 * broker is unreachable. The factory waits up to `connectGraceMs`
 * (default 500 ms, env `MQTT_CONNECT_GRACE_MS`, 0 disables) for the
 * broker's first connection acknowledgment, then hands back the handle
 * either way — an unreachable broker just means the flow starts with
 * `connected: false` while the client retries in the background.
 *
 * KEY FEATURES:
 * - Non-blocking operation (never waits for PUBACK)
 * - Composer-side unacked accounting: pressure, backpressure refusal,
 *   shutdown drain, and health all read one counter (ADR-021)
 * - Message expiry to prevent stale data floods
 * - Optional will for proper LWT handling
 *
 * DURABILITY (ADR-018): `'in-memory'` — a process crash or power cut
 * loses at most the unacknowledged in-flight window (at edge rates: one
 * burst, typically 0–2 messages) plus anything buffered during a
 * concurrent broker outage. The disk-backed store was removed because
 * mqtt.js loses QoS-1 messages on every connection acceptance when its
 * outgoing store is asynchronous — ADR-021 records the diagnosis, the
 * measured loss-vs-latency curve, and the planned composer-owned WAL
 * that restores crash durability truthfully. Module exports follow
 * ADR-018's module surface:
 * `id`, `configSchema`, `createEmitter`, `durabilityClass`, and the
 * default aggregate referencing the same constants.
 *
 * Shed policy and outage budget. Once the unacknowledged count reaches
 * 90% of `maxQueueSize`, `publishNow` refuses new messages with
 * `STORAGE_FULL`, and the messages already accepted stay safe. With
 * the default cap of 10,000, refusal starts at 9,000 messages. That
 * is 15 minutes of outage at 10 messages a second, and 2.5 hours at
 * one a second. Memory is the count times the payload size: about
 * 10 MB at 1 KB a message.
 *
 * Ordering. While connected, messages reach the broker in publish
 * order over the one connection. After a reconnect the client replays
 * its in-memory store in insertion order, and new publishes wait in
 * the client's processing queue until that replay ends (mqtt.js
 * 5.15.1, `client.js:1230-1262`). Delivery is at-least-once, so a
 * consumer can see a message twice. Every message carries a
 * `winkDedupId`, and the MQTT source drops the repeats (ADR-022).
 *
 * Edge-baseline defaults (every one runs within a 2 GB device):
 *
 *   | Setting          | Default  | Environment variable      |
 *   |------------------|----------|---------------------------|
 *   | `maxQueueSize`   | 10000    | `MQTT_MAX_QUEUE_SIZE`     |
 *   | `connectGraceMs` | 500      | `MQTT_CONNECT_GRACE_MS`   |
 *   | message expiry   | 3600 s   | `MQTT_MSG_EXPIRY`         |
 *   | keepalive        | 60 s     | `MQTT_KEEPALIVE`          |
 *   | reconnect period | 5000 ms  | `MQTT_RECONNECT_MS`       |
 *   | connect timeout  | 30000 ms | `MQTT_CONNECT_TIMEOUT_MS` |
 *
 *   `brokerUrl` falls back to `MQTT_BROKER_URL`. The reconnect period
 *   gains a random share of up to 20% per client (`utils/jitter`).
 *   The cap is clamped to 60,000, the packet-id ceiling.
 *
 * Related decisions beyond ADR-018 and ADR-021. ADR-022: this adapter
 * writes the `winkDedupId` the source dedups on. ADR-023: `publishNow`
 * reads the message during the call and keeps no reference. ADR-027:
 * the three callbacks run through the shared guard. ADR-028: every
 * line and error follows the message grammar. ADR-026 (Proposed) is
 * the planned TLS surface for `mqtts://`.
 *
 * Directory structure:
 * core/emitter-manager/mqtt/
 * ├── index.js                 # Module surface: id, schema, factory
 * ├── emitter.js               # The factory: resolve, open, assemble
 * ├── resolve-config.js        # Validation in one fixed order; the
 * │                            #   three callbacks armed by the guard
 * ├── connection.js            # Client open, first-connack wait, the
 * │                            #   connection event handlers
 * ├── health.js                # getPressure, getHealth, backpressure
 * ├── publish.js               # publishNow, the hot path
 * ├── shutdown-drain.js        # The latched drain-then-close shutdown
 * ├── mqtt-store.js            # DORMANT LevelDB store (ADR-021; kept
 * │                            #   for the WAL successor, not wired,
 * │                            #   not shipped in the npm package)
 * ├── constants.js             # Shared configuration
 * └── test/                    # Spec files
 *
 * @example
 * // The factory is async, as QuestDB's is. A configuration error
 * // rejects the promise with a classified `INVALID_CONFIG` error.
 * const emitter = await createEmitter({
 *     brokerUrl: 'mqtt://broker.local:1883',
 *     codec: jsonCodec
 * });
 *
 * // Fire and forget - returns immediately
 * emitter.publishNow('sensors/temp', { value: 23.5 });
 *
 * @module mqtt-emitter
 */

import { validators } from '../../utils/validate/index.js';
import { classifyAddress } from '../../utils/address/index.js';
import { createEmitter } from './emitter.js';

/**
 * Schema validator for `brokerUrl`: non-empty and never `localhost`
 * (ADR-030). A value the URL grammar cannot read passes; the MQTT
 * library reports its own error for it.
 *
 * @param {*} value - The configured value
 * @returns {boolean} Whether the value is allowed
 */
const isAllowedBrokerUrl = function ( value ) {
    if ( !validators.nonEmptyString( value ) ) {
        return false;
    }
    return classifyAddress( value, 'url' ).kind !== 'localhost';
}; // isAllowedBrokerUrl()

/**
 * Emitter identifier - must match target in emitIf specs.
 * @type {string}
 */
export const id = 'mqtt';

/**
 * Crash-survival class per ADR-018. Nothing survives a crash of
 * this process: accepted messages live in the client's in-memory
 * buffer until the broker acknowledges them (ADR-021 states the trade
 * and the measured window). Broker-side QoS-1 retention holds only
 * what already reached the broker.
 * @type {string}
 */
export const durabilityClass = 'in-memory';

/**
 * Configuration schema for MQTT emitter validation.
 * Used by flow.emitter() to validate config at DSL time.
 *
 * `_propertyNames` lists every accepted key — unknown keys throw at
 * DSL time (the validator's only unknown-key mechanism).
 * This turns a typo (`brokerURL`) or a key retired by ADR-021
 * (`storePath`, `maxQueueBytes`) into a fail-fast error instead of a
 * silently ignored setting.
 *
 * @type {Object}
 */
export const configSchema = {
    _propertyNames: [
        'brokerUrl',
        'codec',
        'clientId',
        'connectGraceMs',
        'debug',
        'maxQueueSize',
        'will',
        'onCritical',
        'onBackpressure',
        'onDeliveryFailure',
        'mqttConnectFn'
    ],
    brokerUrl: {
        type: 'string',
        required: false,
        validator: isAllowedBrokerUrl,
        error: 'brokerUrl must be a non-empty broker URL with a literal address or a name, never ' +
            'localhost; e.g., mqtt://127.0.0.1:1883'
    },
    codec: {
        type: 'object',
        required: true,
        validator: ( v ) => v !== null && typeof v.pack === 'function',
        error: 'codec must be an object with a pack() function'
    },
    clientId: {
        type: 'string',
        required: false,
        validator: validators.noSpaces,
        error: 'clientId must be a string without spaces'
    },
    connectGraceMs: {
        type: 'number',
        required: false,
        validator: ( v ) => Number.isInteger( v ) && v >= 0,
        error: 'connectGraceMs must be a non-negative integer (milliseconds); 0 disables the startup wait'
    },
    debug: {
        type: 'boolean',
        required: false
    },
    maxQueueSize: {
        type: 'number',
        required: false,
        validator: validators.positiveInteger,
        error: 'maxQueueSize must be a positive integer'
    },
    will: {
        type: 'object',
        required: false,
        properties: {
            topic: {
                type: 'string',
                required: true,
                minLength: 1,
                error: 'will.topic is required'
            },
            message: {
                type: 'object',
                required: true,
                error: 'will.message is required'
            },
            qos: {
                type: 'number',
                required: false,
                validator: validators.oneOf( [ 0, 1, 2 ] ),
                error: 'will.qos must be 0, 1, or 2'
            },
            retain: {
                type: 'boolean',
                required: false
            }
        }
    },
    onCritical: {
        type: 'function',
        required: false,
        error: 'onCritical must be a function'
    },
    onBackpressure: {
        type: 'function',
        required: false,
        error: 'onBackpressure must be a function'
    },
    onDeliveryFailure: {
        type: 'function',
        required: false,
        error: 'onDeliveryFailure must be a function'
    },
    mqttConnectFn: {
        type: 'function',
        required: false,
        error: 'mqttConnectFn must be a function (test/benchmark injection point)'
    }
};

export { createEmitter };

export default { id, configSchema, durabilityClass, createEmitter };

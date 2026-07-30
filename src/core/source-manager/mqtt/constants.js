// core/source-manager/mqtt/constants.js

/**
 * @fileoverview Constants for MQTT source adapter.
 *
 * Protocol invariants (QoS, WINK_NAMESPACE, protocol version) are imported
 * from the shared mqtt-protocol module. Deployment-configurable values
 * (keepalive, reconnect, etc.) come from ENV_VARS.
 *
 *   ASSUMPTIONS
 *   -----------
 *   1. Environment variables were validated at import time by
 *      env-vars.js — every value here is already a sane number.
 *   2. These are deployment knobs, not per-flow settings: two sources
 *      in one process share them (per-flow overrides go through the
 *      source config, e.g. dedupWindowMs).
 *
 *   LIMITATIONS
 *   -----------
 *   1. The persistent-session guarantee (`clean: false`) is only as
 *      real as the broker's persistence setting — the default
 *      Mosquitto image accepts the session and keeps nothing. See the
 *      MQTT_SOURCE_CONFIG note below.
 *
 * @see src/core/mqtt-protocol.js - Shared protocol invariants
 * @see src/core/env-vars.js - Deployment configuration
 * @see src/core/emitter-manager/mqtt/constants.js - Emitter counterpart
 */

import { ENV_VARS } from '../../env-vars.js';
import {
    WINK_NAMESPACE,
    MQTT_QOS as QOS,
    MQTT_PROTOCOL_V
} from '../../mqtt-protocol.js';

// Re-export protocol invariants for local consumers
export { WINK_NAMESPACE, QOS };

// ============================================================================
// DEDUPLICATION DEFAULTS (ADR-022)
// ============================================================================

/**
 * Default dedup time bound: an entry expires this many milliseconds
 * after arrival. Two minutes covers typical broker retry windows —
 * a duplicate arrives roughly one reconnect gap after its original.
 * Override via MQTT_SOURCE_DEDUP_WINDOW_MS.
 *
 * @type {number}
 */
export const DEFAULT_DEDUP_WINDOW_MS = ENV_VARS.mqttSourceDedupWindowMs;

/**
 * Default dedup count cap: the memory guarantee (~8 MB worst case at
 * 65,536 retained UUIDs). When the cap binds before the time window,
 * the effective window is maxEntries ÷ message rate — the arithmetic
 * is documented in ADR-022. Override via MQTT_SOURCE_DEDUP_MAX_ENTRIES.
 *
 * @type {number}
 */
export const DEFAULT_DEDUP_MAX_ENTRIES = ENV_VARS.mqttSourceDedupMaxEntries;

// ============================================================================
// HEALTH & METRICS
// ============================================================================

/**
 * How long the source may sit disconnected before its health status
 * escalates from yellow to red. The transport library keeps retrying
 * either way (the ADR-018 recovering posture) — red is the operator signal
 * that the outage has outlived a routine blip. Strictly greater-than:
 * exactly 30,000 ms is still yellow.
 *
 * @type {number}
 */
export const DISCONNECT_RED_MS = 30000;

/**
 * How many recent decode outcomes the health check remembers. The
 * yellow rule reads "more than 1 % decode errors over the last 1,000
 * messages"; the ring is pre-allocated once (1 KB) so the hot path
 * allocates nothing.
 *
 * @type {number}
 */
export const DECODE_RING_SIZE = 1000;

/**
 * Cadence of the health/metrics timer: once per second the client
 * re-evaluates the time-based health rules and, when the caller
 * supplied `onMetrics`, emits a counter snapshot. One unref'd
 * interval per source instance — the only timer this adapter owns.
 *
 * @type {number}
 */
export const METRICS_INTERVAL_MS = 1000;

// ============================================================================
// MQTT CLIENT CONFIGURATION
// ============================================================================

/**
 * Default MQTT client configuration for source adapter.
 * Uses MQTT v5 with session persistence for reliable message delivery.
 *
 * SESSION PERSISTENCE (cleanStart: false)
 * ----------------------------------------
 * When cleanStart is false, the broker maintains the client's session state
 * (subscriptions and queued messages) across disconnections. This means:
 *
 *   - Messages published while disconnected are queued by the broker
 *   - On reconnect, queued messages are delivered automatically
 *   - No telemetry data is lost during brief network interruptions
 *
 * This is the right default for production IoT/telemetry systems where
 * data loss is unacceptable.
 *
 * BROKER REQUIREMENT
 * ------------------
 * Session persistence requires the MQTT broker to be configured with
 * persistence enabled. The default Eclipse Mosquitto docker image does
 * NOT have persistence enabled - it will accept the connection but won't
 * actually persist sessions.
 *
 * For testing with default Mosquitto, pass `cleanStart: true` to the
 * source config to use fresh sessions (no persistence requirement).
 *
 * @type {Object}
 */
export const MQTT_SOURCE_CONFIG = {
    protocolVersion: MQTT_PROTOCOL_V,
    keepalive: ENV_VARS.mqttKeepalive,
    reconnectPeriod: ENV_VARS.mqttReconnectMs,
    connectTimeout: ENV_VARS.mqttConnectTimeoutMs,
    // mqtt.js's option name is `clean` — it maps to the MQTT 5 Clean
    // Start flag. The source's user-facing config key stays
    // `cleanStart` (the MQTT 5 term); client.js maps it onto this.
    // Before 2026-07-09 this was spelled `cleanStart`, which mqtt.js
    // silently ignored — every connection ran clean=true and no
    // session ever survived a reconnect. Caught by the ADR-022 dedup
    // soak's forced-reconnect test.
    clean: false,
    properties: {
        sessionExpiryInterval: ENV_VARS.mqttSessionExpiryS
    }
};

// core/emitter-manager/mqtt/constants.js

/**
 * @fileoverview Production Constants - Pure Transport Layer
 *
 * Protocol invariants (QoS, WINK_NAMESPACE, protocol version) are imported
 * from the shared mqtt-protocol module. Deployment-configurable values
 * (keepalive, reconnect, queue limits, etc.) come from ENV_VARS.
 *
 * DESIGN DECISIONS (invariants, not configurable):
 *
 * 1. FIXED QoS 1
 *    - Reliable without overhead of QoS 2
 *    - At-least-once delivery sufficient for telemetry
 *    - Duplicates handled by backend deduplication (UUID)
 *
 * 2. QUEUE_CRITICAL_THRESHOLD at 80%
 *    - Time to investigate before critical
 *
 * 3. STORE_CONFIG compression + 8MB cache
 *    - LevelDB defaults for the DORMANT store module (ADR-021; kept
 *      for the WAL successor, not wired)
 *
 * @see src/core/mqtt-protocol.js - Shared protocol invariants
 * @see src/core/env-vars.js - Deployment configuration
 * @module mqtt-constants
 */

import { ENV_VARS } from '../../env-vars.js';
import {
    WINK_NAMESPACE,
    MQTT_QOS as QOS,
    MQTT_PROTOCOL_V
} from '../../mqtt-protocol.js';

// Re-export protocol invariants for local consumers
export { WINK_NAMESPACE, QOS };

// Queue default from ENV_VARS
export const DEFAULT_MAX_QUEUE_SIZE = ENV_VARS.mqttMaxQueueSize;

// Byte-axis cap for the DORMANT LevelDB store (ADR-021). The
// MQTT_MAX_QUEUE_BYTES env var was retired with the disk store — the
// in-memory emitter bounds memory by message count alone. The literal
// stays so the dormant store module keeps a working default until the
// composer-owned WAL successor re-wires deployment configuration.
export const DEFAULT_MAX_QUEUE_BYTES = 52428800;   // 50 MB

// Operational constant — not configurable (design decision)
export const QUEUE_CRITICAL_THRESHOLD = 0.8;

// Hard ceiling on maxQueueSize — not configurable (design
// decision). MQTT packet ids are 16-bit, so at most 65,535 publishes
// can be unacknowledged at once; a queue sized beyond that promises
// capacity the protocol cannot deliver. The measured failure mode with
// the default id allocator: the id space wraps and a new packet
// OVERWRITES an unacked packet's store entry, destroying the only copy
// of an undelivered QoS-1 message (about 1 per 700,000 under sustained
// load in the soak gate). The emitter uses the client's
// UniqueMessageIdProvider, which never reissues an in-use id — so the
// unacked window must never hold more messages than the id space has
// ids. 60,000 leaves margin for ids stuck on never-acknowledged packets.
export const MQTT_INFLIGHT_ID_LIMIT = 60000;

// Message expiry intervals (seconds)
export const MESSAGE_EXPIRY = {
    telemetry: 3600,                   // 1 hour - sensor data loses value quickly
    status: 86400,                     // 24 hours - status needs longer persistence
    default: ENV_VARS.mqttMsgExpiry    // Default expiry from ENV_VARS
};

// MQTT v5 configuration
export const MQTT_CONFIG = {
    protocolVersion: MQTT_PROTOCOL_V,
    keepalive: ENV_VARS.mqttKeepalive,
    reconnectPeriod: ENV_VARS.mqttReconnectMs,
    connectTimeout: ENV_VARS.mqttConnectTimeoutMs,
    // A deliberately clean session, spelled with the key mqtt.js
    // actually reads (`clean`). The MQTT 5 spelling `cleanStart` is
    // silently ignored by mqtt.js — the source carried that exact
    // defect until 2026-07-09, caught by the ADR-022 dedup soak
    // (see the cleanStart→clean mapping in source-manager/mqtt/client.js).
    //
    // Why clean: the emitter is publish-only. It holds no
    // subscriptions a broker session could preserve, and its
    // unacknowledged messages live in the mqtt.js client's in-memory
    // store inside this process, tracked by composer's unacked
    // counter (ADR-021).
    // A broker session buys it nothing. Before this fix, the ignored
    // key plus a random per-start clientId parked a 7-day orphan
    // session at the broker on every restart (`sessionExpiryInterval`
    // was riding along here as the same dead weight — the source is
    // the only adapter that needs MQTT_SESSION_EXPIRY_S).
    clean: true
};

// Storage configuration — operational constant for the DORMANT LevelDB
// store (ADR-021; kept for the WAL successor, not wired)
export const STORE_CONFIG = {
    compression: true,
    cacheSize: 8 * 1024 * 1024        // 8MB LevelDB cache
};

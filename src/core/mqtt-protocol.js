// core/mqtt-protocol.js

/**
 * @fileoverview Shared MQTT protocol invariants for WinkComposer.
 *
 * These are design decisions, NOT deployment-configurable values.
 * Both source and emitter depend on identical values for interoperability:
 * - QoS 1 (at-least-once) is coupled to the dedup strategy
 * - Protocol v5 is required for user properties and message expiry
 * - WINK_NAMESPACE keys must match between publisher and subscriber
 *
 * Deployment-configurable MQTT settings (keepalive, reconnect, etc.)
 * live in ENV_VARS and are consumed by each manager's constants.js.
 */

// ============================================================================
// PROTOCOL INVARIANTS
// ============================================================================

/**
 * MQTT v5 user property keys for WinkComposer metadata.
 * Publisher (emitter) writes these; subscriber (source) reads them.
 *
 * @type {Object}
 */
export const WINK_NAMESPACE = {
    dedupId: 'winkDedupId',
    timestamp: 'winkTimestamp',
    version: 'winkVersion'
};

/**
 * QoS level — fixed at 1 (at-least-once delivery).
 * Duplicates handled by backend deduplication via winkDedupId UUID.
 * Must match between emitter and source for session resumption.
 *
 * @type {number}
 */
export const MQTT_QOS = 1;

/**
 * MQTT protocol version — fixed at 5.
 * Required for user properties (dedup metadata) and message expiry.
 *
 * @type {number}
 */
export const MQTT_PROTOCOL_V = 5;

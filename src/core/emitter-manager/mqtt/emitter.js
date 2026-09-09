// core/emitter-manager/mqtt/emitter.js

/**
 * @fileoverview Production MQTT Emitter — Pure Transport Layer
 *
 * Durability class: **'in-memory'** (ADR-021). Messages buffer in the
 * mqtt.js client's default synchronous memory store; a process crash or
 * power cut loses at most the unacknowledged in-flight window (measured:
 * a few hundred messages at 14k msg/s, at most one burst at edge rates)
 * plus anything buffered during a concurrent broker outage. The
 * disk-backed store was removed because mqtt.js loses QoS-1 messages on
 * EVERY connection acceptance when its outgoing store is asynchronous
 * (the erase-then-rebuild gap — ADR-021 has the full diagnosis
 * and the measured loss-vs-latency curve). The synchronous memory store
 * closes that gap by construction; the composer-owned WAL that restores
 * crash durability is ADR-021's planned successor.
 *
 * The adapter is one closure factory per concern, the shape QuestDB's
 * flush engine uses. This file is the factory. It resolves the
 * configuration, builds the state, opens the client, and assembles the
 * handle from the modules beside it:
 * - `resolve-config.js` validates every option in one fixed order and
 *   arms the three callbacks through the shared guard.
 * - `connection.js` opens the client, waits for the first connack, and
 *   keeps `state.connected` and the counters current.
 * - `health.js` reads pressure and health, and signals backpressure.
 * - `publish.js` is the hot path, `publishNow`.
 * - `shutdown-drain.js` is the latched drain-then-close shutdown.
 * Each module captures what it needs at setup. Nothing moves onto a
 * per-message argument list.
 *
 * DESIGN DECISIONS:
 *
 * 1. FIRE-AND-FORGET WITH QoS 1
 *    - Never wait for PUBACK callbacks on the hot path
 *    - QoS 1 gives at-least-once delivery while the process lives
 *    - Callbacks drive the unacked counter, not delivery decisions
 *
 * 2. COMPOSER-SIDE UNACKED ACCOUNTING (ADR-021)
 *    - One counter: +1 when a publish is accepted, -1 when its callback
 *      fires (acknowledgment or failure).
 *    - The counter IS the pressure gauge, the pre-flight refusal basis,
 *      the shutdown drain condition, and the health input. Because
 *      "unacknowledged" by definition covers every message sitting in
 *      any client-internal queue, no accumulation can be invisible to
 *      pressure — bounded memory is arithmetic (cap × message size),
 *      not an assumption about library behavior. (The old design read
 *      pressure from the LevelDB store while messages piled up unseen
 *      inside the client — the 2026-07-08 tier-run OOM.)
 *
 * 3. MESSAGE EXPIRY (MQTT v5)
 *    - Configurable per message type
 *    - Prevents flooding backend after extended offline periods
 *
 * 4. NO FORCED IDENTITY / OPTIONAL WILL — unchanged transport behavior.
 *
 * 5. STARTUP POSTURE: RECOVERING, WITH A BOUNDED FIRST-CONNACK GRACE
 *    - Setup never fails because the broker is unreachable. The factory
 *      waits up to `connectGraceMs` (config → MQTT_CONNECT_GRACE_MS env
 *      → 500 ms default; 0 disables) for the first connection
 *      acknowledgment, then hands back the handle either way. On a
 *      reachable broker the real wait is one connack round trip; on an
 *      unreachable one the flow starts with `connected: false` and the
 *      client keeps retrying in the background.
 *    - Return shape: always a Promise of the handle, as QuestDB's
 *      factory returns. At grace 0 the promise resolves without a
 *      wait. A configuration refusal arrives as a rejection carrying
 *      the classified code. The wiring layer awaits it (ADR-018).
 *    - This replaced the wire-time `sleep(240)` that once papered over
 *      the pre-connack loss ADR-021 eliminated.
 *
 * Adapter contract (ADR-018, stream sink):
 * - `publishNow(topic, message, options?)` returns `{ ok: true }` on
 *   acceptance or `{ ok: false, error: { code, message } }` on pre-flight
 *   rejection. Sync return per ADR-013; never a Promise on the hot path.
 * - Async publish failures route through `onDeliveryFailure(err, ctx)`
 *   when supplied (ctx = `{ topic }`); without a handler the adapter
 *   surfaces the failure via `Promise.reject(deliveryErr)` — loud failure
 *   beats silent loss (parity with QuestDB). `onCritical` is
 *   reserved for the high-pressure `QUEUE_CRITICAL` warning (no loss yet).
 * - `getPressure()` returns unacked / maxQueueSize in `[0, 1]` (sync,
 *   O(1), allocation-free per ADR-018).
 * - `getHealth()` returns the ADR-018 health floor `{status, connected,
 *   pressure}` plus this adapter's own `stats` addition; `stats.unacked`
 *   is the live counter.
 *
 * Health-status semantics (uniform across sinks):
 * - `red`    if `!state.connected`.
 * - `yellow` if connected AND `pressure >= 0.66` (threshold shared with
 *   ADR-020's Draft yield proposal).
 * - `green`  otherwise.
 *
 * Backpressure threshold:
 * - Pre-flight reject fires at `pressure >= STORAGE_PRESSURE_LIMIT` (0.9),
 *   leaving 10% headroom for in-flight drain on shutdown and a clean band
 *   between the yellow-health threshold (0.66) and exhaustion (1.0).
 * - The cap is `maxQueueSize`, clamped to 60,000: every unacknowledged
 *   QoS-1 message holds a 16-bit packet id, so one connection can never
 *   carry more (see MQTT_INFLIGHT_ID_LIMIT).
 * - The old byte-axis limit (`maxQueueBytes`) died with the disk store;
 *   the count cap bounds memory at cap × payload size.
 *
 * `err.code` vocabulary (user-facing; documented in this header as
 * ADR-018 requires):
 * - `STORAGE_FULL`     — the unacked cap is reached; pre-flight sync
 *   reject. The name is the cross-sink vocabulary word (ADR-018), kept
 *   although the "storage" is now the in-memory buffer.
 * - `ENCODE_ERROR`     — the codec could not encode the message; sync
 *   pre-flight reject, the message was never in flight. The sink-side
 *   mirror of the source vocabulary's `DECODE_ERROR`.
 * - `DELIVERY_FAILED`  — publish failure. Usually async, routed through
 *   `onDeliveryFailure` (default without a handler: `Promise.reject`,
 *   an unhandledRejection). Rare sync face: `client.publish` rejecting
 *   the call itself returns this code synchronously — the slot is
 *   released, nothing is in flight.
 * - `SHUTTING_DOWN`    — emitter is mid-shutdown; new publishes are dropped.
 * - `INVALID_CONFIG`   — setup-time; missing or malformed config field
 *   (brokerUrl, codec.pack, callback type, connectGraceMs). On the
 *   thrown TypeError per ADR-018's fail-fast setup rule. Includes a
 *   `brokerUrl` whose host is `localhost` (ADR-030): the name can
 *   resolve to two addresses and the broker may listen on only one.
 *   The message names the literal to set. Refused before the client
 *   is created, at the schema (flow definition) and here (the
 *   `MQTT_BROKER_URL` fallback and direct callers).
 * - `SHUTDOWN_TIMEOUT` — shutdown closed with unacknowledged messages;
 *   carries `dropped: { count }` (the exact counter value). Fires whether
 *   connected or not: with no disk store, nothing survives the process,
 *   so a disconnected shutdown with pending messages is a real loss and
 *   is reported as one (this differs from the wal-backed design, which
 *   held them for the next session).
 * - `CALLBACK_FAILED`  — a user callback (`onDeliveryFailure`,
 *   `onCritical`, `onBackpressure`) itself threw or rejected. The
 *   shared callback guard contains the fault (ADR-018): the emitter
 *   keeps publishing and each fault becomes one classified console
 *   line. Fix the callback; the line names it and carries the detail.
 *
 * Console classification (a token on a log line, not an `err.code`):
 * - `ADDRESS_IS_NAME`  — the `brokerUrl` host is a name other than
 *   `localhost`. One `logger.warn` line at setup, before the client is
 *   created (ADR-030). A name is allowed and the emitter proceeds; the
 *   line tells the operator that only a literal address is immune to a
 *   resolver that changes its answer under a running process. This
 *   emitter refuses and warns; it does not probe, because its posture
 *   is recovering (ADR-018 §5).
 *
 * @module mqtt-emitter
 */

import { resolveConfig } from './resolve-config.js';
import { openClient, waitForFirstConnect, attachConnectionHandlers } from './connection.js';
import { createHealth } from './health.js';
import { createPublishNow } from './publish.js';
import { createShutdown } from './shutdown-drain.js';

/**
 * Create production MQTT emitter.
 *
 * Validation runs before any side effect. Bad config rejects the
 * returned promise with a classified `INVALID_CONFIG` error, so a
 * refusal and a handle arrive through the same channel, the way
 * QuestDB's factory works. With a positive grace the promise resolves
 * after the first connack or the grace budget; at grace 0 it resolves
 * without a wait. The wiring layer awaits it (ADR-018).
 *
 * @param {Object} config - emitter config (see configSchema in index.js)
 * @returns {Promise<Object>} the emitter handle
 */
export const createEmitter = async function ( config ) {
    // Per ADR-018, setup-time refusals carry a classified err.code and
    // run before any side effect. `resolveConfig` throws in one fixed
    // order, and this async function turns each throw into a rejection.
    const resolved = resolveConfig( config );

    // Core state. `unacked` is THE counter (ADR-021): +1 on accepted
    // publish, -1 when the publish callback fires. Pressure, refusal,
    // drain, and health all read it.
    const state = {
        connected: false,
        hasConnectedOnce: false,
        shuttingDown: false,
        unacked: 0,
        stats: {
            published: 0,
            publishErrors: 0,
            encodeErrors: 0,
            errors: 0,
            reconnects: 0
        }
    };

    const client = openClient( resolved );

    const { getPressure, checkBackpressure, getHealth } = createHealth( {
        state,
        maxQueueSize: resolved.maxQueueSize,
        onCritical: resolved.onCritical,
        onBackpressure: resolved.onBackpressure
    } );
    const publishNow = createPublishNow( {
        client,
        state,
        codec: resolved.codec,
        getPressure,
        checkBackpressure,
        onDeliveryFailure: resolved.onDeliveryFailure
    } );
    const shutdown = createShutdown( { client, state } );

    // The permanent handlers attach before the grace wait's one-shot
    // listener, so a handle resolved via connack already reports
    // `connected: true`.
    attachConnectionHandlers( {
        client,
        state,
        debug: resolved.debug,
        redactedBrokerUrl: resolved.redactedBrokerUrl
    } );

    const handle = {
        publishNow,
        getHealth,
        shutdown,
        getPressure
    };

    // First-connack grace (bounded). By the time wire() hands the
    // emitter to the flow, the client has either seen its first
    // connack or spent the budget. Expiry is not an error — the
    // posture stays 'recovering'. With connectGraceMs 0 no wait is
    // armed and the promise resolves at once.
    if ( resolved.connectGraceMs > 0 ) {
        await waitForFirstConnect( client, resolved.connectGraceMs );
    }
    return handle;
}; // createEmitter()

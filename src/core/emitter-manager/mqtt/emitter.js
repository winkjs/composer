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
 *    - Return shape: the handle itself at grace 0, otherwise a Promise
 *      of it. The wiring layer awaits either (ADR-018).
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
 *   thrown TypeError per ADR-018's fail-fast setup rule.
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
 * @module mqtt-emitter
 */

import mqtt from 'mqtt';
import crypto from 'crypto';
import { ENV_VARS } from '../../env-vars.js';
import {
    QOS,
    MQTT_CONFIG,
    WINK_NAMESPACE,
    QUEUE_CRITICAL_THRESHOLD,
    MESSAGE_EXPIRY,
    DEFAULT_MAX_QUEUE_SIZE,
    MQTT_INFLIGHT_ID_LIMIT
} from './constants.js';
import { wrapCallback } from '../../utils/callback-guard/index.js';

/**
 * Pre-flight reject threshold on store pressure.
 * 0.9 = 10% headroom for in-flight drain on shutdown, plus a clean band
 * between the yellow-health threshold (0.66, shared with the yield level the
 * ADR-020 Draft proposes) and store exhaustion (1.0). At or above this,
 * `publishNow` returns `STORAGE_FULL` synchronously; the message is not buffered.
 * @type {number}
 */
const STORAGE_PRESSURE_LIMIT = 0.9;

/**
 * Pressure threshold above which `getHealth().status` elevates to at least
 * 'yellow' (uniform with Terminal/QuestDB). The value matches the
 * pressure-aware-yield design (ADR-020, still a Draft). That design
 * proposes 0.66 as the pressure level where the flow would start yielding
 * to let sinks drain; a benchmark still has to confirm the number. Today
 * the yield trigger is time-only (ADR-024), so this alignment is
 * forward-looking.
 * @type {number}
 */
const HEALTH_PRESSURE_YELLOW_THRESHOLD = 0.66;

/**
 * Singleton success result reused on every successful publish. Hot-path zero
 * allocation per ADR-013 / ADR-004. Plain literal — not frozen.
 * @type {{ok: true}}
 */
const RESULT_OK = { ok: true };

/**
 * Singleton error result for the pre-flight pressure-limit reject. Reused on
 * every occurrence; rare in healthy operation (pressure this close to the
 * limit means delivery has stopped draining), but a defined contract path.
 * @type {{ok: false, error: {code: string, message: string}}}
 */
const ERR_STORAGE_FULL = {
    ok: false,
    error: {
        code: 'STORAGE_FULL',
        message: 'Store at or above pressure limit (0.9) — cannot accept message'
    }
};

/**
 * Singleton error result for publishes attempted while shutdown is in progress.
 * @type {{ok: false, error: {code: string, message: string}}}
 */
const ERR_SHUTTING_DOWN = {
    ok: false,
    error: {
        code: 'SHUTTING_DOWN',
        message: 'Emitter is shutting down — message dropped'
    }
};

/**
 * Build a config-error TypeError tagged for ADR-018 fail-fast setup routing.
 * @param {string} message
 * @returns {TypeError}
 */
const invalidConfig = function ( message ) {
    const err = new TypeError( 'winkComposer/mqttEmitter: ' + message );
    err.code = 'INVALID_CONFIG';
    return err;
};

/**
 * Throw classified when an optional callback option is set to a non-function.
 * @param {*} value - the configured option value
 * @param {string} name - the option name for the error message
 */
const assertOptionalCallback = function ( value, name ) {
    if ( value !== undefined && typeof value !== 'function' ) {
        throw invalidConfig( `${name} must be a function` );
    }
};

/**
 * Validate and build the mqtt.js will (last-will testament) options.
 *
 * Direct createEmitter callers bypass the DSL schema, so the factory
 * checks the will shape itself, and the payload encoding runs behind
 * the same classified-throw rule as every other setup failure
 * (ADR-018, fail-fast setup) — a raw codec TypeError would reach the
 * caller unclassified.
 *
 * @param {Object} will - config.will as supplied
 * @param {Object} codec - config.codec (pack + contentType)
 * @returns {Object} the mqtt.js connect-options `will` object
 */
const buildWillOptions = function ( will, codec ) {
    if ( typeof will.topic !== 'string' || will.topic.length === 0 ) {
        throw invalidConfig( 'will.topic is required — a non-empty string' );
    }
    if ( will.message === undefined || will.message === null ) {
        throw invalidConfig( 'will.message is required' );
    }
    let willPayload;
    try {
        willPayload = Buffer.from( codec.pack( will.message ) );
    } catch ( packErr ) {
        throw invalidConfig( `will.message could not be encoded by the codec: ${packErr.message}` );
    }
    const willOptions = {
        topic: will.topic,
        payload: willPayload,
        // `??`, not `||`: 0 is a valid QoS.
        qos: will.qos ?? QOS,
        retain: will.retain !== false,  // Default true
        properties: {
            contentType: codec.contentType
        }
    };
    if ( codec.payloadFormatIndicator === 1 ) {
        willOptions.properties.payloadFormatIndicator = true;
    }
    return willOptions;
};

/**
 * Bounded wait for the client's first 'connect' event (the broker's
 * connection acknowledgment). Resolves when the event fires or when
 * graceMs elapses, whichever comes first. Expiry is NOT an error —
 * the startup posture stays 'recovering' (ADR-018): the caller gets
 * a working handle that reports `connected: false` while mqtt.js
 * retries in the background. The one-shot listener is removed on
 * expiry so a late connack reaches only the permanent state handler;
 * the timer is cleared on connect so nothing pins the event loop.
 *
 * @param {Object} client - mqtt.js client (EventEmitter surface)
 * @param {number} graceMs - positive wait budget, milliseconds
 * @returns {Promise<void>} resolves on first connect or expiry; never rejects
 */
const waitForFirstConnect = function ( client, graceMs ) {
    return new Promise( ( resolve ) => {
        let timer = null;
        const onConnect = function () {
            clearTimeout( timer );
            resolve();
        };
        timer = setTimeout( () => {
            client.removeListener( 'connect', onConnect );
            resolve();
        }, graceMs );
        client.once( 'connect', onConnect );
    } );
}; // waitForFirstConnect()

/**
 * Create production MQTT emitter.
 *
 * Validation is synchronous — bad config throws before any side
 * effect. The return shape depends on the effective grace:
 * `connectGraceMs === 0` returns the handle directly (today's callers
 * that need synchronous creation pass 0); otherwise returns a Promise
 * resolving to the handle after the first connack or the grace budget.
 * The wiring layer awaits either shape (ADR-018).
 *
 * @param {Object} config - emitter config (see configSchema in index.js)
 * @returns {Object|Promise<Object>} the emitter handle, or a Promise of it
 */
export const createEmitter = function ( config ) {
    // Per ADR-018, setup-time throws carry classified err.code.
    //
    // brokerUrl: `??` so explicit '' is the user's choice (not "fall back
    // to env"); `.trim()` rejects whitespace-only. Symmetric with QuestDB,
    // which throws on `ilpUrl: ''`.
    const rawBrokerUrl = config.brokerUrl ?? ENV_VARS.mqttBrokerUrl;
    const brokerUrl = typeof rawBrokerUrl === 'string' ? rawBrokerUrl.trim() : '';
    if ( !brokerUrl ) {
        throw invalidConfig( 'brokerUrl required — set a non-empty string in .emitter() config or MQTT_BROKER_URL env var' );
    }
    if ( !config.codec ) {
        throw invalidConfig( 'config.codec is required' );
    }
    if ( typeof config.codec.pack !== 'function' ) {
        throw invalidConfig( 'config.codec must have a pack() function' );
    }
    assertOptionalCallback( config.onDeliveryFailure, 'onDeliveryFailure' );
    assertOptionalCallback( config.onCritical, 'onCritical' );
    assertOptionalCallback( config.onBackpressure, 'onBackpressure' );

    // The three notification callbacks are armed by the shared
    // callback guard. They were validated raw above and are wrapped
    // once here. The wrap matters because all three run inside
    // mqtt.js's publish ack chain, where a user throw would land in
    // the client library (ADR-018). Each wrap is null when the
    // callback is absent, so every no-handler path below keeps its
    // exact meaning. That includes the deliberate unhandled-rejection
    // escape hatch for an unhandled delivery failure.
    const reportCallbackFault = function ( severity, name, detail ) {
        console.error(
            `winkComposer/mqttEmitter: user callback ${name} failed [CALLBACK_FAILED]: ${detail}`
        );
    };
    const onDeliveryFailure = wrapCallback( config.onDeliveryFailure, {
        name: 'onDeliveryFailure', severity: 'red', report: reportCallbackFault
    } );
    const onCritical = wrapCallback( config.onCritical, {
        name: 'onCritical', severity: 'red', report: reportCallbackFault
    } );
    const onBackpressure = wrapCallback( config.onBackpressure, {
        name: 'onBackpressure', severity: 'yellow', report: reportCallbackFault
    } );

    // First-connack grace: explicit config → MQTT_CONNECT_GRACE_MS env
    // fallback → 500 ms default (ADR-018 precedence; the fallback lives
    // here in the factory body, never as a schema sigil). `??` keeps an
    // explicit 0 — "hand the handle back immediately" — from falling
    // through to the env value. Number.isInteger also rejects Infinity,
    // so the wait is bounded by construction. Validated here, before
    // mqtt.connect opens anything (fail-fast setup per ADR-018).
    const connectGraceMs = config.connectGraceMs ?? ENV_VARS.mqttConnectGraceMs;
    if ( !Number.isInteger( connectGraceMs ) || connectGraceMs < 0 ) {
        throw invalidConfig( 'connectGraceMs must be a non-negative integer (milliseconds); 0 disables the first-connect wait' );
    }

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

    // Broker URLs may carry credentials (mqtt://user:pass@host). Debug
    // logs print this redacted form, so a debug flag flipped on in
    // production cannot leak the password into whatever collects stdout.
    const redactedBrokerUrl = brokerUrl.replace( /\/\/[^@/]*@/, '//***@' );

    // Generate unique client ID if not provided
    const clientId = config.clientId || `wink-${Date.now()}-${Math.random().toString( 36 ).slice( 2, 9 )}`;

    // The unacked cap. Clamped to the 16-bit packet-id space: every
    // unacknowledged QoS-1 message holds a packet id, so one connection
    // can never carry more than 65,535; 60,000 leaves working headroom
    // (same clamp the LevelDB store applied, kept with the same warning).
    const requestedQueueSize = config.maxQueueSize || DEFAULT_MAX_QUEUE_SIZE;
    if ( requestedQueueSize > MQTT_INFLIGHT_ID_LIMIT ) {
        console.warn(
            `winkComposer/mqttEmitter: maxQueueSize ${requestedQueueSize} exceeds the MQTT ` +
            `packet-id ceiling — clamped to ${MQTT_INFLIGHT_ID_LIMIT}`
        );
    }
    const maxQueueSize = Math.min( requestedQueueSize, MQTT_INFLIGHT_ID_LIMIT );

    // Build MQTT options.
    //
    // NO outgoingStore: the client runs its default SYNCHRONOUS memory
    // store (ADR-021). mqtt.js erases its packet-id bookkeeping on every
    // connack and rebuilds it from a store snapshot asynchronously; with
    // an asynchronous store, writes still in flight at that instant are
    // invisible to the snapshot and get overwritten by id reuse — real
    // QoS-1 loss, measured scaling with store write latency. The
    // synchronous store makes the gap zero-width (validated 2026-07-09,
    // nine-run matrix incl. reconnects at 45k in flight).
    //
    // messageIdProvider: the client's default provider cycles the 16-bit
    // id space with NO in-use check — at 14 k msg/s it wraps every ~5 s,
    // and an id whose PUBACK never arrived gets reassigned, overwriting
    // the unacked packet's memory-store entry (same key). Measured at
    // about one lost publish per 700,000 under sustained load.
    // UniqueMessageIdProvider never reissues an in-use id.
    const mqttOptions = {
        ...MQTT_CONFIG,
        clientId,
        messageIdProvider: new mqtt.UniqueMessageIdProvider()
    };

    // Only add will if explicitly provided (validated + encoded by the
    // helper above; classified throws per ADR-018)
    if ( config.will ) {
        mqttOptions.will = buildWillOptions( config.will, config.codec );
    }

    // Create MQTT client (injectable for testing). mqtt.connect throws
    // its own raw TypeError on a malformed url; classify it like every
    // other setup failure. The error text uses the redacted url — a
    // malformed url can still carry credentials.
    const connect = config.mqttConnectFn || mqtt.connect;
    let client;
    try {
        client = connect( brokerUrl, mqttOptions );
    } catch ( connectErr ) {
        throw invalidConfig( `brokerUrl rejected by the MQTT client ('${redactedBrokerUrl}'): ${connectErr.message}` );
    }

    /**
     * Fill ratio of the unacked window: unacked / maxQueueSize, capped
     * at 1. Sync, O(1), allocation-free (ADR-018).
     * @returns {number}
     */
    const getPressure = function () {
        const ratio = state.unacked / maxQueueSize;
        return ratio > 1 ? 1 : ratio;
    };

    /**
     * Check and signal backpressure
     */
    const checkBackpressure = function () {
        const pressure = getPressure();

        if ( ( pressure > QUEUE_CRITICAL_THRESHOLD ) && onCritical ) {
            onCritical( 'QUEUE_CRITICAL', pressure );
        }

        if ( onBackpressure ) {
            onBackpressure( pressure );
        }
    };

    /**
     * Publish message immediately (fire-and-forget).
     *
     * Sync return per the ADR-018 sink contract:
     * - `{ ok: true }` on successful buffer.
     * - `{ ok: false, error: { code: 'STORAGE_FULL', message } }` if pre-flight
     *   pressure check rejects (pressure >= STORAGE_PRESSURE_LIMIT).
     * - `{ ok: false, error: { code: 'SHUTTING_DOWN', message } }` if called
     *   while shutdown is in progress.
     *
     * Async store-write or publish failures (after the message was buffered)
     * route through `onDeliveryFailure(err, { topic })` when supplied; without
     * a handler the adapter surfaces the failure via `Promise.reject`,
     * which Node logs as unhandledRejection (and v15+ exits on). Loud failure
     * beats silent loss.
     *
     * @param {string} topic - MQTT topic
     * @param {*} message - Message payload (will be encoded via config.codec)
     * @param {Object} [options] - Per-message options
     * @param {string} [options.type] - Message-type key for MESSAGE_EXPIRY lookup
     * @returns {{ok: true} | {ok: false, error: {code: string, message: string}}}
     */
    const publishNow = function ( topic, message, options ) {
        if ( state.shuttingDown ) {
            return ERR_SHUTTING_DOWN;
        }

        // Pre-flight pressure check — reject above STORAGE_PRESSURE_LIMIT to
        // leave headroom for in-flight drain and to surface backpressure to
        // producers before the store is literally full.
        if ( getPressure() >= STORAGE_PRESSURE_LIMIT ) {
            return ERR_STORAGE_FULL;
        }

        // Encode BEFORE the counter moves. A message the codec cannot
        // encode was never in flight, so it must not occupy a slot: a
        // leaked slot never drains, pressure ratchets up, and the
        // emitter ends up refusing everything. The
        // refusal is synchronous and classified; building it allocates,
        // which is fine on an error path this rare.
        let payload;
        try {
            payload = config.codec.pack( message );
        } catch ( packErr ) {
            state.stats.encodeErrors += 1;
            return {
                ok: false,
                error: {
                    code: 'ENCODE_ERROR',
                    message: `Message could not be encoded (topic=${topic}): ${packErr.message}`
                }
            };
        }

        const dedupId = crypto.randomUUID();
        const messageType = ( options && options.type ) || 'default';
        const expiry = MESSAGE_EXPIRY[ messageType ] || MESSAGE_EXPIRY.default;

        // Per-message allocations from here to the publish call (the
        // uuid, the properties object, the callback closure) cannot be
        // pre-allocated and reused: mqtt.js keeps the packet — properties
        // included — until PUBACK so it can retransmit, and a shared
        // mutated object would corrupt every queued retransmission (the
        // unavoidable-residual justification ADR-018 asks for).
        const properties = {
            messageExpiryInterval: expiry,
            userProperties: {
                [ WINK_NAMESPACE.dedupId ]: dedupId,
                [ WINK_NAMESPACE.timestamp ]: Date.now().toString(),
                [ WINK_NAMESPACE.version ]: '1.0'
            },
            contentType: config.codec.contentType
        };

        if ( config.codec.payloadFormatIndicator === 1 ) {
            properties.payloadFormatIndicator = true;
        }

        // Accept: the message is now in flight. The counter rises HERE,
        // synchronously with the accept decision, so the very next
        // publishNow call sees the true pressure (the old design's
        // optimistic-increment lesson, kept).
        state.unacked += 1;

        // Fire-and-forget publish with QoS 1. Outcome of this async callback is
        // observability-only — the publishNow caller has already received a
        // synchronous result. The callback fires exactly once per publish
        // (acknowledgment or failure), so the decrement below is the
        // counter's single exit — paired with the catch, which releases
        // the slot when the client rejects the call before accepting it.
        try {
            client.publish(
                topic,
                payload,
                { qos: QOS, properties },
                ( err ) => {
                    state.unacked -= 1;
                    if ( err ) {
                        state.stats.publishErrors += 1;
                        const deliveryErr = new Error(
                            `winkComposer/mqttEmitter: publish failed (topic=${topic}): ${err.message || err.code || 'unknown'}`
                        );
                        deliveryErr.code = 'DELIVERY_FAILED';
                        deliveryErr.cause = err;
                        if ( onDeliveryFailure ) {
                            onDeliveryFailure( deliveryErr, { topic } );
                        } else {
                            // No handler — surface as unhandledRejection so the
                            // process logs loudly and (Node 15+) exits. Mirrors
                            // QuestDB's persist-plan.js catch-and-throw: both
                            // adapters route undeclared async failures
                            // through the same Node-level escape hatch.
                            Promise.reject( deliveryErr );
                        }
                    } else {
                        state.stats.published += 1;
                    }
                    checkBackpressure();
                }
            );
        } catch ( publishErr ) {
            // The client threw before accepting the message; its callback
            // will never fire, so the slot is released here — the sync
            // face of DELIVERY_FAILED (see the header vocabulary).
            state.unacked -= 1;
            state.stats.publishErrors += 1;
            return {
                ok: false,
                error: {
                    code: 'DELIVERY_FAILED',
                    message: `MQTT publish rejected (topic=${topic}): ${publishErr.message}`
                }
            };
        }

        return RESULT_OK;
    };

    // Shutdown outcome, latched on the first call. A second
    // caller used to get an instant clean resolve — mid-drain, or even
    // after a shutdown that recorded dropped messages. Every caller now
    // receives the first call's promise.
    let shutdownPromise = null;

    const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;

    /**
     * The real shutdown body. `shutdown` below latches its promise so
     * every caller receives this one outcome.
     *
     * **Drain-then-close** (a sustained-load finding, kept through the
     * ADR-021 rework): mqtt.js's own `end()` does not reliably drain
     * in-flight publishes, so the emitter waits on its own counter.
     *
     *  1. Sets `state.shuttingDown` so `publishNow` rejects new work
     *     (returns `SHUTTING_DOWN` immediately).
     *  2. **Polls the unacked counter until zero**, using the whole
     *     `timeout` budget — no early give-up. The wait runs whether or
     *     not the connection is up at the moment of the call: mqtt.js
     *     auto-reconnects, so a mid-drain reconnect can still deliver
     *     the backlog inside the budget.
     *  3. Once drained (or budget expired), calls `client.end(...)`
     *     with the remaining time as the broker-DISCONNECT budget.
     *  4. Force-closes if the broker hangs the DISCONNECT.
     *
     * The old design's shutdown re-drive (re-sending stragglers through
     * a store stream scan) died with the disk store: with the memory
     * store there is no store to scan, and a message whose PUBACK was
     * lost in-session is re-sent by the client itself on the next
     * reconnect. If it is still unacknowledged at the deadline, the
     * loss report counts it.
     *
     * A clean resolve is a delivery statement (ADR-018). When the
     * drain could not complete, shutdown rejects with classified
     * `SHUTDOWN_TIMEOUT` and `dropped: { count }` — the counter's exact
     * value — after the close has already happened (teardown first,
     * then the report). This fires CONNECTED OR NOT: with no disk
     * store, nothing survives the process, so a disconnected shutdown
     * with pending messages is a real loss and is reported as one. (The
     * wal-backed design resolved that case clean on purpose — its disk
     * store held the messages for the next session. ADR-021 traded that
     * away and says so.)
     */
    const doShutdown = async function ( timeout ) {
        state.shuttingDown = true;

        // A non-finite or non-positive timeout collapses the drain
        // (Infinity overflows setTimeout, which clamps it to ~1 ms;
        // NaN fails every deadline comparison), so it falls back to
        // the default budget.
        const budget = ( Number.isFinite( timeout ) && timeout > 0 ) ? timeout : DEFAULT_SHUTDOWN_TIMEOUT_MS;
        const deadline = Date.now() + budget;
        const drainPollIntervalMs = 25;

        // Drain wait — one cheap counter read per tick; sequential
        // awaits are the wait-for-condition pattern.
        while ( Date.now() < deadline && state.unacked > 0 ) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise( ( r ) => setTimeout( r, drainPollIntervalMs ) );
        }

        // Whatever is still unacknowledged goes undelivered — publishNow
        // stopped accepting work at step 1, so the counter has settled
        // into its final value. It becomes the `dropped` payload below.
        const undeliveredCount = state.unacked;
        const remaining = Date.now() - deadline;
        const closeBudget = remaining < 0 ? Math.abs( remaining ) : 1;

        await new Promise( ( resolve ) => {
            const forceTimer = setTimeout( () => {
                client.end( true );
                resolve();
            }, closeBudget );

            if ( state.connected ) {
                client.end( false, {}, () => {
                    clearTimeout( forceTimer );
                    resolve();
                } );
            } else {
                clearTimeout( forceTimer );
                client.end( true );
                resolve();
            }
        } );

        // Teardown first, then the report: the close has already happened;
        // an incomplete drain must not read as a clean one (ADR-018).
        if ( undeliveredCount > 0 ) {
            const err = new Error(
                `winkComposer/mqttEmitter: shutdown closed with ${undeliveredCount} message(s) unacknowledged`
            );
            err.code = 'SHUTDOWN_TIMEOUT';
            err.dropped = { count: undeliveredCount };
            throw err;
        }
        return undefined;
    }; // doShutdown()

    /**
     * Graceful shutdown — drain semantics with a timeout floor.
     *
     * Accepts the ADR-018 shutdown-contract shape `{ timeout }` (defaults to
     * 5000ms). The destructure with `= {}` lets callers invoke
     * `shutdown()` with no argument, `shutdown( {} )`, or
     * `shutdown( { timeout: N } )`.
     *
     * The outcome is latched: the first call runs the shutdown, every
     * later call returns the same promise. A caller
     * arriving mid-drain waits for the real teardown; a caller arriving
     * after a lossy shutdown sees the same classified rejection, never
     * a contradicting clean resolve. One consequence: the first
     * caller's `{ timeout }` governs; a later caller's is ignored.
     *
     * @param {{timeout?: number}} [options]
     * @returns {Promise<void>}
     */
    const shutdown = function ( { timeout = DEFAULT_SHUTDOWN_TIMEOUT_MS } = {} ) {
        if ( !shutdownPromise ) {
            shutdownPromise = doShutdown( timeout );
        }
        return shutdownPromise;
    }; // shutdown()

    // Connection handlers - minimal, no automatic status
    client.on( 'connect', () => {
        state.connected = true;
        // mqtt.js fires 'connect' on every connack, including mid-run
        // reconnects. Counting the later ones gives operators — and the
        // release-soak signature policy — an observable "a reconnect
        // happened during this run" fact via getHealth().stats.
        if ( state.hasConnectedOnce ) {
            state.stats.reconnects += 1;
        }
        state.hasConnectedOnce = true;
        if ( config.debug ) {
            console.log( `winkComposer/mqttEmitter: Connected to ${redactedBrokerUrl}` );
        }
    } );

    client.on( 'offline', () => {
        state.connected = false;
        if ( config.debug ) {
            console.log( `winkComposer/mqttEmitter: Offline - ${state.unacked} messages in flight` );
        }
    } );

    client.on( 'error', ( err ) => {
        state.stats.errors += 1;
        if ( config.debug ) {
            console.error( `winkComposer/mqttEmitter: client error: ${err.message}` );
        }
    } );

    /**
     * Health snapshot for operator monitoring (uniform across sinks).
     *
     * Returns the ADR-018 health floor `{status, connected, pressure}` plus
     * this adapter's own `stats` addition. `stats.unacked` is the live
     * counter — the number of messages
     * accepted but not yet acknowledged by the broker; exactly what a
     * process crash at this instant would cost (ADR-021).
     *
     * Status derivation (uniform with Terminal/QuestDB; see file header):
     * - `red`    when `!connected`
     * - `yellow` when connected AND `pressure >= HEALTH_PRESSURE_YELLOW_THRESHOLD`
     * - `green`  otherwise
     *
     * The wal-backed design's `storeHealth`, `circuitState`, and `metrics`
     * diagnostics died with the LevelDB store (ADR-021).
     *
     * @returns {Object} Health snapshot — required floor + live counter
     */
    const getHealth = function () {
        const pressure = getPressure();

        let status;
        if ( !state.connected ) {
            status = 'red';
        } else if ( pressure >= HEALTH_PRESSURE_YELLOW_THRESHOLD ) {
            status = 'yellow';
        } else {
            status = 'green';
        }

        return {
            // Required floor (ADR-018)
            status,
            connected: state.connected,
            pressure,
            // This adapter's addition beyond the floor
            stats: { ...state.stats, unacked: state.unacked }
        };
    };

    const handle = {
        publishNow,
        getHealth,
        shutdown,
        getPressure
    };

    // First-connack grace (bounded). With a grace, the return is a
    // Promise the wiring layer awaits (ADR-018 allows sync or async
    // factories): by the time wire() hands the emitter to the flow,
    // the client has either seen its first connack or spent the
    // budget. Expiry is not an error — the posture stays 'recovering'.
    // With connectGraceMs 0 the handle returns synchronously, exactly
    // the pre-grace behavior. The permanent 'connect' handler above is
    // attached before the wait's one-shot listener, so a handle
    // resolved via connack already reports `connected: true`.
    if ( connectGraceMs === 0 ) {
        return handle;
    }
    return waitForFirstConnect( client, connectGraceMs ).then( () => handle );
}; // createMQTTEmitter()

// core/emitter-manager/mqtt/resolve-config.js

/**
 * @fileoverview Resolves and validates the MQTT emitter's configuration
 * before the factory opens anything (ADR-018, fail-fast setup).
 *
 * The factory in `emitter.js` calls `resolveConfig` once. Every
 * refusal here is a classified `INVALID_CONFIG` TypeError. The checks
 * run in one fixed order: the broker URL, the address policy, the
 * codec, the three callbacks, the grace, the queue size, and the will.
 * The factory is async, so a caller sees each refusal as a rejection.
 *
 * The module also arms the three notification callbacks through the
 * shared callback guard. A user throw inside the publish ack chain
 * then becomes one `CALLBACK_FAILED` line instead of a fault inside
 * mqtt.js (ADR-018, ADR-027).
 *
 * Nothing here runs on the message path. Every value is resolved once
 * and captured by the closures the other modules build.
 *
 * @see ADR-018
 * @see ADR-021
 * @see ADR-030
 */

import mqtt from 'mqtt';
import { ENV_VARS } from '../../env-vars.js';
import {
    QOS,
    MQTT_CONFIG,
    DEFAULT_MAX_QUEUE_SIZE,
    MQTT_INFLIGHT_ID_LIMIT
} from './constants.js';
import { wrapCallback } from '../../utils/callback-guard/index.js';
import { jitteredPeriod } from '../../utils/jitter/index.js';
import { logger } from '../../logger/index.js';
import { classifyAddress, localhostRefusalMessage } from '../../utils/address/index.js';

/**
 * Build a config-error TypeError tagged for ADR-018 fail-fast setup routing.
 * @param {string} message
 * @returns {TypeError}
 */
export const invalidConfig = function ( message ) {
    const err = new TypeError( 'winkComposer/mqttEmitter: ' + message );
    err.code = 'INVALID_CONFIG';
    return err;
};

/**
 * Classifies the broker address and refuses `localhost` (ADR-030).
 * The schema already refused it at flow definition; this call covers
 * the `MQTT_BROKER_URL` fallback and direct callers, and carries the
 * classified code.
 *
 * @param {string} brokerUrl - The broker URL, config or env fallback
 * @returns {Object} The classified address
 * @throws {TypeError} INVALID_CONFIG when the host is `localhost`
 */
const assertBrokerNotLocalhost = function ( brokerUrl ) {
    const address = classifyAddress( brokerUrl, 'url' );
    if ( address.kind === 'localhost' ) {
        throw invalidConfig( localhostRefusalMessage( { field: 'brokerUrl', address, envVar: 'MQTT_BROKER_URL' } ) );
    }
    return address;
}; // assertBrokerNotLocalhost()

/**
 * Throw classified when an optional callback option is set to a non-function.
 * @param {*} value - the configured option value
 * @param {string} name - the option name for the error message
 */
const assertOptionalCallback = function ( value, name ) {
    if ( ( value !== undefined ) && ( typeof value !== 'function' ) ) {
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
    if ( ( typeof will.topic !== 'string' ) || ( will.topic.length === 0 ) ) {
        throw invalidConfig( 'will.topic is required — a non-empty string' );
    }
    if ( ( will.message === undefined ) || ( will.message === null ) ) {
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
 * Resolves the broker URL from config or the env fallback, refuses an
 * empty one, and applies the address policy.
 *
 * `??` so explicit '' is the user's choice (not "fall back to env");
 * `.trim()` rejects whitespace-only. Symmetric with QuestDB, which
 * throws on `ilpUrl: ''`. Broker URLs may carry credentials
 * (mqtt://user:pass@host), so the redacted form is built here for
 * every later log line.
 *
 * @param {Object} config - emitter config
 * @returns {{brokerUrl: string, brokerAddress: Object, redactedBrokerUrl: string}}
 */
const resolveBrokerUrl = function ( config ) {
    const rawBrokerUrl = config.brokerUrl ?? ENV_VARS.mqttBrokerUrl;
    const brokerUrl = typeof rawBrokerUrl === 'string' ? rawBrokerUrl.trim() : '';
    if ( !brokerUrl ) {
        throw invalidConfig( 'brokerUrl required — set a non-empty string in .emitter() config or MQTT_BROKER_URL env var' );
    }
    // Address policy (ADR-030): `localhost` is refused before the
    // client is created; a name is warned about just before connect.
    const brokerAddress = assertBrokerNotLocalhost( brokerUrl );
    const redactedBrokerUrl = brokerUrl.replace( /\/\/[^@/]*@/, '//***@' );
    return { brokerUrl, brokerAddress, redactedBrokerUrl };
}; // resolveBrokerUrl()

/**
 * Refuses a missing codec or one without `pack()`.
 * @param {Object} codec - config.codec
 */
const assertCodec = function ( codec ) {
    if ( !codec ) {
        throw invalidConfig( 'config.codec is required' );
    }
    if ( typeof codec.pack !== 'function' ) {
        throw invalidConfig( 'config.codec must have a pack() function' );
    }
}; // assertCodec()

/**
 * Validates the three notification callbacks and arms them through
 * the shared callback guard.
 *
 * The wrap matters because all three run inside mqtt.js's publish ack
 * chain, where a user throw would land in the client library
 * (ADR-018). Each wrap is null when the callback is absent, so every
 * no-handler path keeps its exact meaning. That includes the
 * deliberate unhandled-rejection escape hatch for an unhandled
 * delivery failure.
 *
 * @param {Object} config - emitter config
 * @returns {{onDeliveryFailure: function|null, onCritical: function|null, onBackpressure: function|null}}
 */
const armCallbacks = function ( config ) {
    assertOptionalCallback( config.onDeliveryFailure, 'onDeliveryFailure' );
    assertOptionalCallback( config.onCritical, 'onCritical' );
    assertOptionalCallback( config.onBackpressure, 'onBackpressure' );

    const reportCallbackFault = function ( severity, name, detail ) {
        logger.error(
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
    return { onDeliveryFailure, onCritical, onBackpressure };
}; // armCallbacks()

/**
 * Resolves the first-connack grace: explicit config → MQTT_CONNECT_GRACE_MS
 * env fallback → 500 ms default (ADR-018 precedence; the fallback lives
 * here, never as a schema sigil). `??` keeps an explicit 0 — "hand the
 * handle back immediately" — from falling through to the env value.
 * Number.isInteger also rejects Infinity, so the wait is bounded by
 * construction.
 *
 * @param {Object} config - emitter config
 * @returns {number} the grace in milliseconds, 0 for no wait
 */
const resolveGrace = function ( config ) {
    const connectGraceMs = config.connectGraceMs ?? ENV_VARS.mqttConnectGraceMs;
    if ( !Number.isInteger( connectGraceMs ) || ( connectGraceMs < 0 ) ) {
        throw invalidConfig( 'connectGraceMs must be a non-negative integer (milliseconds); 0 disables the first-connect wait' );
    }
    return connectGraceMs;
}; // resolveGrace()

/**
 * Resolves the unacked cap. Clamped to the 16-bit packet-id space:
 * every unacknowledged QoS-1 message holds a packet id, so one
 * connection can never carry more than 65,535; 60,000 leaves working
 * headroom (same clamp the LevelDB store applied, kept with the same
 * warning).
 *
 * @param {Object} config - emitter config
 * @returns {number} the effective cap
 */
const resolveQueueSize = function ( config ) {
    const requestedQueueSize = config.maxQueueSize || DEFAULT_MAX_QUEUE_SIZE;
    if ( requestedQueueSize > MQTT_INFLIGHT_ID_LIMIT ) {
        logger.warn(
            `winkComposer/mqttEmitter: maxQueueSize ${requestedQueueSize} exceeds the MQTT ` +
            `packet-id ceiling — clamped to ${MQTT_INFLIGHT_ID_LIMIT}`
        );
    }
    return Math.min( requestedQueueSize, MQTT_INFLIGHT_ID_LIMIT );
}; // resolveQueueSize()

/**
 * Builds the mqtt.js connect options.
 *
 * NO outgoingStore: the client runs its default SYNCHRONOUS memory
 * store (ADR-021). mqtt.js erases its packet-id bookkeeping on every
 * connack and rebuilds it from a store snapshot asynchronously; with
 * an asynchronous store, writes still in flight at that instant are
 * invisible to the snapshot and get overwritten by id reuse — real
 * QoS-1 loss, measured scaling with store write latency. The
 * synchronous store makes the gap zero-width (validated 2026-07-09,
 * nine-run matrix incl. reconnects at 45k in flight).
 *
 * messageIdProvider: the client's default provider cycles the 16-bit
 * id space with NO in-use check — at 14 k msg/s it wraps every ~5 s,
 * and an id whose PUBACK never arrived gets reassigned, overwriting
 * the unacked packet's memory-store entry (same key). Measured at
 * about one lost publish per 700,000 under sustained load.
 * UniqueMessageIdProvider never reissues an in-use id.
 *
 * @param {Object} config - emitter config
 * @returns {Object} the options handed to `mqtt.connect`
 */
const buildClientOptions = function ( config ) {
    // Generate unique client ID if not provided
    const clientId = config.clientId || `wink-${Date.now()}-${Math.random().toString( 36 ).slice( 2, 9 )}`;

    const mqttOptions = {
        ...MQTT_CONFIG,
        clientId,
        // The configured period plus a random share of up to 20%,
        // drawn once here, so a fleet that lost one broker does not
        // retry in step. The configured period is the floor.
        reconnectPeriod: jitteredPeriod( MQTT_CONFIG.reconnectPeriod ),
        messageIdProvider: new mqtt.UniqueMessageIdProvider()
    };

    // Only add will if explicitly provided (validated + encoded by the
    // helper above; classified throws per ADR-018)
    if ( config.will ) {
        mqttOptions.will = buildWillOptions( config.will, config.codec );
    }
    return mqttOptions;
}; // buildClientOptions()

/**
 * Resolves the whole configuration in the factory's fixed order.
 * Every refusal is a classified `INVALID_CONFIG` throw, and no check
 * has a side effect beyond the clamp warning.
 *
 * @param {Object} config - emitter config (see configSchema in index.js)
 * @returns {Object} the resolved values the factory hands to its modules
 */
export const resolveConfig = function ( config ) {
    const { brokerUrl, brokerAddress, redactedBrokerUrl } = resolveBrokerUrl( config );
    assertCodec( config.codec );
    const { onDeliveryFailure, onCritical, onBackpressure } = armCallbacks( config );
    const connectGraceMs = resolveGrace( config );
    const maxQueueSize = resolveQueueSize( config );
    const mqttOptions = buildClientOptions( config );

    return {
        brokerUrl,
        brokerAddress,
        redactedBrokerUrl,
        codec: config.codec,
        onDeliveryFailure,
        onCritical,
        onBackpressure,
        connectGraceMs,
        maxQueueSize,
        mqttOptions,
        // Injectable for testing (ADR-018 module surface keeps this
        // out of the schema's documented options).
        connect: config.mqttConnectFn || mqtt.connect,
        debug: Boolean( config.debug )
    };
}; // resolveConfig()

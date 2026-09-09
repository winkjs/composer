// core/emitter-manager/mqtt/publish.js

/**
 * @fileoverview The MQTT emitter's hot path: `publishNow` (ADR-013,
 * ADR-018, ADR-021).
 *
 * A publish is fire-and-forget with QoS 1. The call encodes the
 * message, checks pressure, raises the unacked counter, and hands the
 * packet to mqtt.js. It returns a synchronous `{ ok }` result and
 * never a promise. The client's callback fires once per packet, on
 * acknowledgment or failure, and `settlePublish` lowers the counter
 * there. So the counter's single exit is that callback, paired with
 * the catch that releases the slot when the client rejects the call
 * before accepting it.
 *
 * Refusals are classified, synchronous, and allocation-free where the
 * result can be shared: `SHUTTING_DOWN` and `STORAGE_FULL` are
 * singletons. `ENCODE_ERROR` and the sync face of `DELIVERY_FAILED`
 * build their result, because they carry the failure's own text and
 * are rare.
 *
 * @see ADR-013
 * @see ADR-018
 * @see ADR-021
 */

import crypto from 'crypto';
import {
    QOS,
    WINK_NAMESPACE,
    MESSAGE_EXPIRY
} from './constants.js';

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
 * The `ENCODE_ERROR` refusal. Built per event, because it carries the
 * codec's own message; the path is rare.
 *
 * @param {string} topic - The topic of the refused message
 * @param {Error} packErr - The codec's throw
 * @returns {{ok: false, error: {code: string, message: string}}}
 */
const encodeRefusal = function ( topic, packErr ) {
    return {
        ok: false,
        error: {
            code: 'ENCODE_ERROR',
            message: `Message could not be encoded (topic=${topic}): ${packErr.message}`
        }
    };
}; // encodeRefusal()

/**
 * The sync face of `DELIVERY_FAILED`: the client threw before
 * accepting the message, so nothing is in flight.
 *
 * @param {string} topic - The topic of the refused message
 * @param {Error} publishErr - The client's throw
 * @returns {{ok: false, error: {code: string, message: string}}}
 */
const publishRefusal = function ( topic, publishErr ) {
    return {
        ok: false,
        error: {
            code: 'DELIVERY_FAILED',
            message: `MQTT publish rejected (topic=${topic}): ${publishErr.message}`
        }
    };
}; // publishRefusal()

/**
 * Builds the MQTT v5 properties of one publish: the expiry, the
 * dedup id, the timestamp, and the content type.
 *
 * Per-message allocations here (the uuid, the properties object) and
 * the callback closure in `publishNow` cannot be pre-allocated and
 * reused: mqtt.js keeps the packet — properties included — until
 * PUBACK so it can retransmit, and a shared mutated object would
 * corrupt every queued retransmission (the unavoidable-residual
 * justification ADR-018 asks for).
 *
 * @param {Object} codec - The configured codec (contentType, payloadFormatIndicator)
 * @param {number} expiry - The message expiry in seconds
 * @returns {Object} the properties object mqtt.js keeps until PUBACK
 */
const buildProperties = function ( codec, expiry ) {
    const properties = {
        messageExpiryInterval: expiry,
        userProperties: {
            [ WINK_NAMESPACE.dedupId ]: crypto.randomUUID(),
            [ WINK_NAMESPACE.timestamp ]: Date.now().toString(),
            [ WINK_NAMESPACE.version ]: '1.0'
        },
        contentType: codec.contentType
    };

    if ( codec.payloadFormatIndicator === 1 ) {
        properties.payloadFormatIndicator = true;
    }
    return properties;
}; // buildProperties()

/**
 * Builds `publishNow` over the shared state and the armed callbacks.
 *
 * @param {Object} deps
 * @param {Object} deps.client - mqtt.js client
 * @param {Object} deps.state - The emitter's core state
 * @param {Object} deps.codec - The configured codec (pack, contentType)
 * @param {function} deps.getPressure - The pressure reader from health.js
 * @param {function} deps.checkBackpressure - The pressure signaller from health.js
 * @param {function|null} deps.onDeliveryFailure - Guard-wrapped delivery-failure callback, or null
 * @returns {function} publishNow
 */
export const createPublishNow = function ( { client, state, codec, getPressure, checkBackpressure, onDeliveryFailure } ) {

    /**
     * Settles one publish when its callback fires. Outcome of this async
     * callback is observability-only — the publishNow caller has
     * already received a synchronous result. The callback fires exactly
     * once per publish (acknowledgment or failure), so the decrement
     * here is the counter's single exit.
     *
     * @param {Error|null} err - The client's failure, or null on acknowledgment
     * @param {string} topic - The published topic, for the failure report
     */
    const settlePublish = function ( err, topic ) {
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
    }; // settlePublish()

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
            payload = codec.pack( message );
        } catch ( packErr ) {
            state.stats.encodeErrors += 1;
            return encodeRefusal( topic, packErr );
        }

        const messageType = ( options && options.type ) || 'default';
        const expiry = MESSAGE_EXPIRY[ messageType ] || MESSAGE_EXPIRY.default;
        const properties = buildProperties( codec, expiry );

        // Accept: the message is now in flight. The counter rises HERE,
        // synchronously with the accept decision, so the very next
        // publishNow call sees the true pressure (the old design's
        // optimistic-increment lesson, kept).
        state.unacked += 1;

        // Fire-and-forget publish with QoS 1. The callback settles the
        // counter (see settlePublish above), paired with the catch,
        // which releases the slot when the client rejects the call
        // before accepting it.
        try {
            client.publish(
                topic,
                payload,
                { qos: QOS, properties },
                ( err ) => settlePublish( err, topic )
            );
        } catch ( publishErr ) {
            // The client threw before accepting the message; its callback
            // will never fire, so the slot is released here — the sync
            // face of DELIVERY_FAILED (see the header vocabulary).
            state.unacked -= 1;
            state.stats.publishErrors += 1;
            return publishRefusal( topic, publishErr );
        }

        return RESULT_OK;
    }; // publishNow()

    return publishNow;
}; // createPublishNow()

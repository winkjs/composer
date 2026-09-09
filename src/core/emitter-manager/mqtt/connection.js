// core/emitter-manager/mqtt/connection.js

/**
 * @fileoverview The MQTT emitter's connection: opening the client,
 * the bounded first-connack wait, and the event handlers that keep
 * `state.connected` and the counters current.
 *
 * Reconnection stays the library's job (ADR-018). mqtt.js retries at
 * its configured period for as long as the process lives. This module
 * only listens: `connect` marks the link up and counts every connack
 * after the first as a reconnect, `offline` marks it down, and
 * `error` counts the event. Nothing here touches the message path.
 *
 * The startup posture is recovering (ADR-018). `openClient` never
 * fails because the broker is unreachable. Only a URL the library
 * itself refuses is a setup failure, classified `INVALID_CONFIG`.
 *
 * @see ADR-018
 * @see ADR-030
 */

import { logger } from '../../logger/index.js';
import { nameWarningMessage } from '../../utils/address/index.js';
import { invalidConfig } from './resolve-config.js';

/**
 * Prints the one ADDRESS_IS_NAME line when the broker host is a name.
 *
 * @param {Object} address - The classified broker address
 */
const warnIfBrokerIsName = function ( address ) {
    if ( address.kind === 'name' ) {
        logger.warn(
            `winkComposer/mqttEmitter: ${nameWarningMessage( { field: 'brokerUrl', host: address.host } )}`
        );
    }
}; // warnIfBrokerIsName()

/**
 * Creates the MQTT client. mqtt.connect throws its own raw TypeError
 * on a malformed url; classify it like every other setup failure. The
 * error text uses the redacted url — a malformed url can still carry
 * credentials. The name warning goes first, so it prints before any
 * socket opens (ADR-030).
 *
 * @param {Object} resolved - The resolved configuration
 * @param {string} resolved.brokerUrl - The broker URL
 * @param {Object} resolved.brokerAddress - Its classified address
 * @param {string} resolved.redactedBrokerUrl - The URL with credentials hidden
 * @param {Object} resolved.mqttOptions - The connect options
 * @param {function} resolved.connect - `mqtt.connect` or the injected connect function
 * @returns {Object} the mqtt.js client
 * @throws {TypeError} INVALID_CONFIG when the client refuses the URL
 */
export const openClient = function ( { brokerUrl, brokerAddress, redactedBrokerUrl, mqttOptions, connect } ) {
    warnIfBrokerIsName( brokerAddress );
    try {
        return connect( brokerUrl, mqttOptions );
    } catch ( connectErr ) {
        throw invalidConfig( `brokerUrl rejected by the MQTT client ('${redactedBrokerUrl}'): ${connectErr.message}` );
    }
}; // openClient()

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
export const waitForFirstConnect = function ( client, graceMs ) {
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
 * Attaches the permanent connection handlers. Minimal, no automatic
 * status: the handle's `getHealth()` reads `state`.
 *
 * @param {Object} deps
 * @param {Object} deps.client - mqtt.js client
 * @param {Object} deps.state - The emitter's core state
 * @param {boolean} deps.debug - Whether the debug lines print
 * @param {string} deps.redactedBrokerUrl - The URL with credentials hidden
 */
export const attachConnectionHandlers = function ( { client, state, debug, redactedBrokerUrl } ) {
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
        if ( debug ) {
            logger.info( `winkComposer/mqttEmitter: Connected to ${redactedBrokerUrl}` );
        }
    } );

    client.on( 'offline', () => {
        state.connected = false;
        if ( debug ) {
            logger.info( `winkComposer/mqttEmitter: Offline - ${state.unacked} messages in flight` );
        }
    } );

    client.on( 'error', ( err ) => {
        state.stats.errors += 1;
        if ( debug ) {
            logger.error( `winkComposer/mqttEmitter: client error: ${err.message}` );
        }
    } );
}; // attachConnectionHandlers()

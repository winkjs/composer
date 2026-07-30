// core/test-utils/tcp-proxy.js

/* eslint-disable no-empty-function */

/**
 * @fileoverview Tiny TCP proxy for outage-recovery tests. Listens on
 * a port, forwards each connection bidirectionally to a target port.
 * Closing the proxy server tears down all live sockets so existing
 * client sockets see the outage immediately; reopening on the same
 * port restores connectivity.
 *
 * Used by the QuestDB recovery tests and the MQTT emitter
 * recovery tests. Both adapters needed an in-test way to simulate
 * "service unreachable" without coupling tests to docker daemon
 * access. The pattern is identical for any TCP-based service.
 *
 * Cross-cutting test infrastructure mirrors `src/core/source-manager/test-harness/`
 * — both live under `src/core/` because they're shared across adapter
 * modules.
 *
 * Socket errors during proxy toggling are deliberately swallowed:
 * the partner socket may close mid-pipe while the test toggles the
 * proxy, and unhandled-error events would crash the test runner.
 * The test asserts higher-level outcomes (delivery counts, health
 * transitions, pipeline survival), not socket-level cleanliness.
 *
 * @module test-utils/tcp-proxy
 */

import net from 'node:net';

/**
 * Start a TCP proxy on `listenPort` that forwards to `targetPort` on
 * 127.0.0.1. Returns the underlying `net.Server` once it's listening;
 * pass it to `stopProxy()` to tear down.
 *
 * **Why we track client sockets ourselves:** `net.Server` doesn't
 * expose `closeAllConnections()` (only `http.Server` does, since
 * Node 18.2). Without tracking, `server.close()` waits for client
 * sockets to close from their end, which never happens for clients
 * holding persistent connections (mqtt.js with keepalive). We track
 * incoming sockets in a Set and destroy them explicitly on
 * `stopProxy()` — that sends RST to the client so it sees the
 * disconnect immediately.
 *
 * @param {number} listenPort
 * @param {number} targetPort
 * @returns {Promise<net.Server>}
 */
export const startProxy = function ( listenPort, targetPort ) {
    const sockets = new Set();
    const server = net.createServer( function ( clientSocket ) {
        sockets.add( clientSocket );
        clientSocket.on( 'close', function () {
            sockets.delete( clientSocket );
        } );
        const targetSocket = net.connect( targetPort, '127.0.0.1', function () {
            clientSocket.pipe( targetSocket );
            targetSocket.pipe( clientSocket );
        } );
        // See file-header note on swallowed errors.
        clientSocket.on( 'error', function () {} );
        targetSocket.on( 'error', function () {} );
    } );
    // Attach the tracked-socket Set to the server object so
    // `stopProxy()` can find it. Underscore-prefixed since this is
    // a test-utility internal, not a public API.
    // eslint-disable-next-line no-underscore-dangle
    server._sockets = sockets;
    return new Promise( function ( resolve ) {
        server.listen( listenPort, '127.0.0.1', function () {
            resolve( server );
        } );
    } );
};

/**
 * Stop a proxy started via `startProxy()`. Force-destroys every
 * tracked client socket first (sending RST so clients see the
 * disconnect immediately, not at next keepalive timeout), then
 * waits for the server to close cleanly.
 *
 * Without this, persistent-connection clients (mqtt.js with
 * keepalive) keep their TCP socket alive indefinitely after the
 * proxy "closes". `server.close()` would never fire its callback,
 * and the client would never fire its disconnect events — the
 * connection appears intact even though the proxy is gone. The MQTT
 * emitter recovery tests surfaced this; the fix is to destroy from
 * our side.
 *
 * @param {net.Server} server
 * @returns {Promise<void>}
 */
export const stopProxy = function ( server ) {
    return new Promise( function ( resolve ) {
        // eslint-disable-next-line no-underscore-dangle
        const sockets = server._sockets || new Set();
        for ( const sock of sockets ) {
            sock.destroy();
        }
        sockets.clear();
        server.close( function () {
            resolve();
        } );
    } );
};

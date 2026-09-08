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
 * `startBlackHole()` models the other dead-endpoint shape: a server
 * that accepts the connection and never answers. The QuestDB exit test
 * uses it to hold a request on the wire while the process shuts down.
 *
 * `startHttpResponder()` models a service that is up but answers an
 * error. It forwards to the real service or answers a status code,
 * switched on the live server so no request is reset. The HTTP-error
 * hardening spec uses it.
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

import http from 'node:http';
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
        // The target side is tracked too. A destroyed client socket does
        // not end its pipe partner. Without this, the proxy's own sockets
        // to the service outlive `stopProxy()` and hold the process open.
        // The QuestDB exit test found that.
        sockets.add( targetSocket );
        targetSocket.on( 'close', function () {
            sockets.delete( targetSocket );
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
 * tracked socket first, both the client side and the proxy's own
 * side toward the service (sending RST so clients see the
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

/**
 * Start a black hole on `port`: a server that accepts every connection
 * and never answers. It reads and discards whatever the client sends,
 * so the client's write completes and the client then waits for a
 * response that never comes. That is the shape of an endpoint whose
 * process is alive but wedged. A closed port has a different shape:
 * it refuses at once.
 *
 * The hole has a second mode. After `forwardTo( targetPort )` every
 * new connection is relayed to that port, like `startProxy()`. After
 * `swallow()` the hole is back: new connections are swallowed, and a
 * connection that was being relayed goes quiet from that instant. Its
 * service side is dropped and its client side stays open, so a
 * request already on a kept-alive socket waits for an answer that
 * never comes. The switch happens on the live server, so the port
 * never closes and no request on the wire is reset. A port bounce
 * would reset one, and the client reports a reset as a socket error,
 * not as a hang.
 *
 * Returns the `net.Server` once it is listening, with `forwardTo()`
 * and `swallow()` attached; pass it to `stopProxy()` to tear down,
 * sockets included.
 *
 * @param {number} port
 * @returns {Promise<net.Server>}
 */
export const startBlackHole = function ( port ) {
    const sockets = new Set();
    // Client socket → service socket, for the connections being relayed.
    const relayed = new Map();
    let targetPort = null;

    const track = function ( socket ) {
        sockets.add( socket );
        socket.on( 'close', function () {
            sockets.delete( socket );
        } );
        // See file-header note on swallowed errors.
        socket.on( 'error', function () {} );
    };

    const relay = function ( clientSocket, servicePort ) {
        const targetSocket = net.connect( servicePort, '127.0.0.1', function () {
            clientSocket.pipe( targetSocket );
            targetSocket.pipe( clientSocket );
        } );
        track( targetSocket );
        relayed.set( clientSocket, targetSocket );
        clientSocket.on( 'close', function () {
            relayed.delete( clientSocket );
            targetSocket.destroy();
        } );
    };

    const server = net.createServer( function ( clientSocket ) {
        track( clientSocket );
        if ( targetPort === null ) {
            // Consume the request bytes so the client's write completes.
            clientSocket.resume();
            return;
        }
        relay( clientSocket, targetPort );
    } );
    server.forwardTo = function ( servicePort ) {
        targetPort = servicePort;
    };
    server.swallow = function () {
        targetPort = null;
        for ( const [ clientSocket, targetSocket ] of relayed ) {
            clientSocket.unpipe( targetSocket );
            targetSocket.unpipe( clientSocket );
            targetSocket.destroy();
            clientSocket.resume();
        }
        relayed.clear();
    };
    // eslint-disable-next-line no-underscore-dangle
    server._sockets = sockets;
    return new Promise( function ( resolve ) {
        server.listen( port, '127.0.0.1', function () {
            resolve( server );
        } );
    } );
};

/**
 * Start an HTTP responder on `port`. It has two modes, switched on the
 * live server, so the port never closes between them. In answer mode
 * it reads every request and answers it with `statusCode` and a short
 * plain-text body. That is the shape of a service that is up but
 * refuses the request, such as a 400 for a malformed row or a 500 for
 * an internal failure. In forward mode it relays each request to a
 * real service on `127.0.0.1:<upstreamPort>` and returns that
 * service's answer. Every answer closes the connection.
 *
 * Why a mode switch and not a port bounce: closing a server destroys
 * its sockets, so a request on the wire at that instant reads a reset
 * instead of an answer. A switch on a live server resets nothing. Each
 * request gets the mode that was active when it arrived.
 *
 * The QuestDB client treats some codes as retryable and the rest as
 * final; the HTTP-error hardening spec pins both against this
 * responder. Returns the server once it is listening, with two extra
 * methods: `answerWith( statusCode )` and `forwardTo( upstreamPort )`.
 * Pass the server to `stopProxy()` to tear down, sockets included.
 *
 * @param {number} port
 * @param {number} statusCode - answered until `forwardTo()` is called
 * @returns {Promise<http.Server>}
 */
export const startHttpResponder = function ( port, statusCode ) {
    const sockets = new Set();
    let mode = { answer: statusCode, forward: null };

    const answer = function ( req, res, code ) {
        req.resume();
        req.on( 'end', function () {
            res.writeHead( code, { 'Content-Type': 'text/plain', Connection: 'close' } );
            res.end( `responder answered ${code}` );
        } );
    };

    const forward = function ( req, res, upstreamPort ) {
        const headers = Object.assign( {}, req.headers );
        delete headers.connection;
        const upstream = http.request( {
            host: '127.0.0.1',
            port: upstreamPort,
            method: req.method,
            path: req.url,
            headers,
            agent: false
        }, function ( upstreamRes ) {
            res.writeHead( upstreamRes.statusCode, Object.assign( {}, upstreamRes.headers, { connection: 'close' } ) );
            upstreamRes.pipe( res );
        } );
        // See file-header note on swallowed errors.
        upstream.on( 'error', function () {
            res.destroy();
        } );
        req.pipe( upstream );
    };

    const server = http.createServer( function ( req, res ) {
        const current = mode;
        if ( current.forward === null ) {
            answer( req, res, current.answer );
            return;
        }
        forward( req, res, current.forward );
    } );
    server.answerWith = function ( code ) {
        mode = { answer: code, forward: null };
    };
    server.forwardTo = function ( upstreamPort ) {
        mode = { answer: null, forward: upstreamPort };
    };
    server.on( 'connection', function ( socket ) {
        sockets.add( socket );
        socket.on( 'close', function () {
            sockets.delete( socket );
        } );
        // See file-header note on swallowed errors.
        socket.on( 'error', function () {} );
    } );
    // eslint-disable-next-line no-underscore-dangle
    server._sockets = sockets;
    return new Promise( function ( resolve ) {
        server.listen( port, '127.0.0.1', function () {
            resolve( server );
        } );
    } );
};

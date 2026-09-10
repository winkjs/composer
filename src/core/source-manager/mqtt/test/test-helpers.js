// core/source-manager/mqtt/test/test-helpers.js

/**
 * @fileoverview Shared fixtures for the MQTT source unit specs.
 *
 * The per-concern spec files (init, lifecycle, message, dedup-client,
 * shutdown) all drive `createMQTTSourceClient` against a stubbed
 * mqtt.js client — no broker required. This module holds the one
 * fixture they all share. Split out of the original monolithic
 * client.specs.js.
 *
 * The mock models two library facts (mqtt.js 5.15.1). First, once an
 * `end()` call set `disconnecting` (`client.js:731-734`), every later
 * `end()` only invokes its callback. So a forced `end( true )` after a
 * hung graceful `end( false )` detaches nothing. The mock carries a
 * `stream` with `destroy()`, the call that does detach, and
 * `destroy()` fires the hung graceful callback the way the library's
 * `close` event would. Second, `connected` follows the connection
 * events: `connect` sets it, `offline` and `close` clear it.
 */

import sinon from 'sinon';

/**
 * Create mock MQTT client that captures event handlers.
 *
 * @param {Object} [options] - Mock options
 * @param {boolean} [options.hangOnEnd] - When true, the graceful
 *   (force=false) end call never completes on its own; only
 *   `stream.destroy()` completes it, as the library's `close` event
 *   would. A later `end( true )` is a no-op behind the latch.
 * @returns {Object} Mock client with handlers map
 */
export const createMockClient = function ( { hangOnEnd = false } = {} ) {
    const handlers = {};

    // The library's latch and the graceful callback it may leave hung.
    let disconnecting = false;
    let hungGracefulCb = null;

    const stream = {
        destroyed: false,
        destroy: sinon.stub().callsFake( function () {
            stream.destroyed = true;
            if ( hungGracefulCb ) {
                const cb = hungGracefulCb;
                hungGracefulCb = null;
                setImmediate( cb );
            }
        } )
    };

    const end = function ( force, opts, cb ) {
        if ( disconnecting ) {
            if ( cb ) {
                setImmediate( cb );
            }
            return;
        }
        disconnecting = true;
        if ( force ) {
            stream.destroyed = true;
            if ( cb ) {
                setImmediate( cb );
            }
            return;
        }
        if ( hangOnEnd ) {
            hungGracefulCb = cb || null;
            return;
        }
        stream.destroyed = true;
        if ( cb ) {
            setImmediate( cb );
        }
    }; // end()

    const client = {
        connected: false,
        stream,
        on: sinon.stub().callsFake( function ( event, handler ) {
            handlers[ event ] = handler;
        } ),
        subscribe: sinon.stub().callsFake( function ( topics, opts, cb ) {
            if ( cb ) {
                setImmediate( cb );
            }
        } ),
        end: sinon.stub().callsFake( end ),
        _handlers: handlers,
        // Helper to trigger events. `connected` follows the events the
        // way the library sets it. So a stop after `connect` takes the
        // graceful path, and a stop after `offline` the forced one.
        _emit: function ( event, ...args ) {
            if ( event === 'connect' ) {
                client.connected = true;
            } else if ( ( event === 'offline' ) || ( event === 'close' ) ) {
                client.connected = false;
            }
            if ( handlers[ event ] ) {
                handlers[ event ]( ...args );
            }
        }
    };

    return client;
};

/**
 * Create an injectable clock for deterministic time-rule tests.
 * Same pattern the dedup specs use: `nowFn` reads the current fake
 * time, `advance` moves it forward.
 *
 * @param {number} [start=1000000] - Initial fake timestamp (ms)
 * @returns {Object} { nowFn, advance }
 */
export const makeClock = function ( start = 1000000 ) {
    let t = start;

    return {
        nowFn: () => t,
        advance: ( ms ) => {
            t += ms;
        }
    };
};

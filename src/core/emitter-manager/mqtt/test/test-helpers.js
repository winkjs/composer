// core/emitter-manager/mqtt/test/test-helpers.js

/**
 * @fileoverview Shared fixtures for the MQTT emitter spec files.
 *
 * The simple mock mqtt.js client: publishes succeed on the next tick,
 * `end` completes (or hangs on request), and every registered event
 * handler is captured so tests can fire connection events themselves.
 * The rich client-store contract fake stays in shutdown-drain.specs.js —
 * it models ack timing and store callbacks that only those tests need.
 *
 * `end` models one library fact (mqtt.js 5.15.1, `client.js:731-734`):
 * once an `end()` call set `disconnecting`, every later `end()` only
 * invokes its callback and does nothing else. So a forced `end( true )`
 * after a hung graceful `end( false )` cannot detach anything. The mock
 * carries a `stream` with `destroy()`, the call that does detach, and
 * `destroy()` fires the hung graceful callback the way the library's
 * `close` event would.
 */

import sinon from 'sinon';

/**
 * Builds a mock mqtt.js client plus the capture arrays tests assert on.
 *
 * @param {Object} [options] - Mock options
 * @param {boolean} [options.hangOnEnd] - When true, the graceful
 *   (force=false) end call never completes on its own; only
 *   `stream.destroy()` completes it, as the library's `close` event
 *   would. A later `end( true )` is a no-op behind the latch.
 * @param {boolean} [options.manualAcks] - When true, publish callbacks
 *   are NOT auto-invoked; each entry in `publishCalls` carries its `cb`
 *   so the test acknowledges (or fails) messages deliberately. This is
 *   how the unacked-accounting specs hold messages "in flight".
 * @returns {Object} `{ client, stream, eventHandlers, onceHandlers, publishCalls, endCalls }`
 */
const makeMockClient = function ( { hangOnEnd = false, manualAcks = false } = {} ) {
    const eventHandlers = {};
    // One-shot handlers registered via `once` (the factory's
    // first-connack grace uses one). Kept apart from the permanent
    // handlers so tests can assert cleanup — after a grace expiry the
    // factory must have removed its listener from here.
    const onceHandlers = {};
    const publishCalls = [];
    const endCalls = [];

    // The library's latch and the graceful callback it may leave hung.
    let disconnecting = false;
    let hungGracefulCb = null;

    const stream = {
        destroyed: false,
        destroy: sinon.stub().callsFake( () => {
            stream.destroyed = true;
            if ( hungGracefulCb ) {
                const cb = hungGracefulCb;
                hungGracefulCb = null;
                setImmediate( cb );
            }
        } )
    };

    const end = function ( force, opts, callback ) {
        const cb = typeof opts === 'function' ? opts : callback;
        endCalls.push( { force, hadCb: typeof cb === 'function' } );
        if ( disconnecting ) {
            if ( cb ) setImmediate( cb );
            return;
        }
        disconnecting = true;
        if ( force ) {
            stream.destroyed = true;
            if ( cb ) setImmediate( cb );
            return;
        }
        if ( hangOnEnd ) {
            hungGracefulCb = cb || null;
            return;
        }
        stream.destroyed = true;
        if ( cb ) setImmediate( cb );
    }; // end()

    const client = {
        stream,
        publish: sinon.stub().callsFake( ( topic, payload, opts, cb ) => {
            // Copied at once, as mqtt.js copies its options before any
            // other work: the emitter reuses one options object, and
            // each captured call must keep the properties of its own
            // publish.
            publishCalls.push( { topic, payload, opts: { ...opts }, cb } );
            if ( manualAcks ) return;
            if ( cb ) setImmediate( cb );
        } ),
        end: sinon.stub().callsFake( end ),
        on: sinon.stub().callsFake( ( event, handler ) => {
            eventHandlers[ event ] = handler;
        } ),
        once: sinon.stub().callsFake( ( event, handler ) => {
            if ( !onceHandlers[ event ] ) onceHandlers[ event ] = [];
            onceHandlers[ event ].push( handler );
        } ),
        removeListener: sinon.stub().callsFake( ( event, handler ) => {
            const list = onceHandlers[ event ];
            if ( !list ) return;
            const idx = list.indexOf( handler );
            if ( idx !== -1 ) list.splice( idx, 1 );
        } )
    };

    return { client, stream, eventHandlers, onceHandlers, publishCalls, endCalls };
}; // makeMockClient()

/**
 * Fires the captured connect handlers, when the client registered any.
 * The permanent `on` handler fires first, then the one-shot `once`
 * handlers drain — the same order mqtt.js would fire them, because the
 * emitter attaches its permanent state handler before the grace wait's
 * one-shot. The second parameter is optional so callers that predate
 * the grace wait keep working unchanged.
 *
 * @param {Object} eventHandlers - Captured handlers from makeMockClient
 * @param {Object} [onceHandlers] - Captured one-shot handlers
 */
const fireConnect = function ( eventHandlers, onceHandlers ) {
    if ( eventHandlers.connect ) eventHandlers.connect();
    if ( onceHandlers && onceHandlers.connect ) {
        onceHandlers.connect.splice( 0 ).forEach( ( h ) => h() );
    }
}; // fireConnect()

/** Lets pending setImmediate callbacks (mock publish acks) run. */
const waitForCallbacks = function () {
    return new Promise( ( resolve ) => setImmediate( resolve ) );
}; // waitForCallbacks()

/**
 * Awaits a factory call and returns the error it rejected with, or
 * null. The factory is async, so a configuration refusal arrives as a
 * rejection, the same way QuestDB's does.
 *
 * @param {Promise} pending - The factory's returned promise
 * @returns {Promise<Error|null>} the refusal, or null when it resolved
 */
const refusalOf = async function ( pending ) {
    try {
        await pending;
        return null;
    } catch ( err ) {
        return err;
    }
}; // refusalOf()

/**
 * The standard test codec. JSON.stringify also gives the encode-failure
 * tests a real thrower: it throws on circular references, exactly the
 * failure `publishNow` must refuse without corrupting the counter.
 */
const testCodec = {
    pack: ( msg ) => Buffer.from( JSON.stringify( msg ) ),
    contentType: 'application/json'
};

export { makeMockClient, fireConnect, waitForCallbacks, refusalOf, testCodec };

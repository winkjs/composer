// core/emitter-manager/mqtt/test/test-helpers.js

/**
 * @fileoverview Shared fixtures for the MQTT emitter spec files.
 *
 * The simple mock mqtt.js client: publishes succeed on the next tick,
 * `end` completes (or hangs on request), and every registered event
 * handler is captured so tests can fire connection events themselves.
 * The rich client-store contract fake stays in shutdown-drain.specs.js —
 * it models ack timing and store callbacks that only those tests need.
 */

import sinon from 'sinon';

/**
 * Builds a mock mqtt.js client plus the capture arrays tests assert on.
 *
 * @param {Object} [options] - Mock options
 * @param {boolean} [options.hangOnEnd] - When true, the graceful
 *   (force=false) end call never completes; the force=true call always
 *   does, so timeout paths can finish.
 * @param {boolean} [options.manualAcks] - When true, publish callbacks
 *   are NOT auto-invoked; each entry in `publishCalls` carries its `cb`
 *   so the test acknowledges (or fails) messages deliberately. This is
 *   how the unacked-accounting specs hold messages "in flight".
 * @returns {Object} `{ client, eventHandlers, onceHandlers, publishCalls, endCalls }`
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

    const client = {
        publish: sinon.stub().callsFake( ( topic, payload, opts, cb ) => {
            publishCalls.push( { topic, payload, opts, cb } );
            if ( manualAcks ) return;
            if ( cb ) setImmediate( cb );
        } ),
        end: sinon.stub().callsFake( ( force, opts, callback ) => {
            const cb = typeof opts === 'function' ? opts : callback;
            endCalls.push( { force, hadCb: typeof cb === 'function' } );
            // hangOnEnd: only the graceful (force=false) call is suspended;
            // the timeout-driven force=true call always completes so the
            // test can finish.
            if ( hangOnEnd && force === false ) return;
            if ( cb ) setImmediate( cb );
        } ),
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

    return { client, eventHandlers, onceHandlers, publishCalls, endCalls };
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
 * The standard test codec. JSON.stringify also gives the encode-failure
 * tests a real thrower: it throws on circular references, exactly the
 * failure `publishNow` must refuse without corrupting the counter.
 */
const testCodec = {
    pack: ( msg ) => Buffer.from( JSON.stringify( msg ) ),
    contentType: 'application/json'
};

export { makeMockClient, fireConnect, waitForCallbacks, testCodec };

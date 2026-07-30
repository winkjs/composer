// core/source-manager/mqtt/test/test-helpers.js

/**
 * @fileoverview Shared fixtures for the MQTT source unit specs.
 *
 * The per-concern spec files (init, lifecycle, message, dedup-client,
 * shutdown) all drive `createMQTTSourceClient` against a stubbed
 * mqtt.js client — no broker required. This module holds the one
 * fixture they all share. Split out of the original monolithic
 * client.specs.js.
 */

import sinon from 'sinon';

/**
 * Create mock MQTT client that captures event handlers.
 *
 * @returns {Object} Mock client with handlers map
 */
export const createMockClient = function () {
    const handlers = {};

    return {
        on: sinon.stub().callsFake( function ( event, handler ) {
            handlers[ event ] = handler;
        } ),
        subscribe: sinon.stub().callsFake( function ( topics, opts, cb ) {
            if ( cb ) {
                setImmediate( cb );
            }
        } ),
        end: sinon.stub().callsFake( function ( force, opts, cb ) {
            if ( cb ) {
                setImmediate( cb );
            }
        } ),
        _handlers: handlers,
        // Helper to trigger events
        _emit: function ( event, ...args ) {
            if ( handlers[ event ] ) {
                handlers[ event ]( ...args );
            }
        }
    };
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

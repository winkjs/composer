// core/source-manager/mqtt/test/client-identity.specs.js

/* eslint-disable no-empty-function */

/**
 * @fileoverview MQTT source — the client-identity advisory at startup.
 *
 * A persistent session is filed at the broker under the client's
 * name; an auto-generated name changes on every start, which quietly
 * orphans the saved backlog. The source therefore warns once at
 * startup when no clientId is configured while the session is
 * persistent — and stays silent when the operator has either pinned
 * the name or chosen a clean session.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createMQTTSourceClient } from '../client.js';
import { createMockClient } from './test-helpers.js';

// The stable substring the tests filter on, so an unrelated
// console.warn from elsewhere can never satisfy an assertion.
const WARNING_MARK = 'no clientId configured';

describe( 'MQTT Source — client identity advisory', function () {

    let mockClient;
    let mockConnect;
    let warnStub;
    let stopFns;

    const identityWarnings = function () {
        return warnStub.getCalls().filter(
            ( call ) => String( call.args[ 0 ] ).includes( WARNING_MARK )
        );
    }; // identityWarnings()

    const startClient = function ( overrides = {} ) {
        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            mqttConnectFn: mockConnect,
            ...overrides
        } );
        stopFns.push( stop );
        return stop;
    }; // startClient()

    beforeEach( function () {
        mockClient = createMockClient();
        mockConnect = sinon.stub().returns( mockClient );
        warnStub = sinon.stub( console, 'warn' );
        stopFns = [];
    } );

    afterEach( async function () {
        await Promise.all( stopFns.map(
            ( stop ) => Promise.resolve( stop( { timeout: 500 } ) ).catch( () => undefined )
        ) );
        sinon.restore();
    } );

    it( 'warns exactly once when clientId is omitted and the session is persistent', function () {
        startClient();
        expect( identityWarnings().length ).to.equal( 1 );
    } );

    it( 'names the config key, the consequence, and the fix', function () {
        startClient();
        const text = String( identityWarnings()[ 0 ].args[ 0 ] );
        expect( text.includes( 'clientId' ) ).to.equal( true );
        expect( text.includes( 'never delivered' ) ).to.equal( true );
        expect( text.includes( 'unique on your broker' ) ).to.equal( true );
    } );

    it( 'stays silent when a clientId is configured', function () {
        startClient( { clientId: 'paintshop-line1' } );
        expect( identityWarnings().length ).to.equal( 0 );
    } );

    it( 'stays silent when the session is deliberately clean', function () {
        startClient( { cleanStart: true } );
        expect( identityWarnings().length ).to.equal( 0 );
    } );

    it( 'still warns when cleanStart is explicitly false without a clientId', function () {
        startClient( { cleanStart: false } );
        expect( identityWarnings().length ).to.equal( 1 );
    } );
} );

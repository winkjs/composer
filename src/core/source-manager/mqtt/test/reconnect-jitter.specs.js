// core/source-manager/mqtt/test/reconnect-jitter.specs.js

/**
 * @fileoverview MQTT source — the reconnect period carries jitter.
 *
 * The same rule as the emitter: the client gets the configured period
 * plus a random share of up to 20%, chosen once at setup, so a fleet
 * that lost one broker does not retry in step. The configured period
 * is the floor. The shared helper has its own specs; these pin the
 * wiring through `mqttConnectFn`.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createMQTTSourceClient } from '../client.js';
import { ENV_VARS } from '../../../env-vars.js';
import { createMockClient } from './test-helpers.js';

describe( 'MQTT source — reconnect jitter', function () {

    const BASE = ENV_VARS.mqttReconnectMs;

    /**
     * Builds one source client over a fresh mock and returns the
     * options it handed to the connect function.
     *
     * @returns {Object} the connect options
     */
    const connectOptionsOf = function () {
        const mockConnect = sinon.stub().returns( createMockClient() );
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://127.0.0.1',
            topics: 'test/topic',
            clientId: 'jitter-spec',
            onMessage: () => undefined,
            mqttConnectFn: mockConnect
        } );
        return mockConnect.firstCall.args[ 1 ];
    }; // connectOptionsOf()

    beforeEach( function () {
        sinon.stub( console, 'warn' );
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'hands the client a reconnectPeriod between the configured period and 120% of it', function () {
        const options = connectOptionsOf();
        expect( options.reconnectPeriod ).to.be.at.least( BASE );
        expect( options.reconnectPeriod ).to.be.at.most( BASE + Math.floor( BASE * 0.2 ) );
        expect( Number.isInteger( options.reconnectPeriod ) ).to.equal( true );
    } );

    it( 'never shortens the configured period: a zero draw hands the client the period itself', function () {
        sinon.stub( Math, 'random' ).returns( 0 );
        expect( connectOptionsOf().reconnectPeriod ).to.equal( BASE );
    } );

    it( 'two sources with different draws retry at different periods', function () {
        const random = sinon.stub( Math, 'random' );
        random.returns( 0.25 );
        const first = connectOptionsOf();
        random.returns( 0.75 );
        const second = connectOptionsOf();

        expect( first.reconnectPeriod ).to.equal( BASE + Math.floor( BASE * 0.2 * 0.25 ) );
        expect( second.reconnectPeriod ).to.equal( BASE + Math.floor( BASE * 0.2 * 0.75 ) );
        expect( first.reconnectPeriod ).to.not.equal( second.reconnectPeriod );
    } );

} );

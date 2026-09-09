// core/emitter-manager/mqtt/test/reconnect-jitter.specs.js

/**
 * @fileoverview MQTT emitter — the reconnect period carries jitter.
 *
 * mqtt.js retries at a fixed period. A fleet of edge devices that
 * lost the same broker would then retry in step, and every attempt
 * would land on the recovering broker at the same instant. The
 * emitter hands the client a period chosen once at setup: the
 * configured period plus a random share of up to 20%. The configured
 * period is the floor; it is never shortened.
 *
 * The shared helper has its own specs. These pin the wiring: the
 * options handed to `mqttConnectFn` carry the jittered value.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createEmitter } from '../emitter.js';
import { ENV_VARS } from '../../../env-vars.js';
import { makeMockClient, testCodec } from './test-helpers.js';

describe( 'mqtt emitter — reconnect jitter', function () {

    const BASE = ENV_VARS.mqttReconnectMs;
    const emitters = [];

    /**
     * Builds one emitter over a fresh mock and returns the options
     * the factory handed to the connect function.
     *
     * @returns {Promise<Object>} the connect options
     */
    const connectOptionsOf = async function () {
        const mock = makeMockClient();
        const mockConnect = sinon.stub().returns( mock.client );
        emitters.push( await createEmitter( {
            brokerUrl: 'mqtt://127.0.0.1',
            connectGraceMs: 0,
            codec: testCodec,
            mqttConnectFn: mockConnect
        } ) );
        return mockConnect.firstCall.args[ 1 ];
    }; // connectOptionsOf()

    beforeEach( function () {
        emitters.length = 0;
    } );

    afterEach( async function () {
        await Promise.all( emitters.map( ( e ) => e.shutdown() ) );
        sinon.restore();
    } );

    it( 'hands the client a reconnectPeriod between the configured period and 120% of it', async function () {
        const options = await connectOptionsOf();
        expect( options.reconnectPeriod ).to.be.at.least( BASE );
        expect( options.reconnectPeriod ).to.be.at.most( BASE + Math.floor( BASE * 0.2 ) );
        expect( Number.isInteger( options.reconnectPeriod ) ).to.equal( true );
    } );

    it( 'never shortens the configured period: a zero draw hands the client the period itself', async function () {
        sinon.stub( Math, 'random' ).returns( 0 );
        const options = await connectOptionsOf();
        expect( options.reconnectPeriod ).to.equal( BASE );
    } );

    it( 'two emitters with different draws retry at different periods', async function () {
        const random = sinon.stub( Math, 'random' );
        random.returns( 0.25 );
        const first = await connectOptionsOf();
        random.returns( 0.75 );
        const second = await connectOptionsOf();

        expect( first.reconnectPeriod ).to.equal( BASE + Math.floor( BASE * 0.2 * 0.25 ) );
        expect( second.reconnectPeriod ).to.equal( BASE + Math.floor( BASE * 0.2 * 0.75 ) );
        expect( first.reconnectPeriod ).to.not.equal( second.reconnectPeriod );
    } );

} );

// core/emitter-manager/mqtt/test/address-refusal.specs.js

/**
 * @fileoverview The MQTT emitter's address policy (ADR-030).
 *
 * `localhost` is a name that can resolve to two addresses, and the
 * broker may listen on only one. The emitter refuses it at wire time,
 * before the client is created, at two layers that share one check:
 * the `configSchema` validator (fails at flow definition) and the
 * factory body (covers the `MQTT_BROKER_URL` fallback and direct
 * callers, and carries `err.code`). Any other name gets one warning
 * with the console token `ADDRESS_IS_NAME`. A bracketed IPv6 literal
 * is accepted. The emitter keeps its recovering posture: it refuses
 * and warns, it does not probe.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import mqttEmitterAdapter, { configSchema } from '../index.js';
import { createEmitter } from '../emitter.js';
import { ENV_VARS } from '../../../env-vars.js';
import { validateWithSchema } from '../../../utils/validate/index.js';
import { flow } from '../../../../flow/flow.js';
import { makeMockClient, testCodec } from './test-helpers.js';

const WARNING_MARK = '[ADDRESS_IS_NAME]';

const validate = function ( config ) {
    return validateWithSchema( configSchema, { codec: testCodec, ...config }, 'config' );
};

/** Runs a factory call and returns its throw or rejection, failing when none comes. */
const failure = async function ( fn ) {
    try {
        await fn();
    } catch ( err ) {
        return err;
    }
    return expect.fail( 'expected a throw' );
};

describe( 'MQTT emitter address policy — configSchema layer', function () {

    it( 'refuses localhost at flow definition, naming the literal to use', function () {
        const result = validate( { brokerUrl: 'mqtt://localhost:1883' } );
        expect( result.valid ).to.equal( false );
        expect( result.errors ).to.have.lengthOf( 1 );
        expect( result.errors[ 0 ] ).to.include( 'brokerUrl' );
        expect( result.errors[ 0 ] ).to.include( 'never localhost' );
        expect( result.errors[ 0 ] ).to.include( 'mqtt://127.0.0.1:1883' );
    } );

    it( 'refuses localhost in any letter case, without a port, and under the reserved domain', function () {
        expect( validate( { brokerUrl: 'mqtts://LOCALHOST' } ).valid ).to.equal( false );
        expect( validate( { brokerUrl: 'mqtt://broker.localhost.:1883' } ).valid ).to.equal( false );
    } );

    it( 'still refuses an empty string', function () {
        expect( validate( { brokerUrl: '' } ).valid ).to.equal( false );
    } );

    it( 'accepts a bracketed IPv6 literal', function () {
        expect( validate( { brokerUrl: 'mqtt://[::1]:1883' } ).valid ).to.equal( true );
    } );

    it( 'accepts a name other than localhost (the factory warns, the schema does not)', function () {
        expect( validate( { brokerUrl: 'mqtt://broker.plant.local:1883' } ).valid ).to.equal( true );
    } );

    it( 'accepts a value it cannot parse, leaving that error to the MQTT library', function () {
        expect( validate( { brokerUrl: 'not a url' } ).valid ).to.equal( true );
    } );

    it( 'accepts an omitted brokerUrl (the factory then reads MQTT_BROKER_URL)', function () {
        expect( validate( {} ).valid ).to.equal( true );
    } );

    it( 'flow.emitter() throws on localhost before the flow is built', function () {
        expect( () => flow( 'mqtt-emitter-localhost-refused' ).emitter( mqttEmitterAdapter, {
            brokerUrl: 'mqtt://localhost:1883',
            codec: testCodec
        } ) ).to.throw( /never localhost/ );
    } );

} );

describe( 'MQTT emitter address policy — factory layer', function () {

    let mockConnect;
    let warnStub;
    let emitter;

    const nameWarnings = function () {
        return warnStub.getCalls().filter(
            ( call ) => String( call.args[ 0 ] ).includes( WARNING_MARK )
        );
    }; // nameWarnings()

    const make = function ( config ) {
        return createEmitter( {
            codec: testCodec,
            clientId: 'addr-test',
            connectGraceMs: 0,
            mqttConnectFn: mockConnect,
            ...config
        } );
    }; // make()

    beforeEach( function () {
        mockConnect = sinon.stub().returns( makeMockClient().client );
        warnStub = sinon.stub( console, 'warn' );
        emitter = null;
    } );

    afterEach( async function () {
        if ( emitter ) {
            await Promise.resolve( emitter.shutdown() ).catch( () => undefined );
            emitter = null;
        }
        sinon.restore();
    } );

    it( 'refuses localhost with INVALID_CONFIG, naming the literal and MQTT_BROKER_URL', async function () {
        const err = await failure( () => make( { brokerUrl: 'mqtt://localhost:1883' } ) );
        expect( err.code ).to.equal( 'INVALID_CONFIG' );
        expect( err.message ).to.equal(
            'winkComposer/mqttEmitter: brokerUrl \'mqtt://localhost:1883\' is refused [INVALID_CONFIG]: ' +
            '\'localhost\' can resolve to more than one address, and the service may answer on only one; ' +
            'set brokerUrl to mqtt://127.0.0.1:1883 (or MQTT_BROKER_URL=mqtt://127.0.0.1:1883)'
        );
        expect( mockConnect.called ).to.equal( false );
    } );

    it( 'covers the environment fallback: a localhost value arriving from ENV_VARS is refused too', async function () {
        sinon.stub( ENV_VARS, 'mqttBrokerUrl' ).value( 'mqtt://localhost:1883' );
        const err = await failure( () => make( {} ) );
        expect( err.code ).to.equal( 'INVALID_CONFIG' );
        expect( err.message ).to.include( 'MQTT_BROKER_URL=mqtt://127.0.0.1:1883' );
        expect( mockConnect.called ).to.equal( false );
    } );

    it( 'never prints broker credentials in the refusal', async function () {
        const err = await failure( () => make( { brokerUrl: 'mqtts://user:pw-secret@localhost:8883' } ) );
        expect( err.message ).to.include( 'brokerUrl \'mqtts://***@localhost:8883\' is refused' );
        expect( err.message ).to.include( 'set brokerUrl to mqtts://127.0.0.1:8883' );
        expect( err.message ).to.not.include( 'pw-secret' );
    } );

    it( 'warns once, before the client is created, when the host is a name', async function () {
        emitter = await make( { brokerUrl: 'mqtt://broker.plant.local:1883' } );
        const warnings = nameWarnings();
        expect( warnings ).to.have.lengthOf( 1 );
        expect( warnings[ 0 ].args[ 0 ] ).to.equal(
            'winkComposer/mqttEmitter: brokerUrl host \'broker.plant.local\' is a name, not an address ' +
            '[ADDRESS_IS_NAME]: a name can resolve to more than one address, and the service may answer ' +
            'on only one; prefer the literal address'
        );
        expect( warnings[ 0 ].calledBefore( mockConnect.firstCall ) ).to.equal( true );
    } );

    it( 'does not warn for an IP literal', async function () {
        emitter = await make( { brokerUrl: 'mqtt://127.0.0.1:1883' } );
        expect( nameWarnings() ).to.have.lengthOf( 0 );
        expect( mockConnect.calledOnce ).to.equal( true );
    } );

    it( 'accepts a bracketed IPv6 literal and hands it to the client unchanged', async function () {
        emitter = await make( { brokerUrl: 'mqtt://[::1]:1883' } );
        expect( nameWarnings() ).to.have.lengthOf( 0 );
        expect( mockConnect.firstCall.args[ 0 ] ).to.equal( 'mqtt://[::1]:1883' );
    } );

    it( 'neither refuses nor warns for a value it cannot parse; the MQTT library owns that error', async function () {
        emitter = await make( { brokerUrl: 'not a url' } );
        expect( nameWarnings() ).to.have.lengthOf( 0 );
        expect( mockConnect.firstCall.args[ 0 ] ).to.equal( 'not a url' );
    } );

} );

// core/source-manager/mqtt/test/address-refusal.specs.js

/**
 * @fileoverview The MQTT source's address policy (ADR-030).
 *
 * `localhost` is a name that can resolve to two addresses, and the
 * broker may listen on only one. The source refuses it at wire time,
 * before the client is created, at two layers that share one check:
 * the `configSchema` validator (fails at flow definition) and the
 * factory body (covers direct callers and carries `err.code`). Any
 * other name gets one warning with the console token
 * `ADDRESS_IS_NAME`. A bracketed IPv6 literal is accepted. The source
 * keeps its recovering posture: it refuses and warns, it does not
 * probe.
 *
 * The source has no environment fallback for `brokerUrl` (the schema
 * marks it required), so the refusal names no env var.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import mqttSource, { configSchema } from '../index.js';
import { createMQTTSourceClient } from '../client.js';
import { validateWithSchema } from '../../../utils/validate/index.js';
import { flow } from '../../../../flow/flow.js';
import { createMockClient } from './test-helpers.js';

const WARNING_MARK = '[ADDRESS_IS_NAME]';

const validate = function ( config ) {
    return validateWithSchema( configSchema, config, 'source' );
};

describe( 'MQTT source address policy — configSchema layer', function () {

    it( 'refuses localhost at flow definition, naming the literal to use', function () {
        const result = validate( { brokerUrl: 'mqtt://localhost:1883', topics: 't' } );
        expect( result.valid ).to.equal( false );
        expect( result.errors ).to.have.lengthOf( 1 );
        expect( result.errors[ 0 ] ).to.include( 'brokerUrl' );
        expect( result.errors[ 0 ] ).to.include( 'never localhost' );
        expect( result.errors[ 0 ] ).to.include( 'mqtt://127.0.0.1:1883' );
    } );

    it( 'refuses localhost in any letter case, without a port, and under the reserved domain', function () {
        expect( validate( { brokerUrl: 'mqtts://LOCALHOST', topics: 't' } ).valid ).to.equal( false );
        expect( validate( { brokerUrl: 'mqtt://broker.localhost.:1883', topics: 't' } ).valid ).to.equal( false );
    } );

    it( 'still refuses an empty string', function () {
        expect( validate( { brokerUrl: '', topics: 't' } ).valid ).to.equal( false );
    } );

    it( 'accepts a bracketed IPv6 literal', function () {
        expect( validate( { brokerUrl: 'mqtt://[::1]:1883', topics: 't' } ).valid ).to.equal( true );
    } );

    it( 'accepts a name other than localhost (the factory warns, the schema does not)', function () {
        expect( validate( { brokerUrl: 'mqtt://broker.plant.local:1883', topics: 't' } ).valid ).to.equal( true );
    } );

    it( 'accepts a value it cannot parse, leaving that error to the MQTT library', function () {
        expect( validate( { brokerUrl: 'not a url', topics: 't' } ).valid ).to.equal( true );
    } );

    it( 'flow.source() throws on localhost before the flow is built', function () {
        expect( () => flow( 'mqtt-source-localhost-refused' ).source( mqttSource, {
            brokerUrl: 'mqtt://localhost:1883',
            topics: 'edge/+/enriched'
        } ) ).to.throw( /never localhost/ );
    } );

} );

describe( 'MQTT source address policy — factory layer', function () {

    let mockClient;
    let mockConnect;
    let warnStub;
    let stopFns;

    const nameWarnings = function () {
        return warnStub.getCalls().filter(
            ( call ) => String( call.args[ 0 ] ).includes( WARNING_MARK )
        );
    }; // nameWarnings()

    const startClient = function ( brokerUrl ) {
        const stop = createMQTTSourceClient( {
            brokerUrl,
            topics: 'test/topic',
            onMessage: () => undefined,
            clientId: 'addr-test',
            mqttConnectFn: mockConnect
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

    it( 'refuses localhost with INVALID_CONFIG before the client is created', function () {
        let caught;
        try {
            startClient( 'mqtt://localhost:1883' );
        } catch ( err ) {
            caught = err;
        }
        expect( caught.code ).to.equal( 'INVALID_CONFIG' );
        expect( caught.message ).to.equal(
            'winkComposer/mqttSource: brokerUrl \'mqtt://localhost:1883\' is refused [INVALID_CONFIG]: ' +
            '\'localhost\' can resolve to more than one address, and the service may answer on only one; ' +
            'set brokerUrl to mqtt://127.0.0.1:1883'
        );
        expect( mockConnect.called ).to.equal( false );
    } );

    it( 'never prints broker credentials in the refusal', function () {
        let caught;
        try {
            startClient( 'mqtts://user:pw-secret@localhost:8883' );
        } catch ( err ) {
            caught = err;
        }
        expect( caught.code ).to.equal( 'INVALID_CONFIG' );
        expect( caught.message ).to.include( 'brokerUrl \'mqtts://***@localhost:8883\' is refused' );
        expect( caught.message ).to.include( 'set brokerUrl to mqtts://127.0.0.1:8883' );
        expect( caught.message ).to.not.include( 'pw-secret' );
    } );

    it( 'warns once, before the client is created, when the host is a name', function () {
        startClient( 'mqtt://broker.plant.local:1883' );
        const warnings = nameWarnings();
        expect( warnings ).to.have.lengthOf( 1 );
        expect( warnings[ 0 ].args[ 0 ] ).to.equal(
            'winkComposer/mqttSource: brokerUrl host \'broker.plant.local\' is a name, not an address ' +
            '[ADDRESS_IS_NAME]: a name can resolve to more than one address, and the service may answer ' +
            'on only one; prefer the literal address'
        );
        expect( warnings[ 0 ].calledBefore( mockConnect.firstCall ) ).to.equal( true );
    } );

    it( 'does not warn for an IP literal', function () {
        startClient( 'mqtt://127.0.0.1:1883' );
        expect( nameWarnings() ).to.have.lengthOf( 0 );
        expect( mockConnect.calledOnce ).to.equal( true );
    } );

    it( 'accepts a bracketed IPv6 literal and hands it to the client unchanged', function () {
        startClient( 'mqtt://[::1]:1883' );
        expect( nameWarnings() ).to.have.lengthOf( 0 );
        expect( mockConnect.firstCall.args[ 0 ] ).to.equal( 'mqtt://[::1]:1883' );
    } );

    it( 'neither refuses nor warns for a value it cannot parse; the MQTT library owns that error', function () {
        startClient( 'not a url' );
        expect( nameWarnings() ).to.have.lengthOf( 0 );
        expect( mockConnect.firstCall.args[ 0 ] ).to.equal( 'not a url' );
    } );

} );

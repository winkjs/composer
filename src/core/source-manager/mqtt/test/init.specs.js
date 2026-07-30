// core/source-manager/mqtt/test/init.specs.js

/* eslint-disable no-underscore-dangle, no-empty-function */

/**
 * @fileoverview MQTT source — construction and config validation.
 *
 * Covers required-field throws (classified INVALID_CONFIG per
 * ADR-018), clientId defaulting, cleanStart pass-through, and
 * topic normalization. Split from the original client.specs.js;
 * assertions unchanged. Uses sinon stubs to mock mqtt.connect — no
 * broker required.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createMQTTSourceClient } from '../client.js';
import { createMockClient } from './test-helpers.js';
import mqttSource from '../index.js';

describe( 'MQTT Source — createMQTTSourceClient Configuration', function () {

    let mockClient;
    let mockConnect;

    beforeEach( function () {
        mockClient = createMockClient();
        mockConnect = sinon.stub().returns( mockClient );
    } );

    afterEach( function () {
        sinon.restore();
    } );

    it( 'throws if brokerUrl is missing', function () {
        expect( () => createMQTTSourceClient( {
            topics: 'test/topic',
            onMessage: () => {}
        } ) ).to.throw( 'brokerUrl is required' );
    } );

    it( 'throws if topics is missing', function () {
        expect( () => createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            onMessage: () => {}
        } ) ).to.throw( 'topics is required' );
    } );

    it( 'throws if topics is empty array', function () {
        expect( () => createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: [],
            onMessage: () => {}
        } ) ).to.throw( 'topics is required' );
    } );

    it( 'throws if onMessage is missing', function () {
        expect( () => createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic'
        } ) ).to.throw( 'onMessage must be a function' );
    } );

    it( 'throws if onMessage is not a function', function () {
        expect( () => createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: 'not-a-function'
        } ) ).to.throw( 'onMessage must be a function' );
    } );

    it( 'thrown setup errors carry err.code = INVALID_CONFIG (ADR-018)', function () {
        // One representative scenario per throw site — verifies the code
        // is set on each of the three setup-time validation paths.
        const cases = [
            { config: { topics: 't', onMessage: () => { /* no-op */ } }, what: 'missing brokerUrl' },
            { config: { brokerUrl: 'mqtt://x', onMessage: () => { /* no-op */ } }, what: 'missing topics' },
            { config: { brokerUrl: 'mqtt://x', topics: 't' }, what: 'missing onMessage' }
        ];

        for ( const { config, what } of cases ) {
            let thrown;
            try {
                createMQTTSourceClient( config );
            } catch ( err ) {
                thrown = err;
            }
            expect( thrown, `case: ${what}` ).to.be.an( 'error' );
            expect( thrown.code, `case: ${what}` ).to.equal( 'INVALID_CONFIG' );
        }
    } );

    it( 'creates client with valid config', function () {
        const stop = createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        expect( stop ).to.be.a( 'function' );
        expect( mockConnect.calledOnce ).to.equal( true );
    } );

    it( 'defaults to a persistent session — mqtt.js\'s \'clean\' option is false', function () {
        // mqtt.js reads `options.clean` (its name for the MQTT 5 Clean
        // Start flag). Before 2026-07-09 the source set `cleanStart`,
        // which the library silently ignored — every connection ran
        // with the library default clean=true and NO session survived
        // a reconnect. Caught by the ADR-022 dedup soak's chaos test.
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        expect( mockConnect.calledOnce ).to.equal( true );
        const passedOptions = mockConnect.firstCall.args[ 1 ];
        expect( passedOptions.clean ).to.equal( false );
        // The ignored spelling must not linger in the options.
        expect( 'cleanStart' in passedOptions ).to.equal( false );
    } );

    it( 'maps the cleanStart config key onto mqtt.js\'s \'clean\' when supplied', function () {
        // The user-facing key keeps the MQTT 5 term (cleanStart); the
        // client maps it to the option name the library reads.
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            cleanStart: true,
            mqttConnectFn: mockConnect
        } );

        expect( mockConnect.calledOnce ).to.equal( true );
        const passedOptions = mockConnect.firstCall.args[ 1 ];
        expect( passedOptions.clean ).to.equal( true );
        expect( 'cleanStart' in passedOptions ).to.equal( false );
    } );

    it( 'generates clientId if not provided', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        const opts = mockConnect.firstCall.args[ 1 ];
        expect( opts.clientId ).to.match( /^wink-source-\d+$/ );
    } );

    it( 'uses provided clientId', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'test/topic',
            clientId: 'my-custom-source',
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        const opts = mockConnect.firstCall.args[ 1 ];
        expect( opts.clientId ).to.equal( 'my-custom-source' );
    } );

    it( 'normalizes single topic to array', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: 'single/topic',
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        // Trigger connect to verify subscribe is called with array
        mockClient._emit( 'connect' );

        expect( mockClient.subscribe.calledWith(
            [ 'single/topic' ],
            sinon.match.object,
            sinon.match.func
        ) ).to.equal( true );
    } );

    it( 'accepts array of topics', function () {
        createMQTTSourceClient( {
            brokerUrl: 'mqtt://localhost',
            topics: [ 'topic/one', 'topic/two' ],
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        mockClient._emit( 'connect' );

        expect( mockClient.subscribe.calledWith(
            [ 'topic/one', 'topic/two' ],
            sinon.match.object,
            sinon.match.func
        ) ).to.equal( true );
    } );

} );

describe( 'MQTT Source — start()', function () {

    afterEach( function () {
        sinon.restore();
    } );

    it( 'delegates to the client factory and returns a working stop function', async function () {
        const mockClient = createMockClient();
        const mockConnect = sinon.stub().returns( mockClient );

        const stop = mqttSource.start( {
            brokerUrl: 'mqtt://localhost:1883',
            topics: 'test/topic',
            onMessage: () => {},
            mqttConnectFn: mockConnect
        } );

        expect( mockConnect.calledOnce ).to.equal( true );
        expect( stop ).to.be.a( 'function' );

        await stop();
        expect( mockClient.end.calledOnce ).to.equal( true );
    } );

} );

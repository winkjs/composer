// core/emitter-manager/mqtt/test/e2e-mqtt-emitter-config-errors.specs.js

/**
 * @fileoverview Integration-level tests for MQTT emitter setup-time error
 * classification.
 *
 * The unit tests in `emitter.specs.js` and
 * `config-schema.specs.js` cover the happy-path of error classification
 * with stubbed `mqttConnectFn` and direct schema-validation calls. This
 * file complements them by exercising the **full `createEmitter()` path
 * without injection** — confirming that classified `err.code` survives
 * the real call site, and pinning edge cases the unit tests don't reach
 * (empty-string and whitespace inputs, non-object codec, and the
 * operator-facing diagnostic content of `err.message`).
 *
 * Each test asserts the operator-facing contract from ADR-018:
 * setup-time failures throw an `Error` whose `code` property is one
 * of a small, documented vocabulary, so flow operators can route on it
 * without parsing message strings.
 *
 * No broker connection is established for any of these tests — every
 * scenario throws *before* `mqtt.connect()` is reached, so no Mosquitto
 * is required.
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import sinon from 'sinon';

import { createEmitter } from '../emitter.js';
import { ENV_VARS } from '../../../env-vars.js';

const validCodec = {
    pack: ( msg ) => Buffer.from( JSON.stringify( msg ) ),
    contentType: 'application/json'
};

const noop = function () { /* placeholder for mqtt-client stubs */ };

const stubMqttClient = function () {
    return {
        publish: noop,
        end: ( _force, _opts, cb ) => cb && cb(),
        on: noop
    };
};

const expectThrowsCode = function ( fn, expectedCode ) {
    let thrown;
    try {
        fn();
    } catch ( err ) {
        thrown = err;
    }
    expect( thrown, 'should have thrown' ).to.be.an( 'error' );
    expect( thrown.code ).to.equal( expectedCode );
    return thrown;
};

describe( 'MQTT emitter E2E — setup-time error classification', function () {

    let envStub;

    afterEach( function () {
        if ( envStub ) {
            envStub.restore();
            envStub = null;
        }
    } );

    // ------------------------------------------------------------------
    // The brokerUrl and codec throw sites in createEmitter. Already
    // unit-covered in emitter-config.specs.js; reasserted here at the
    // integration level (no `mqttConnectFn` injection, no
    // schema-pre-validation), and extended with diagnostic-content pins.
    // ------------------------------------------------------------------

    it( 'throws INVALID_CONFIG when brokerUrl missing and env-var unset', function () {
        envStub = sinon.stub( ENV_VARS, 'mqttBrokerUrl' ).value( undefined );
        const err = expectThrowsCode(
            () => createEmitter( { codec: validCodec } ),
            'INVALID_CONFIG'
        );
        expect( err.message ).to.contain( 'brokerUrl' );
        expect( err.message ).to.contain( 'MQTT_BROKER_URL' );
    } );

    it( 'throws INVALID_CONFIG when codec missing', function () {
        const err = expectThrowsCode(
            () => createEmitter( { brokerUrl: 'mqtt://localhost:1883' } ),
            'INVALID_CONFIG'
        );
        expect( err.message ).to.contain( 'codec' );
    } );

    // ------------------------------------------------------------------
    // Edge-case inputs not reached by existing unit tests.
    // ------------------------------------------------------------------

    it( 'throws INVALID_CONFIG when brokerUrl is empty (2026-07-09: comment re-based to the ?? semantics)', function () {
        // `config.brokerUrl ?? ENV_VARS.mqttBrokerUrl`: an explicit ''
        // is the user's choice — no env fallback happens — and the
        // trim-then-check rejects it. No env stub needed.
        expectThrowsCode(
            () => createEmitter( { brokerUrl: '', codec: validCodec } ),
            'INVALID_CONFIG'
        );
    } );

    it( 'throws INVALID_CONFIG when brokerUrl is empty (no env fallback for explicit empty)', function () {
        // `??` (not `||`) so explicit '' is
        // the user's choice, not "fall back to env." Symmetric with QuestDB,
        // which throws on `ilpUrl: ''`.
        expectThrowsCode(
            () => createEmitter( {
                brokerUrl: '',
                codec: validCodec,
                mqttConnectFn: stubMqttClient
            } ),
            'INVALID_CONFIG'
        );
    } );

    it( 'throws INVALID_CONFIG when brokerUrl is null and env-var is empty', function () {
        // `null` is falsy → fallback to env. With env stubbed empty,
        // both are falsy and the throw fires.
        envStub = sinon.stub( ENV_VARS, 'mqttBrokerUrl' ).value( '' );
        expectThrowsCode(
            () => createEmitter( { brokerUrl: null, codec: validCodec } ),
            'INVALID_CONFIG'
        );
    } );

    it( 'throws INVALID_CONFIG when brokerUrl is whitespace-only', function () {
        // `.trim()` before the empty check
        // rejects whitespace-only strings — which would otherwise pass
        // through truthy and reach mqtt.connect() unchanged.
        expectThrowsCode(
            () => createEmitter( {
                brokerUrl: '   ',
                codec: validCodec,
                mqttConnectFn: stubMqttClient
            } ),
            'INVALID_CONFIG'
        );
    } );

    it( 'throws INVALID_CONFIG when codec is null', function () {
        // `!config.codec` catches both `undefined` and `null`.
        const err = expectThrowsCode(
            () => createEmitter( {
                brokerUrl: 'mqtt://localhost:1883',
                codec: null
            } ),
            'INVALID_CONFIG'
        );
        expect( err.message ).to.contain( 'codec' );
    } );

    // Note: the two no-store-on-failure tests died with the disk store
    // (ADR-021) — there is no store directory to guard against anymore.
    // The successful-construction case is pinned in emitter-config.specs.js
    // ('no disk store (ADR-021)').

    // ------------------------------------------------------------------
    // Setup-time errors are config errors, not transport errors — no
    // `err.cause` is expected.
    // ------------------------------------------------------------------

    it( 'setup-time INVALID_CONFIG throws have no err.cause (pure config)', function () {
        envStub = sinon.stub( ENV_VARS, 'mqttBrokerUrl' ).value( undefined );
        const err = expectThrowsCode(
            () => createEmitter( { codec: validCodec } ),
            'INVALID_CONFIG'
        );
        expect( err.cause ).to.equal( undefined );
    } );

    // ------------------------------------------------------------------
    // Later contract additions: createEmitter-level validation of the
    // codec.pack runtime check and the three callbacks (mirrors QuestDB's
    // factory-level validation in persist-plan.js:121-134, plus the schema-
    // level validation in `config-schema.specs.js`).
    // ------------------------------------------------------------------

    it( 'throws INVALID_CONFIG when codec lacks a pack() function', function () {
        const err = expectThrowsCode(
            () => createEmitter( {
                brokerUrl: 'mqtt://localhost:1883',
                codec: { contentType: 'application/json' }  // no pack
            } ),
            'INVALID_CONFIG'
        );
        expect( err.message ).to.contain( 'pack' );
    } );

    it( 'throws INVALID_CONFIG when onDeliveryFailure is not a function', function () {
        const err = expectThrowsCode(
            () => createEmitter( {
                brokerUrl: 'mqtt://localhost:1883',
                codec: validCodec,
                onDeliveryFailure: 'not a function',
                mqttConnectFn: stubMqttClient
            } ),
            'INVALID_CONFIG'
        );
        expect( err.message ).to.contain( 'onDeliveryFailure' );
    } );

    it( 'throws INVALID_CONFIG when onCritical is not a function', function () {
        const err = expectThrowsCode(
            () => createEmitter( {
                brokerUrl: 'mqtt://localhost:1883',
                codec: validCodec,
                onCritical: 42,
                mqttConnectFn: stubMqttClient
            } ),
            'INVALID_CONFIG'
        );
        expect( err.message ).to.contain( 'onCritical' );
    } );

    it( 'throws INVALID_CONFIG when onBackpressure is not a function', function () {
        const err = expectThrowsCode(
            () => createEmitter( {
                brokerUrl: 'mqtt://localhost:1883',
                codec: validCodec,
                onBackpressure: {},
                mqttConnectFn: stubMqttClient
            } ),
            'INVALID_CONFIG'
        );
        expect( err.message ).to.contain( 'onBackpressure' );
    } );

} );

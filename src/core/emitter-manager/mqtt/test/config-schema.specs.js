// core/emitter-manager/mqtt/test/config-schema.specs.js

/* eslint-disable no-empty-function, no-underscore-dangle */

/**
 * @fileoverview Tests for MQTT emitter configSchema validation.
 *
 * Tests cover:
 * - Schema exports correctly
 * - Required fields (brokerUrl, codec)
 * - Optional fields validation
 * - Nested object validation (will)
 * - Custom validators (codec.pack, clientId no spaces)
 * - Unknown-key rejection via `_propertyNames`: typos and
 *   the ADR-021-retired disk-store keys fail loudly at DSL time instead
 *   of being silently ignored.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import mqttEmitterAdapter, { configSchema, id } from '../index.js';
import { validateWithSchema } from '../../../utils/validate/index.js';
import { flow } from '../../../../flow/flow.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const validCodec = {
    pack: ( msg ) => JSON.stringify( msg ),
    contentType: 'application/json'
};

const minimalValidConfig = {
    brokerUrl: 'mqtt://broker.local:1883',
    codec: validCodec
};

// ============================================================================
// HELPER: Run validation and return result
// ============================================================================

const validate = function ( config ) {
    return validateWithSchema( configSchema, config, 'config' );
};

// ============================================================================
// TESTS
// ============================================================================

describe( 'MQTT Emitter — configSchema Export', function () {

    it( 'exports configSchema object', function () {
        expect( configSchema ).to.be.an( 'object' );
    } );

    it( 'exports id as "mqtt"', function () {
        expect( id ).to.equal( 'mqtt' );
    } );

    it( 'configSchema has field definitions', function () {
        expect( configSchema ).to.have.property( 'brokerUrl' );
        expect( configSchema ).to.have.property( 'codec' );
        // brokerUrl optional at schema level — ENV_VARS provides fallback
        expect( configSchema.brokerUrl.required ).to.equal( false );
        expect( configSchema.codec.required ).to.equal( true );
    } );

    it( 'configSchema has optional field definitions', function () {
        expect( configSchema ).to.have.property( 'clientId' );
        expect( configSchema ).to.have.property( 'debug' );
        expect( configSchema ).to.have.property( 'maxQueueSize' );
        expect( configSchema ).to.have.property( 'will' );
        // The disk-store fields died with the LevelDB store (ADR-021);
        // their absence is asserted so they cannot silently resurface.
        expect( configSchema ).to.not.have.property( 'storePath' );
        expect( configSchema ).to.not.have.property( 'maxQueueBytes' );
    } );

} );

describe( 'MQTT Emitter — Required Fields', function () {

    it( 'rejects empty config (missing codec)', function () {
        const result = validate( {} );

        expect( result.valid ).to.equal( false );
        expect( result.errors.length ).to.be.at.least( 1 );
    } );

    it( 'accepts config without brokerUrl — defaults from ENV_VARS', function () {
        const result = validate( { codec: validCodec } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'rejects config without codec', function () {
        const result = validate( { brokerUrl: 'mqtt://test:1883' } );

        expect( result.valid ).to.equal( false );
        expect( result.errors.some( ( e ) => e.includes( 'codec' ) ) ).to.equal( true );
    } );

    it( 'accepts minimal valid config', function () {
        const result = validate( minimalValidConfig );

        expect( result.valid ).to.equal( true );
        expect( result.errors ).to.have.lengthOf( 0 );
    } );

} );

describe( 'MQTT Emitter — brokerUrl Validation', function () {

    it( 'accepts valid mqtt:// URL', function () {
        const result = validate( {
            ...minimalValidConfig,
            brokerUrl: 'mqtt://broker.example.com:1883'
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts valid mqtts:// URL', function () {
        const result = validate( {
            ...minimalValidConfig,
            brokerUrl: 'mqtts://secure.broker.com:8883'
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'rejects empty brokerUrl', function () {
        const result = validate( {
            ...minimalValidConfig,
            brokerUrl: ''
        } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'rejects brokerUrl as number', function () {
        const result = validate( {
            ...minimalValidConfig,
            brokerUrl: 1883
        } );

        expect( result.valid ).to.equal( false );
    } );

} );

describe( 'MQTT Emitter — codec Validation', function () {

    it( 'accepts codec with pack function', function () {
        const result = validate( {
            ...minimalValidConfig,
            codec: { pack: () => 'data' }
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'rejects codec without pack function', function () {
        const result = validate( {
            ...minimalValidConfig,
            codec: { encode: () => 'data' }  // Wrong method name
        } );

        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.include( 'pack' );
    } );

    it( 'rejects codec as null', function () {
        const result = validate( {
            ...minimalValidConfig,
            codec: null
        } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'rejects codec as string', function () {
        const result = validate( {
            ...minimalValidConfig,
            codec: 'json'
        } );

        expect( result.valid ).to.equal( false );
    } );

} );

describe( 'MQTT Emitter — Optional String Fields', function () {

    it( 'accepts valid clientId', function () {
        const result = validate( {
            ...minimalValidConfig,
            clientId: 'sensor-001'
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'rejects clientId with spaces', function () {
        const result = validate( {
            ...minimalValidConfig,
            clientId: 'sensor 001'
        } );

        expect( result.valid ).to.equal( false );
        expect( result.errors[ 0 ] ).to.include( 'clientId' );
    } );

} );

describe( 'MQTT Emitter — Optional Number Fields', function () {

    it( 'accepts valid maxQueueSize', function () {
        const result = validate( {
            ...minimalValidConfig,
            maxQueueSize: 10000
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'rejects maxQueueSize as zero', function () {
        const result = validate( {
            ...minimalValidConfig,
            maxQueueSize: 0
        } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'rejects maxQueueSize as negative', function () {
        const result = validate( {
            ...minimalValidConfig,
            maxQueueSize: -100
        } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'rejects maxQueueSize as float', function () {
        const result = validate( {
            ...minimalValidConfig,
            maxQueueSize: 10000.5
        } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'accepts connectGraceMs of 0 — the wait can be disabled', function () {
        const result = validate( {
            ...minimalValidConfig,
            connectGraceMs: 0
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts connectGraceMs of 500', function () {
        const result = validate( {
            ...minimalValidConfig,
            connectGraceMs: 500
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'rejects connectGraceMs as negative', function () {
        const result = validate( {
            ...minimalValidConfig,
            connectGraceMs: -1
        } );

        expect( result.valid ).to.equal( false );
        expect( result.errors.some( ( e ) => e.includes( 'connectGraceMs' ) ) ).to.equal( true );
    } );

    it( 'rejects connectGraceMs as float', function () {
        const result = validate( {
            ...minimalValidConfig,
            connectGraceMs: 1.5
        } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'rejects connectGraceMs as string', function () {
        const result = validate( {
            ...minimalValidConfig,
            connectGraceMs: '500'
        } );

        expect( result.valid ).to.equal( false );
    } );

} );

describe( 'MQTT Emitter — debug Field', function () {

    it( 'accepts debug=true', function () {
        const result = validate( {
            ...minimalValidConfig,
            debug: true
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts debug=false', function () {
        const result = validate( {
            ...minimalValidConfig,
            debug: false
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'rejects debug as string', function () {
        const result = validate( {
            ...minimalValidConfig,
            debug: 'true'
        } );

        expect( result.valid ).to.equal( false );
    } );

} );

describe( 'MQTT Emitter — will Object Validation', function () {

    it( 'accepts valid will object', function () {
        const result = validate( {
            ...minimalValidConfig,
            will: {
                topic: 'devices/sensor-001/status',
                message: { status: 'offline' }
            }
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts will with optional qos and retain', function () {
        const result = validate( {
            ...minimalValidConfig,
            will: {
                topic: 'status',
                message: { offline: true },
                qos: 1,
                retain: true
            }
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'rejects will without topic', function () {
        const result = validate( {
            ...minimalValidConfig,
            will: {
                message: { status: 'offline' }
            }
        } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'rejects will without message', function () {
        const result = validate( {
            ...minimalValidConfig,
            will: {
                topic: 'status'
            }
        } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'rejects will.qos outside 0-2 range', function () {
        const result = validate( {
            ...minimalValidConfig,
            will: {
                topic: 'status',
                message: { offline: true },
                qos: 3
            }
        } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'accepts will.qos=0', function () {
        const result = validate( {
            ...minimalValidConfig,
            will: {
                topic: 'status',
                message: { offline: true },
                qos: 0
            }
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'accepts will.qos=2', function () {
        const result = validate( {
            ...minimalValidConfig,
            will: {
                topic: 'status',
                message: { offline: true },
                qos: 2
            }
        } );

        expect( result.valid ).to.equal( true );
    } );

} );

describe( 'MQTT Emitter — Callback Function Fields', function () {

    it( 'accepts onCritical as function', function () {
        const result = validate( {
            ...minimalValidConfig,
            onCritical: ( type, pressure ) => console.log( type, pressure )
        } );

        expect( result.valid ).to.equal( true );
    } );

    it( 'rejects onCritical as string', function () {
        const result = validate( {
            ...minimalValidConfig,
            onCritical: 'handleCritical'
        } );

        expect( result.valid ).to.equal( false );
    } );

    it( 'accepts onBackpressure as function', function () {
        const result = validate( {
            ...minimalValidConfig,
            onBackpressure: ( pressure ) => console.log( pressure )
        } );

        expect( result.valid ).to.equal( true );
    } );

} );

describe( 'MQTT Emitter — Full Config Validation', function () {

    it( 'accepts comprehensive valid config', function () {
        const result = validate( {
            brokerUrl: 'mqtt://broker.local:1883',
            codec: validCodec,
            clientId: 'edge-device-001',
            debug: false,
            maxQueueSize: 10000,
            will: {
                topic: 'devices/edge-device-001/status',
                message: { status: 'offline', timestamp: Date.now() },
                qos: 1,
                retain: true
            },
            onCritical: () => { /* intentionally empty */ },
            onBackpressure: () => { /* intentionally empty */ }
        } );

        expect( result.valid ).to.equal( true );
        expect( result.errors ).to.have.lengthOf( 0 );
    } );

} );

describe( 'MQTT Emitter — throwIfInvalid', function () {

    it( 'does not throw for valid config', function () {
        const result = validate( minimalValidConfig );

        expect( () => result.throwIfInvalid( 'mqtt' ) ).to.not.throw();
    } );

    it( 'throws TypeError for invalid config', function () {
        const result = validate( {} );

        expect( () => result.throwIfInvalid( 'mqtt' ) ).to.throw( TypeError );
    } );

    it( 'includes nodeType in error message', function () {
        const result = validate( {} );

        expect( () => result.throwIfInvalid( 'flow/emitter:mqtt' ) )
            .to.throw( /flow\/emitter:mqtt/ );
    } );

    it( 'includes validation errors in message', function () {
        const result = validate( {} );

        try {
            result.throwIfInvalid( 'mqtt' );
        } catch ( e ) {
            expect( e.message ).to.include( 'codec' );
        }
    } );

} );

// ============================================================================
// UNKNOWN-KEY REJECTION
// ============================================================================

describe( 'MQTT Emitter — Unknown-Key Rejection', function () {

    it( '_propertyNames lists exactly the schema field names', function () {
        // Self-consistency: every declared field is an allowed key and
        // vice versa, so the schema cannot drift from its own key list.
        const fieldNames = Object.keys( configSchema )
            .filter( ( key ) => !key.startsWith( '_' ) )
            .sort();
        const allowed = [ ...configSchema._propertyNames ].sort();
        expect( allowed ).to.deep.equal( fieldNames );
    } );

    it( 'flags \'brokerURL\' (case typo) as an unknown property', function () {
        const result = validate( { ...minimalValidConfig, brokerURL: 'mqtt://typo' } );

        expect( result.valid ).to.equal( false );
        expect( result.errors.some( ( e ) => e.includes( 'Unknown property \'brokerURL\'' ) ) ).to.equal( true );
    } );

    it( 'flags retired \'storePath\' (removed by ADR-021) as an unknown property', function () {
        const result = validate( { ...minimalValidConfig, storePath: './mqtt-queue' } );

        expect( result.valid ).to.equal( false );
        expect( result.errors.some( ( e ) => e.includes( 'Unknown property \'storePath\'' ) ) ).to.equal( true );
    } );

    it( 'flags retired \'maxQueueBytes\' (removed by ADR-021) as an unknown property', function () {
        const result = validate( { ...minimalValidConfig, maxQueueBytes: 1048576 } );

        expect( result.valid ).to.equal( false );
        expect( result.errors.some( ( e ) => e.includes( 'Unknown property \'maxQueueBytes\'' ) ) ).to.equal( true );
    } );

    it( 'accepts a config using every advertised key', function () {
        const result = validate( {
            brokerUrl: 'mqtt://broker.local:1883',
            codec: validCodec,
            clientId: 'edge-emitter-1',
            debug: false,
            maxQueueSize: 5000,
            will: { topic: 'edge/status', message: { alive: false } },
            onCritical: () => {},
            onBackpressure: () => {},
            onDeliveryFailure: () => {},
            mqttConnectFn: () => {}
        } );

        expect( result.valid ).to.equal( true );
        expect( result.errors ).to.have.lengthOf( 0 );
    } );

    it( 'rejects mqttConnectFn as a non-function', function () {
        const result = validate( { ...minimalValidConfig, mqttConnectFn: 'mqtt.connect' } );

        expect( result.valid ).to.equal( false );
    } );

} );

describe( 'MQTT Emitter — DSL-Time Enforcement (flow.emitter hook)', function () {

    it( 'flow.emitter() rejects a retired key with a loud error', function () {
        expect( () => flow( 'emitter-unknown-key-test' ).emitter( mqttEmitterAdapter, {
            codec: validCodec,
            storePath: './mqtt-queue'
        } ) ).to.throw( /Unknown property 'storePath'/ );
    } );

    it( 'flow.emitter() accepts a minimal valid config', function () {
        const api = flow( 'emitter-valid-config-test' ).emitter( mqttEmitterAdapter, minimalValidConfig );

        expect( api ).to.have.property( 'build' );
    } );

} );

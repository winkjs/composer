// core/emitter-manager/mqtt/test/will-config.specs.js

/**
 * @fileoverview MQTT emitter — will (last-will testament) configuration.
 *
 * The schema advertises three shapes for `will.qos` (0, 1, 2); every
 * advertised shape gets a test here. Written after the 2026-07-09
 * review found `will.qos: 0` silently coerced to 1 (`||` treats a valid
 * 0 as absent) with no test to catch it. The setup-time encode guard is
 * also pinned here: a will message the codec cannot encode must throw a
 * classified INVALID_CONFIG error, not a raw TypeError.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import { createEmitter } from '../emitter.js';
import { makeMockClient, testCodec } from './test-helpers.js';

describe( 'mqtt emitter — will configuration', function () {

    let mock;
    let capturedOpts;

    const makeEmitter = function ( will ) {
        return createEmitter( {
            brokerUrl: 'mqtt://localhost',
            connectGraceMs: 0,
            codec: testCodec,
            will,
            mqttConnectFn: ( url, opts ) => {
                capturedOpts = opts;
                return mock.client;
            }
        } );
    };

    beforeEach( function () {
        mock = makeMockClient();
        capturedOpts = null;
    } );

    describe( 'qos shapes — every advertised value passes through', function () {

        it( 'preserves will.qos 0 (0 is a valid QoS, not an absent one)', function () {
            makeEmitter( { topic: 'status/offline', message: { s: 'down' }, qos: 0 } );
            expect( capturedOpts.will.qos ).to.equal( 0 );
        } );

        it( 'preserves will.qos 1', function () {
            makeEmitter( { topic: 'status/offline', message: { s: 'down' }, qos: 1 } );
            expect( capturedOpts.will.qos ).to.equal( 1 );
        } );

        it( 'preserves will.qos 2', function () {
            makeEmitter( { topic: 'status/offline', message: { s: 'down' }, qos: 2 } );
            expect( capturedOpts.will.qos ).to.equal( 2 );
        } );

        it( 'defaults to QoS 1 when will.qos is not given', function () {
            makeEmitter( { topic: 'status/offline', message: { s: 'down' } } );
            expect( capturedOpts.will.qos ).to.equal( 1 );
        } );

    } );

    describe( 'setup-time shape guard (direct callers bypass the schema)', function () {

        it( 'classifies a will without a topic as INVALID_CONFIG', function () {
            let caught = null;
            try {
                makeEmitter( { message: { s: 'down' } } );
            } catch ( err ) {
                caught = err;
            }
            expect( caught, 'a will without a topic must throw' ).to.not.equal( null );
            expect( caught.code ).to.equal( 'INVALID_CONFIG' );
            expect( caught.message ).to.contain( 'will.topic' );
        } );

        it( 'classifies a will without a message as INVALID_CONFIG', function () {
            let caught = null;
            try {
                makeEmitter( { topic: 'status/offline' } );
            } catch ( err ) {
                caught = err;
            }
            expect( caught, 'a will without a message must throw' ).to.not.equal( null );
            expect( caught.code ).to.equal( 'INVALID_CONFIG' );
            expect( caught.message ).to.contain( 'will.message' );
        } );

    } );

    describe( 'setup-time encode guard', function () {

        it( 'classifies a will message the codec cannot encode as INVALID_CONFIG', function () {
            const circular = {};
            circular.self = circular;

            let caught = null;
            try {
                makeEmitter( { topic: 'status/offline', message: circular } );
            } catch ( err ) {
                caught = err;
            }

            expect( caught, 'an unencodable will message must throw' ).to.not.equal( null );
            expect( caught.code ).to.equal( 'INVALID_CONFIG' );
            // The message points at the failing field, per ADR-018.
            expect( caught.message ).to.contain( 'will.message' );
        } );

    } );

} );

// Moved verbatim from the former emitter.specs.js monolith (2026-07-09
// split; moves not rewrites).
describe( 'mqtt emitter — will (mqtt.js options handoff)', function () {

    let mockClient;
    let mockConnect;
    let emitter;

    beforeEach( function () {
        const mock = makeMockClient();
        mockClient = mock.client;
        mockConnect = sinon.stub().returns( mockClient );
    } );

    afterEach( async function () {
        if ( emitter ) {
            await Promise.resolve( emitter.shutdown() ).catch( () => undefined );
            emitter = null;
        }

        sinon.restore();
    } );

    describe( 'will message configuration', function () {

        it( 'does not set will if not configured', function () {
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            const opts = mockConnect.firstCall.args[ 1 ];
            expect( opts.will ).to.equal( undefined );
        } );

        it( 'sets will message when configured', function () {
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                will: {
                    topic: 'status/offline',
                    message: { status: 'offline' }
                },
                mqttConnectFn: mockConnect
            } );

            const opts = mockConnect.firstCall.args[ 1 ];
            expect( opts.will ).to.not.equal( undefined );
            expect( opts.will.topic ).to.equal( 'status/offline' );
            expect( opts.will.retain ).to.equal( true );
        } );

        it( 'respects will retain=false', function () {
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                will: {
                    topic: 'status/offline',
                    message: { status: 'offline' },
                    retain: false
                },
                mqttConnectFn: mockConnect
            } );

            const opts = mockConnect.firstCall.args[ 1 ];
            expect( opts.will.retain ).to.equal( false );
        } );

        it( 'sets payloadFormatIndicator when codec specifies it', function () {
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: {
                    ...testCodec,
                    payloadFormatIndicator: 1
                },
                will: {
                    topic: 'status/offline',
                    message: { status: 'offline' }
                },
                mqttConnectFn: mockConnect
            } );

            const opts = mockConnect.firstCall.args[ 1 ];
            expect( opts.will.properties.payloadFormatIndicator ).to.equal( true );
        } );

    } );


} );

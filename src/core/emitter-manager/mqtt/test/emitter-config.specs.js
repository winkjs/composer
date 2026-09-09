// core/emitter-manager/mqtt/test/emitter-config.specs.js

/**
 * @fileoverview MQTT emitter — configuration validation and the no-disk-store guarantee (ADR-021).
 *
 * Split from the former emitter.specs.js monolith (per-concern files,
 * moves not rewrites). Uses sinon stubs to mock
 * mqtt.connect — no broker required.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { createEmitter } from '../emitter.js';
import { ENV_VARS } from '../../../env-vars.js';
import fs from 'fs/promises';
import path from 'path';
import { makeMockClient, refusalOf, testCodec } from './test-helpers.js';
describe( 'mqtt emitter — configuration', function () {

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
            // Tests that pin pressure high make this shutdown lossy by
            // design — the classified SHUTDOWN_TIMEOUT is expected there
            // and irrelevant to teardown.
            await Promise.resolve( emitter.shutdown() ).catch( () => undefined );
            emitter = null;
        }

        sinon.restore();
    } );

    describe( 'malformed broker url', function () {

        it( 'classifies a url mqtt.connect rejects as INVALID_CONFIG', async function () {
            // No mqttConnectFn injected: the REAL mqtt.connect runs and
            // throws on a protocol-less url. Without the guard that
            // throw escaped unclassified, against the ADR-018 rule that
            // setup-time refusals carry a classified err.code.
            const caught = await refusalOf( createEmitter( {
                brokerUrl: 'not-a-url',
                codec: testCodec
            } ) );
            expect( caught, 'a malformed broker url must be refused' ).to.not.equal( null );
            expect( caught.code ).to.equal( 'INVALID_CONFIG' );
            expect( caught.message ).to.contain( 'not-a-url' );
        } );

    } );

    // ========================================================================
    // CONFIGURATION VALIDATION
    // ========================================================================

    describe( 'configuration validation', function () {

        it( 'uses ENV_VARS.mqttBrokerUrl when brokerUrl omitted', async function () {
            // Should resolve — ENV_VARS provides default broker URL
            emitter = await createEmitter( {
                codec: testCodec,
                connectGraceMs: 0,
                mqttConnectFn: mockConnect
            } );
            expect( emitter ).to.have.property( 'publishNow' );
        } );

        it( 'rejects if codec is missing', async function () {
            const err = await refusalOf( createEmitter( {
                brokerUrl: 'mqtt://127.0.0.1',
                connectGraceMs: 0,
                mqttConnectFn: mockConnect
            } ) );
            expect( err ).to.be.an.instanceOf( TypeError );
            expect( err.message ).to.contain( 'codec is required' );
        } );

        it( 'setup refusals carry err.code = INVALID_CONFIG (ADR-018)', async function () {
            // Two representative scenarios — one per setup-time refusal site.
            // For the missing-brokerUrl case we have to also stub out the
            // ENV_VARS fallback (loaded once at module import; deleting
            // process.env.MQTT_BROKER_URL after that has no effect).
            const cases = [
                {
                    config: { codec: testCodec, mqttConnectFn: mockConnect },
                    what: 'missing brokerUrl (with no env-var default)',
                    stubEnv: true
                },
                {
                    config: { brokerUrl: 'mqtt://127.0.0.1', mqttConnectFn: mockConnect },
                    what: 'missing codec'
                }
            ];

            for ( const { config, what, stubEnv } of cases ) {
                let envStub;
                if ( stubEnv ) {
                    envStub = sinon.stub( ENV_VARS, 'mqttBrokerUrl' ).value( undefined );
                }
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const thrown = await refusalOf( createEmitter( config ) );
                    expect( thrown, `case: ${what}` ).to.be.an( 'error' );
                    expect( thrown.code, `case: ${what}` ).to.equal( 'INVALID_CONFIG' );
                } finally {
                    if ( envStub ) envStub.restore();
                }
            }
        } );

        it( 'creates emitter with valid config', async function () {
            emitter = await createEmitter( {
                brokerUrl: 'mqtt://127.0.0.1',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            expect( emitter ).to.have.property( 'publishNow' );
            expect( emitter ).to.have.property( 'shutdown' );
            expect( emitter ).to.have.property( 'getHealth' );
            expect( emitter ).to.have.property( 'getPressure' );
            // Note: getStats was removed — adapter-specific stats
            // are accessible via getHealth().stats sub-field. The dedicated
            // getter had no production callers (verified before removal).
        } );

        it( 'generates clientId if not provided', async function () {
            emitter = await createEmitter( {
                brokerUrl: 'mqtt://127.0.0.1',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            expect( mockConnect.calledOnce ).to.equal( true );
            const opts = mockConnect.firstCall.args[ 1 ];
            expect( opts.clientId ).to.match( /^wink-\d+-[a-z0-9]+$/ );
        } );

        it( 'uses provided clientId', async function () {
            emitter = await createEmitter( {
                brokerUrl: 'mqtt://127.0.0.1',
                connectGraceMs: 0,
                codec: testCodec,
                clientId: 'my-custom-client',
                mqttConnectFn: mockConnect
            } );

            const opts = mockConnect.firstCall.args[ 1 ];
            expect( opts.clientId ).to.equal( 'my-custom-client' );
        } );

    } );

    // ========================================================================
    // NO DISK STORE (ADR-021)
    // ========================================================================

    describe( 'no disk store (ADR-021)', function () {

        it( 'creates NO store directory — nothing touches the filesystem', async function () {
            const clientId = `test-client-${Date.now()}`;

            emitter = await createEmitter( {
                brokerUrl: 'mqtt://127.0.0.1',
                connectGraceMs: 0,
                codec: testCodec,
                clientId: clientId,
                mqttConnectFn: mockConnect
            } );

            await new Promise( ( r ) => setTimeout( r, 50 ) );

            // The wal-backed design created ./tmp/mqtt-store-<clientId>
            // here; the in-memory design must not.
            const oldDefaultPath = path.join( './tmp', `mqtt-store-${clientId}` );
            const stats = await fs.stat( oldDefaultPath ).catch( () => null );
            expect( stats ).to.equal( null );
        } );

    } );


} );

// core/emitter-manager/mqtt/test/emitter-backpressure.specs.js

/**
 * @fileoverview MQTT emitter — backpressure callbacks (onCritical, onBackpressure) and delivery-failure routing.
 *
 * Split from the former emitter.specs.js monolith (per-concern files,
 * moves not rewrites). Uses sinon stubs to mock
 * mqtt.connect — no broker required.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { createEmitter } from '../emitter.js';
import { makeMockClient, testCodec } from './test-helpers.js';
describe( 'mqtt emitter — backpressure', function () {

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

    // ========================================================================
    // BACKPRESSURE
    // ========================================================================

    describe( 'backpressure handling', function () {

        // The unhandledRejection listener removes itself when the expected
        // rejection arrives; when a test fails by timeout instead, it must
        // not stay installed for the rest of the run (m9).
        let strayRejectionListener = null;
        afterEach( function () {
            if ( strayRejectionListener ) {
                process.removeListener( 'unhandledRejection', strayRejectionListener );
                strayRejectionListener = null;
            }
        } );

        it( 'calls onBackpressure callback after publish', async function () {
            let pressureValue = null;

            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                onBackpressure: ( pressure ) => {
                    pressureValue = pressure;
                },
                mqttConnectFn: mockConnect
            } );

            await emitter.publishNow( 'test/topic', { value: 42 } );
            await new Promise( ( resolve ) => setImmediate( resolve ) );

            expect( pressureValue ).to.be.a( 'number' );
        } );

        it( 'routes every async publish failure through onDeliveryFailure as DELIVERY_FAILED, preserving the cause', async function () {
            // The wal-backed design special-cased QUEUE_FULL, byte-axis
            // STORAGE_FULL, and CIRCUIT_OPEN store codes. Those codes died
            // with the disk store (ADR-021): every async publish failure now
            // carries the one user-facing code DELIVERY_FAILED, with the
            // original error preserved on err.cause for diagnostics.
            // onCritical stays reserved for the high-pressure warning.
            const causeCodes = [ 'QUEUE_FULL', 'CIRCUIT_OPEN', 'ECONNRESET' ];
            let criticalCalled = false;
            let failCode = null;
            const failures = [];

            mockClient.publish.callsFake( ( topic, payload, opts, cb ) => {
                const err = new Error( 'publish failed' );
                err.code = failCode;
                setImmediate( () => cb( err ) );
            } );

            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                onCritical: () => {
                    criticalCalled = true;
                },
                onDeliveryFailure: ( err, ctx ) => failures.push( { err, ctx } ),
                mqttConnectFn: mockConnect
            } );

            for ( const code of causeCodes ) {
                failCode = code;
                emitter.publishNow( 'test/topic', { value: 42 } );
                // eslint-disable-next-line no-await-in-loop
                await new Promise( ( resolve ) => setImmediate( resolve ) );
            }

            expect( failures.length ).to.equal( causeCodes.length );
            failures.forEach( ( failure, i ) => {
                expect( failure.err.code, `cause: ${causeCodes[ i ]}` ).to.equal( 'DELIVERY_FAILED' );
                expect( failure.err.cause.code ).to.equal( causeCodes[ i ] );
                expect( failure.ctx.topic ).to.equal( 'test/topic' );
            } );
            expect( criticalCalled ).to.equal( false );
        } );

        it( 'surfaces DELIVERY_FAILED as unhandledRejection when no onDeliveryFailure provided', function ( done ) {
            // Mirrors persist-plan.specs.js's contract: without a
            // handler, the adapter's default is loud failure via
            // Promise.reject → unhandledRejection. Listener catches it
            // for assertion; settled flag guards against re-entry.
            const localEmitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );
            mockClient.publish.callsFake( ( topic, payload, opts, cb ) => {
                const err = new Error( 'Connection reset' );
                err.code = 'ECONNRESET';
                setImmediate( () => cb( err ) );
            } );

            let settled = false;
            const onUnhandledRejection = ( err ) => {
                if ( settled ) return;
                if ( !err || err.code !== 'DELIVERY_FAILED' ) return;
                settled = true;
                process.removeListener( 'unhandledRejection', onUnhandledRejection );
                try {
                    expect( err.cause.code ).to.equal( 'ECONNRESET' );
                    expect( err.message ).to.contain( 'test/topic' );
                    localEmitter.shutdown( { timeout: 100 } ).then( () => done() );
                } catch ( assertErr ) {
                    done( assertErr );
                }
            };
            process.on( 'unhandledRejection', onUnhandledRejection );
            strayRejectionListener = onUnhandledRejection;

            localEmitter.publishNow( 'test/topic', { value: 42 } );
        } );

        it( 'getPressure returns a number in [0, 1]', function () {
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            const pressure = emitter.getPressure();
            expect( pressure ).to.be.a( 'number' );
            expect( pressure ).to.be.at.least( 0 );
            expect( pressure ).to.be.at.most( 1 );
        } );

        it( 'uses MESSAGE_EXPIRY override when options.type names a configured key', async function () {
            // Coverage for the truthy leg of
            // `MESSAGE_EXPIRY[ messageType ] || MESSAGE_EXPIRY.default`.
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            await emitter.publishNow( 'test/topic', { value: 42 }, { type: 'telemetry' } );

            const opts = mockClient.publish.firstCall.args[ 2 ];
            expect( opts.properties.messageExpiryInterval ).to.equal( 3600 );
        } );

        it( 'falls back to MESSAGE_EXPIRY.default when options.type is unknown', async function () {
            // Coverage closure for emitter.js:308 — the falsy leg of
            // `MESSAGE_EXPIRY[ messageType ] || MESSAGE_EXPIRY.default`,
            // i.e., the user passed a type that isn't a configured key.
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: mockConnect
            } );

            await emitter.publishNow( 'test/topic', { value: 42 }, { type: 'novel-unknown' } );

            const opts = mockClient.publish.firstCall.args[ 2 ];
            // The default value comes from ENV_VARS.mqttMsgExpiry (loaded
            // at process start); assert against the same field on
            // MESSAGE_EXPIRY rather than hard-coding, since env may shift.
            const constants = await import( '../constants.js' );
            expect( opts.properties.messageExpiryInterval ).to.equal( constants.MESSAGE_EXPIRY.default );
        } );

        it( 'falls back to err.code in the failure message when err.message is missing', async function () {
            // Coverage closure for emitter.js:336 — second leg of the
            // `err.message || err.code || 'unknown'` chain.
            const failures = [];
            mockClient.publish.callsFake( ( topic, payload, opts, cb ) => {
                const err = { code: 'CIRCUIT_OPEN' };  // no message field
                setImmediate( () => cb( err ) );
            } );
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                onDeliveryFailure: ( err, ctx ) => failures.push( { err, ctx } ),
                mqttConnectFn: mockConnect
            } );

            await emitter.publishNow( 'test/topic', { value: 42 } );
            await new Promise( ( resolve ) => setImmediate( resolve ) );

            expect( failures.length ).to.equal( 1 );
            expect( failures[ 0 ].err.message ).to.contain( 'CIRCUIT_OPEN' );
        } );

        it( 'falls back to "unknown" in the failure message when err has neither message nor code', async function () {
            // Coverage closure for emitter.js:336 — third leg of the
            // `err.message || err.code || 'unknown'` chain. Ensures the
            // diagnostic string is never empty even on degenerate errors.
            const failures = [];
            mockClient.publish.callsFake( ( topic, payload, opts, cb ) => {
                const err = {};  // no message, no code
                setImmediate( () => cb( err ) );
            } );
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                onDeliveryFailure: ( err, ctx ) => failures.push( { err, ctx } ),
                mqttConnectFn: mockConnect
            } );

            await emitter.publishNow( 'test/topic', { value: 42 } );
            await new Promise( ( resolve ) => setImmediate( resolve ) );

            expect( failures.length ).to.equal( 1 );
            expect( failures[ 0 ].err.message ).to.contain( 'unknown' );
            expect( failures[ 0 ].err.code ).to.equal( 'DELIVERY_FAILED' );
        } );

        it( 'fires onCritical with QUEUE_CRITICAL when pressure crosses 0.8 after an ack', function () {
            // onCritical fires from checkBackpressure, which runs inside
            // the publish callback. Fill the unacked window to 18 of 20
            // with manual acks, then acknowledge one message: its callback
            // sees pressure 17/20 = 0.85 > QUEUE_CRITICAL_THRESHOLD (0.8).
            const calls = [];
            const manual = makeMockClient( { manualAcks: true } );
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                maxQueueSize: 20,
                onCritical: ( reason, pressure ) => calls.push( { reason, pressure } ),
                mqttConnectFn: () => manual.client
            } );
            for ( let i = 0; i < 18; i += 1 ) {
                emitter.publishNow( 'test/topic', { value: i } );
            }

            manual.publishCalls[ 0 ].cb();

            expect( calls.length ).to.equal( 1 );
            expect( calls[ 0 ].reason ).to.equal( 'QUEUE_CRITICAL' );
            expect( calls[ 0 ].pressure ).to.equal( 0.85 );

            // Drain the window so afterEach's shutdown resolves clean.
            for ( let i = 1; i < 18; i += 1 ) {
                manual.publishCalls[ i ].cb();
            }
        } );

        it( 'does NOT fire onCritical at exactly 0.8 — the threshold is strict', function () {
            // checkBackpressure uses `pressure > 0.8`, not `>=`. Pin the
            // boundary: an ack that lands the counter at exactly 8/10
            // stays silent.
            const onCritical = sinon.stub();
            const manual = makeMockClient( { manualAcks: true } );
            emitter = createEmitter( {
                brokerUrl: 'mqtt://localhost',
                connectGraceMs: 0,
                codec: testCodec,
                maxQueueSize: 10,
                onCritical,
                mqttConnectFn: () => manual.client
            } );
            for ( let i = 0; i < 9; i += 1 ) {
                emitter.publishNow( 'test/topic', { value: i } );
            }

            manual.publishCalls[ 0 ].cb();

            expect( emitter.getPressure() ).to.equal( 0.8 );
            expect( onCritical.called ).to.equal( false );

            // Drain the window so afterEach's shutdown resolves clean.
            for ( let i = 1; i < 9; i += 1 ) {
                manual.publishCalls[ i ].cb();
            }
        } );

    } );


} );

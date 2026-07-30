// core/emitter-manager/test/substitutability.specs.js

/**
 * @fileoverview End-to-end proof that two stream sinks (Terminal and MQTT)
 * behave identically through a real flow, per the ADR-018 sink contract.
 *
 * The per-adapter tests already prove each adapter conforms to the contract
 * in isolation. This file proves the contract holds when both adapters are
 * wired through the flow's emit-if dispatch path — the structural shape of
 * `publishNow`'s return is identical across them, so a flow author can swap
 * one for the other without code changes.
 *
 * What "substitutability" is proved here:
 * - Same flow definition, different emitter handle wired in, same observable
 *   return shape and call pattern from `publishNow`.
 * - Success shape `{ ok: true }` is the EXACT shape (no adapter-specific
 *   extras smuggled in).
 * - Sync return (per ADR-013): never a Promise.
 * - Error shape `{ ok: false, error: { code, message } }` has exactly those
 *   two keys; the codes differ per adapter (`STORAGE_FULL` for MQTT here)
 *   but the SHAPE is uniform.
 *
 * The principle: no compromises on the end-to-end shape contract.
 *
 * @see ADR-018 (stream-sink role and sink contract)
 * @see ADR-013 (sync hot-path invariant)
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import sinon from 'sinon';

import * as terminalModule from '../terminal/index.js';
import * as mqttModule from '../mqtt/index.js';
import { flow } from '../../../composer.js';

// ============================================================================
// SHARED FIXTURES
// ============================================================================

/**
 * Minimal JSON codec satisfying MQTT's configSchema.codec validator
 * (`v !== null && typeof v.pack === 'function'`). The substitutability test
 * doesn't care about wire encoding — just needs the contract to be valid.
 */
const jsonCodec = {
    pack: ( msg ) => Buffer.from( JSON.stringify( msg ) ),
    contentType: 'application/json'
};

/**
 * Build a sinon-stubbed mqtt.js client whose `on('connect', handler)` and
 * other event registrations are captured into `eventHandlers` so the test
 * can fire them explicitly. Mirrors the pattern in
 * `mqtt/test/emitter.specs.js` so anyone reading both files sees a familiar
 * shape.
 */
const createMockMqttClient = function ( eventHandlers, { ack = true } = {} ) {
    return {
        publish: sinon.stub().callsFake( ( topic, payload, opts, cb ) => {
            if ( ack && cb ) {
                setImmediate( cb );
            }
        } ),
        end: sinon.stub().callsFake( ( force, opts, callback ) => {
            const cb = typeof opts === 'function' ? opts : callback;
            if ( cb ) {
                setImmediate( cb );
            }
        } ),
        on: sinon.stub().callsFake( ( event, handler ) => {
            eventHandlers[ event ] = handler;
        } )
    };
};

// ============================================================================
// TESTS
// ============================================================================

describe( 'adapter substitutability — stream sinks (ADR-018)', function () {

    let pipelineHandle;

    afterEach( async function () {
        if ( pipelineHandle && pipelineHandle.shutdown ) {
            await pipelineHandle.shutdown();
            pipelineHandle = null;
        }
        sinon.restore();
    } );

    it( 'Test 1: Terminal through a real flow returns the contract success shape', async function () {
        // Pre-build the real Terminal handle so we can attach a sinon spy
        // to publishNow before wiring. The flow's wire layer calls our
        // adapter's createEmitter, which hands back the already-spied
        // handle — the spy then captures the real publishNow's call args
        // AND its return value (the latter is the contract assertion).
        const realHandle = terminalModule.createEmitter();
        const publishSpy = sinon.spy( realHandle, 'publishNow' );

        // emit-if's introspect.js hardcodes target validation to
        // ['mqtt', 'gpio', 'terminal']. Using the natural 'terminal' ID for
        // the Terminal adapter is fine; the wire-emitters singleton registry
        // clears on shutdown, so it is empty between tests in this describe
        // block (afterEach calls pipelineHandle.shutdown).
        const adapter = {
            id: 'terminal',
            durabilityClass: 'best-effort',
            createEmitter: () => realHandle
        };

        // Terminal writes to console.log; suppress during the test so the
        // mocha output stays clean. The spy still captures the call.
        const consoleStub = sinon.stub( console, 'log' );
        try {
            pipelineHandle = await flow( 'substitutability-terminal' )
                .emitter( adapter, {} )
                .assetId( 'id' )
                .emitIf( 'alert', ( _msg ) => true, { target: adapter.id, insightType: 'log' } )
                .run();

            await pipelineHandle.processMessage( { id: 'S1', value: 42 } );

            // Substitutability assertions — exact contract shape.
            expect( publishSpy.calledOnce ).to.equal( true );
            // Topic format: includes the partitionId 'S1' (per emit-if's topic builder).
            expect( publishSpy.firstCall.args[ 0 ] ).to.match( /S1/ );
            // Exact-shape match catches any adapter that smuggles extras.
            expect( publishSpy.firstCall.returnValue ).to.deep.equal( { ok: true } );
            // Sync return per ADR-013 — never a Promise on the hot path.
            expect( publishSpy.firstCall.returnValue ).to.not.be.an.instanceOf( Promise );
        } finally {
            consoleStub.restore();
        }
    } );

    it( 'Test 2: MQTT through the SAME flow shape returns the IDENTICAL contract success shape', async function () {
        // The eventHandlers map captures handlers registered via client.on(...).
        // After createEmitter we fire 'connect' explicitly so the emitter's
        // getHealth().connected reads true. (emitIf publishes unconditionally;
        // the old isConnected() gate is retired per ADR-018 — callers
        // read the {ok} return instead of pre-checking.)
        const eventHandlers = {};
        const mockClient = createMockMqttClient( eventHandlers );

        const realHandle = mqttModule.createEmitter( {
            codec: jsonCodec,
            connectGraceMs: 0,
            mqttConnectFn: () => mockClient
        } );

        // Simulate broker connect — sets state.connected = true on the emitter.
        eventHandlers.connect();

        const publishSpy = sinon.spy( realHandle, 'publishNow' );

        const adapter = {
            id: 'mqtt',
            durabilityClass: 'best-effort',
            createEmitter: () => realHandle
        };

        pipelineHandle = await flow( 'substitutability-mqtt' )
            .emitter( adapter, {} )
            .assetId( 'id' )
            .emitIf( 'alert', ( _msg ) => true, { target: adapter.id, insightType: 'log' } )
            .run();

        await pipelineHandle.processMessage( { id: 'S1', value: 42 } );

        // IDENTICAL assertions to Test 1 — the proof of substitutability is
        // that the same set of structural assertions passes for both adapters.
        expect( publishSpy.calledOnce ).to.equal( true );
        expect( publishSpy.firstCall.args[ 0 ] ).to.match( /S1/ );
        expect( publishSpy.firstCall.returnValue ).to.deep.equal( { ok: true } );
        expect( publishSpy.firstCall.returnValue ).to.not.be.an.instanceOf( Promise );
    } );

    it( 'Test 3: MQTT error path through the flow returns the contract error shape — STORAGE_FULL', async function () {
        const eventHandlers = {};
        // ack: false — publish callbacks never fire, so every accepted
        // message stays unacknowledged and the counter stays up.
        const mockClient = createMockMqttClient( eventHandlers, { ack: false } );

        const realHandle = mqttModule.createEmitter( {
            codec: jsonCodec,
            connectGraceMs: 0,
            maxQueueSize: 10,
            mqttConnectFn: () => mockClient
        } );

        eventHandlers.connect();

        // Force the pre-flight reject path with real load: fill the
        // unacked window to 9 of 10 = 0.9 = STORAGE_PRESSURE_LIMIT, so
        // the flow's publish below is refused. These fill calls happen
        // before the spy attaches — the spy's first call is the flow's.
        for ( let i = 0; i < 9; i += 1 ) {
            realHandle.publishNow( 'fill/topic', { i } );
        }

        const publishSpy = sinon.spy( realHandle, 'publishNow' );

        const adapter = {
            id: 'mqtt',
            durabilityClass: 'best-effort',
            createEmitter: () => realHandle
        };

        pipelineHandle = await flow( 'substitutability-mqtt-err' )
            .emitter( adapter, {} )
            .assetId( 'id' )
            .emitIf( 'alert', ( _msg ) => true, { target: adapter.id, insightType: 'log' } )
            .run();

        await pipelineHandle.processMessage( { id: 'S1', value: 42 } );

        // Error-path contract — exact shape, no surprise extras.
        const result = publishSpy.firstCall.returnValue;

        expect( result ).to.not.be.an.instanceOf( Promise );
        expect( result.ok ).to.equal( false );
        // Exactly two keys on the error object — no smuggled diagnostic fields.
        expect( result.error ).to.have.all.keys( [ 'code', 'message' ] );
        // Exact code value — catches lowercase typos or vocabulary drift.
        expect( result.error.code ).to.equal( 'STORAGE_FULL' );
        expect( result.error.message ).to.be.a( 'string' ).with.length.greaterThan( 0 );

        // Side effect: the flow's message never reached the client — the
        // only client.publish calls are the 9 window-fill ones.
        expect( mockClient.publish.callCount ).to.equal( 9 );

        // Settle the stranded callbacks so the pipeline shutdown in
        // afterEach drains clean instead of timing out on unacked = 9.
        mockClient.publish.getCalls().forEach( ( call ) => {
            if ( call.args[ 3 ] ) call.args[ 3 ]();
        } );
    } );

} );

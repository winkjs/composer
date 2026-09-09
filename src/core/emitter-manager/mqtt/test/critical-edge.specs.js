// core/emitter-manager/mqtt/test/critical-edge.specs.js

/**
 * @fileoverview MQTT emitter — `onCritical` fires once per crossing.
 *
 * The callback is an edge signal, not a level signal. It fires when an
 * accepted publish lifts pressure above the critical threshold (0.8)
 * while the signal is armed, then disarms. It re-arms when an
 * acknowledgment brings pressure below the yellow threshold (0.66).
 * A pressure that holds above 0.8, or dips into the band between the
 * two thresholds and climbs again, fires nothing more.
 *
 * Each case scripts one pressure sequence on the mock client with
 * manual acknowledgments and asserts the exact call list. The cap is
 * 10, so every pressure value is a clean fraction.
 *
 * @see ADR-018 (the two-party rule; a signal is heard once per event)
 * @see ADR-021 (the unacked counter as the pressure gauge)
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import { createEmitter } from '../emitter.js';
import { makeMockClient, testCodec } from './test-helpers.js';

describe( 'mqtt emitter — onCritical edge trigger', function () {

    let emitter;
    let manual;

    /**
     * Builds an emitter over a manual-ack mock with cap 10 and records
     * every `onCritical` call.
     *
     * @returns {Promise<Array>} the call list the callback appends to
     */
    const buildEmitter = async function () {
        const calls = [];
        manual = makeMockClient( { manualAcks: true } );
        emitter = await createEmitter( {
            brokerUrl: 'mqtt://127.0.0.1',
            connectGraceMs: 0,
            codec: testCodec,
            maxQueueSize: 10,
            onCritical: ( reason, pressure ) => calls.push( { reason, pressure } ),
            mqttConnectFn: () => manual.client
        } );
        return calls;
    }; // buildEmitter()

    /**
     * Publishes `count` messages.
     *
     * @param {number} count - How many publishes to make
     */
    const publish = function ( count ) {
        for ( let i = 0; i < count; i += 1 ) {
            const result = emitter.publishNow( 'test/topic', { value: i } );
            expect( result.ok, 'every scripted publish must be accepted' ).to.equal( true );
        }
    }; // publish()

    /**
     * Acknowledges the oldest `count` publishes that are still pending.
     *
     * @param {number} count - How many acknowledgments to deliver
     */
    const ack = function ( count ) {
        for ( let i = 0; i < count; i += 1 ) {
            const call = manual.publishCalls.find( ( c ) => !c.acked );
            call.acked = true;
            call.cb();
        }
    }; // ack()

    afterEach( async function () {
        if ( emitter ) {
            // Every green case drains before it ends. A red case may
            // leave messages pending; the short budget and the catch
            // keep that from turning into a hook timeout.
            await emitter.shutdown( { timeout: 50 } ).catch( () => undefined );
            emitter = null;
        }
    } );

    it( 'fires once, on the accept that climbs past 0.8, before any acknowledgment', async function () {
        const calls = await buildEmitter();

        // 8 of 10 is exactly 0.8, which is not above the threshold.
        publish( 8 );
        expect( calls ).to.deep.equal( [] );

        // The 9th accept lifts pressure to 0.9. That is the crossing.
        publish( 1 );
        expect( calls ).to.deep.equal( [ { reason: 'QUEUE_CRITICAL', pressure: 0.9 } ] );

        ack( 9 );
    } );

    it( 'stays silent while pressure holds above 0.8', async function () {
        const calls = await buildEmitter();
        publish( 9 );
        expect( calls ).to.have.length( 1 );

        // Three cycles of one ack and one accept keep pressure between
        // 0.8 and 0.9. The signal is disarmed and nothing fires.
        for ( let cycle = 0; cycle < 3; cycle += 1 ) {
            ack( 1 );
            publish( 1 );
        }
        expect( calls ).to.have.length( 1 );

        ack( 9 );
    } );

    it( 'stays silent on a fall to 0.7 and a climb back past 0.8', async function () {
        const calls = await buildEmitter();
        publish( 9 );
        expect( calls ).to.have.length( 1 );

        // 0.7 is still at or above the yellow threshold, so the signal
        // stays disarmed. The climb back to 0.9 fires nothing.
        ack( 2 );
        expect( emitter.getPressure() ).to.equal( 0.7 );
        publish( 2 );
        expect( emitter.getPressure() ).to.equal( 0.9 );
        expect( calls ).to.have.length( 1 );

        ack( 9 );
    } );

    it( 'fires once more after a fall below 0.66 and a second climb past 0.8', async function () {
        const calls = await buildEmitter();
        publish( 9 );
        expect( calls ).to.have.length( 1 );

        // 0.5 is below the yellow threshold, so the acknowledgment
        // re-arms the signal. The next climb past 0.8 is a new crossing.
        ack( 4 );
        expect( emitter.getPressure() ).to.equal( 0.5 );
        publish( 4 );
        expect( calls ).to.deep.equal( [
            { reason: 'QUEUE_CRITICAL', pressure: 0.9 },
            { reason: 'QUEUE_CRITICAL', pressure: 0.9 }
        ] );

        ack( 9 );
    } );

} );

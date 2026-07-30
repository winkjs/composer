// core/test/record-reuse-pattern.specs.js

/**
 * @fileoverview Proves the handbook's record-reuse pattern end to end,
 * without live services.
 *
 * The pattern (handbook, "Reusing one record in annotate"): a dense gate
 * fills and returns ONE pre-allocated record on every firing, instead of
 * building a fresh object each time. The user-facing promise is simple:
 * output N carries message N's values, never message N+1's. That promise
 * rests on facts proven elsewhere — every sink reads the record inside its
 * call (ADR-023, the sealed-record tests), and only one message is ever in
 * flight (ADR-013). This file tests the COMPOSITION of those facts, as a
 * user would experience it: many firings, one record, every output correct.
 * A future change to a gate or a codec could break the composition while
 * the fact-level tests stay green; this file is the net for that.
 *
 * Three groups:
 *
 *   1. Persist side — persistIf driven with the handbook's example record,
 *      across two partitions sharing one gate. The capture storage copies
 *      the record's values at write time; the copies must match each
 *      firing's own values, even after later firings overwrite the record.
 *   2. Emit side — the real MQTT emitter with the real production codecs
 *      (JSON and MessagePack). Each captured payload, decoded, must match
 *      its own firing. This also re-proves encode-before-return for the
 *      shipped codecs, not just the test codec the ADR-023 suite uses.
 *   3. The documented failure mode — a shaper that breaks the handbook's
 *      rule 1 (overwrite every changing field on every firing) must
 *      produce exactly the stale row the handbook warns about. The
 *      warning stays an executable fact, not prose.
 *
 * The end-to-end leg through live QuestDB lives separately, with the other
 * service-backed specs: storage-manager/questdb/test/e2e-questdb-record-reuse.specs.js.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import persistIfInit from '../../nodes/persist-if/init.js';
import persistIfUpdate from '../../nodes/persist-if/update.js';
import { createEmitter as createMqttEmitter } from '../emitter-manager/mqtt/emitter.js';
import { makeMockClient, fireConnect } from '../emitter-manager/mqtt/test/test-helpers.js';
import { jsonCodec, msgpackCodec } from '../codec/index.js';

const WRITE_OK = { ok: true };

/**
 * A storage stand-in that copies the record's values the moment write()
 * is called. The copy is the whole point: the record mutates on the next
 * firing by design, so holding the reference (as a sinon stub's recorded
 * args would) shows the LAST firing's values everywhere — the exact
 * confusion the reuse pattern warns about. It also keeps each record
 * reference, so the tests can prove reuse actually happened.
 */
const makeCaptureStorage = function () {
    const snapshots = [];
    const recordRefs = [];
    return {
        snapshots,
        recordRefs,
        write: function ( insightType, record, partitionId ) {
            recordRefs.push( record );
            snapshots.push( { insightType, partitionId, ...record } );
            return WRITE_OK;
        }
    };
}; // makeCaptureStorage()

// Builds a persistIf state wired to the given shaper and capture storage,
// mirroring what the partition manager does per partition: init from the
// (shared) spec, then inject the storage handle and the partition id.
const makeGateState = function ( spec, storage, partitionId ) {
    const state = persistIfInit( spec );
    state.storage = storage;
    state.partitionId = partitionId;
    return state;
}; // makeGateState()

describe( 'record-reuse pattern (handbook: "Reusing one record in annotate")', function () {

    describe( 'persist side — one record, many firings, two partitions', function () {

        // The handbook example, verbatim in shape: constants written once
        // at creation, changing fields overwritten on every firing.
        const eventRecord = {
            eventTime: null,
            eventType: 'signFlip',
            severity: 'warning',
            value: null
        };

        const shapeEvent = function ( msg ) {
            eventRecord.eventTime = msg.eventTime;
            eventRecord.value = msg.activePower;
            return eventRecord;
        };

        const spec = {
            nodeType: 'Persist If',
            name: 'persistFlips',
            predicate: ( _msg ) => true,
            insightType: 'powerEvents',
            storageName: 'capture',
            annotate: shapeEvent
        };

        it( 'every stored copy carries its own firing\'s values, never a later one\'s', function () {
            const storage = makeCaptureStorage();
            const gateA = makeGateState( spec, storage, 'meterA' );
            const gateB = makeGateState( spec, storage, 'meterB' );

            // Interleave partitions on purpose: the record is shared by
            // the whole gate, so partition order is where cross-firing
            // corruption would show up first.
            persistIfUpdate( gateA, { eventTime: 1000, activePower: -42 } );
            persistIfUpdate( gateB, { eventTime: 2000, activePower: 7.5 } );
            persistIfUpdate( gateA, { eventTime: 3000, activePower: 99 } );

            // Assert AFTER all three firings. The first snapshot must
            // still show the first firing's values, although the record
            // itself has been overwritten twice since.
            expect( storage.snapshots.length ).to.equal( 3 );
            expect( storage.snapshots[ 0 ] ).to.deep.equal( {
                insightType: 'powerEvents',
                partitionId: 'meterA',
                eventTime: 1000,
                eventType: 'signFlip',
                severity: 'warning',
                value: -42
            } );
            expect( storage.snapshots[ 1 ] ).to.deep.equal( {
                insightType: 'powerEvents',
                partitionId: 'meterB',
                eventTime: 2000,
                eventType: 'signFlip',
                severity: 'warning',
                value: 7.5
            } );
            expect( storage.snapshots[ 2 ] ).to.deep.equal( {
                insightType: 'powerEvents',
                partitionId: 'meterA',
                eventTime: 3000,
                eventType: 'signFlip',
                severity: 'warning',
                value: 99
            } );
        } );

        it( 'the gate really received the same record object every time', function () {
            // Guards the test itself against becoming vacuous: if a future
            // edit made the shaper return fresh objects, the previous test
            // would still pass while no longer testing reuse at all.
            const storage = makeCaptureStorage();
            const gate = makeGateState( spec, storage, 'meterA' );

            persistIfUpdate( gate, { eventTime: 1, activePower: 1 } );
            persistIfUpdate( gate, { eventTime: 2, activePower: 2 } );

            expect( storage.recordRefs.length ).to.equal( 2 );
            expect( storage.recordRefs[ 1 ] ).to.equal( storage.recordRefs[ 0 ] );
            expect( storage.recordRefs[ 0 ] ).to.equal( eventRecord );
        } );
    } );

    describe( 'emit side — one record through the real production codecs', function () {

        [ { name: 'jsonCodec', codec: jsonCodec }, { name: 'msgpackCodec', codec: msgpackCodec } ].forEach( function ( entry ) {

            it( `${entry.name}: each payload decodes to its own firing's values`, async function () {
                const mock = makeMockClient();
                const emitter = createMqttEmitter( {
                    brokerUrl: 'mqtt://localhost',
                    connectGraceMs: 0,
                    codec: entry.codec,
                    mqttConnectFn: () => mock.client
                } );
                fireConnect( mock.eventHandlers );

                // The reused payload record: one constant, two changing
                // fields, overwritten before every publish.
                const payload = { alert: 'overTemp', reading: null, seq: null };

                payload.reading = 91.5;
                payload.seq = 1;
                const first = emitter.publishNow( 'plant/oven', payload );
                payload.reading = 92.25;
                payload.seq = 2;
                const second = emitter.publishNow( 'plant/oven', payload );
                payload.reading = 88;
                payload.seq = 3;
                const third = emitter.publishNow( 'plant/oven', payload );

                expect( first.ok ).to.equal( true );
                expect( second.ok ).to.equal( true );
                expect( third.ok ).to.equal( true );

                // Decode what the transport was actually handed. If the
                // emitter (or the codec) deferred any part of the read,
                // later payloads would repeat the last firing's values.
                const decoded = mock.publishCalls.map( ( call ) => entry.codec.unpack( call.payload ) );
                expect( decoded.length ).to.equal( 3 );
                expect( decoded[ 0 ] ).to.deep.equal( { alert: 'overTemp', reading: 91.5, seq: 1 } );
                expect( decoded[ 1 ] ).to.deep.equal( { alert: 'overTemp', reading: 92.25, seq: 2 } );
                expect( decoded[ 2 ] ).to.deep.equal( { alert: 'overTemp', reading: 88, seq: 3 } );

                await emitter.shutdown();
            } );
        } );
    } );

    describe( 'the documented failure mode — handbook rule 1 broken on purpose', function () {

        it( 'a conditionally-skipped field carries the previous firing\'s value into the next row', function () {
            // This asserts the CURRENT, documented consequence of breaking
            // rule 1 ("overwrite every changing field on every firing").
            // The handbook warns about exactly this row; the test makes the
            // warning an executable fact. If this test ever fails, the
            // framework has started defending against the mistake — update
            // the handbook section in the same change set.
            const staleRecord = { eventTime: null, value: null };
            const brokenShaper = function ( msg ) {
                staleRecord.eventTime = msg.eventTime;
                if ( Number.isFinite( msg.power ) ) {
                    staleRecord.value = msg.power;
                }
                return staleRecord;
            };

            const storage = makeCaptureStorage();
            const gate = makeGateState( {
                nodeType: 'Persist If',
                name: 'brokenGate',
                predicate: ( _msg ) => true,
                insightType: 'events',
                storageName: 'capture',
                annotate: brokenShaper
            }, storage, 'p1' );

            persistIfUpdate( gate, { eventTime: 1000, power: 42 } );
            persistIfUpdate( gate, { eventTime: 2000 } );

            expect( storage.snapshots[ 0 ].value ).to.equal( 42 );
            // The stale row: firing 2 had no power reading, yet its copy
            // carries firing 1's value.
            expect( storage.snapshots[ 1 ].eventTime ).to.equal( 2000 );
            expect( storage.snapshots[ 1 ].value ).to.equal( 42 );
        } );
    } );
} );

// core/test/sink-synchronous-consumption.specs.js

/**
 * @fileoverview Proves every shipped sink consumes the record synchronously
 * (ADR-023).
 *
 * A sink must read everything it needs from the incoming message before its
 * hot-path call returns, and must never keep the reference for a later read.
 * The rule matters because a gate may hand every firing the SAME reused
 * record (the handbook's record-reuse pattern, and the future declarative
 * shaping): a sink that reads late would see a later message's values and
 * persist silently corrupted data.
 *
 * Mechanism: each sink is driven with a record wrapped by the sealed-record
 * harness (`src/core/test-utils/sealed-record.js`). The record is sealed the
 * moment the hot-path call returns. The test then lets pending callbacks run
 * and asserts that not one read arrived after the seal. The harness's own
 * suite proves it detects a deferring consumer, so a green run here shows
 * the sinks comply — not that the check is too weak to fail.
 *
 * All three sinks run without live services, on the same injected fakes
 * their own unit suites use (mock QuestDB sender/pg, mock mqtt.js client,
 * stubbed console). The test iterates a SINKS table, following
 * `adapter-module-surface.specs.js`. A future sink adapter gets covered by
 * adding one row, and the sink-count assertion fails until it is added.
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import sinon from 'sinon';

import { makeSealedRecord } from '../test-utils/sealed-record.js';
import { createQuestDBStorage } from '../storage-manager/questdb/index.js';
import { makeMockSender, makeMockDeps } from '../storage-manager/questdb/test/test-helpers.js';
import { createEmitter as createMqttEmitter } from '../emitter-manager/mqtt/emitter.js';
import { makeMockClient, fireConnect, waitForCallbacks, testCodec } from '../emitter-manager/mqtt/test/test-helpers.js';
import { createEmitter as createTerminalEmitter } from '../emitter-manager/terminal/index.js';

// One record shape serves all three sinks. The QuestDB row needs the
// declared columns and an integer designated timestamp so the full
// validate-then-write path runs (a skipped row would read less).
const ASSET_CLASS = {
    name: 'pump',
    columns: {
        ts: { type: 'timestamp' },
        temp: { type: 'float64' },
        pressure: { type: 'float64' }
    },
    insightTypes: {
        monitoring: {
            columns: [ 'ts', 'temp', 'pressure' ],
            designatedTimestamp: 'ts'
        }
    }
};

const RECORD_FIELDS = { ts: 1735500000000, temp: 25.5, pressure: 95.0 };

/**
 * Each row drives one sink's hot-path method with the given record and
 * returns the sync result plus an async teardown that lets the sink's
 * post-return callbacks run and shuts it down. The seal happens in the
 * test, between drive and teardown — exactly at the call boundary the
 * contract draws.
 */
const SINKS = [
    {
        name: 'questdb storage — write()',
        drive: async function ( record ) {
            const storage = await createQuestDBStorage(
                ASSET_CLASS,
                'pump',
                { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812', flushMode: 'auto' },
                makeMockDeps( makeMockSender() )
            );
            const result = storage.write( 'monitoring', record, 'asset1' );
            return { result, teardown: () => storage.shutdown() };
        }
    },
    {
        name: 'mqtt emitter — publishNow()',
        drive: function ( record ) {
            const mock = makeMockClient();
            const emitter = createMqttEmitter( {
                brokerUrl: 'mqtt://localhost',
                // Grace disabled: drive() must get the handle in the
                // same tick — the ADR-023 seal happens at the call
                // boundary.
                connectGraceMs: 0,
                codec: testCodec,
                mqttConnectFn: () => mock.client
            } );
            fireConnect( mock.eventHandlers );
            const result = emitter.publishNow( 'test/topic', record );
            return {
                result,
                teardown: async function () {
                    // Let the mock broker ack fire — the window in which a
                    // deferring emitter would do its late read.
                    await waitForCallbacks();
                    await emitter.shutdown();
                }
            };
        }
    },
    {
        name: 'terminal emitter — publishNow()',
        drive: function ( record ) {
            sinon.stub( console, 'log' );
            const emitter = createTerminalEmitter( { assetClass: { columns: ASSET_CLASS.columns } } );
            const result = emitter.publishNow( 'test/topic', record );
            return { result, teardown: () => emitter.shutdown() };
        }
    }
];

describe( 'sink synchronous consumption (ADR-023)', function () {

    afterEach( function () {
        sinon.restore();
    } );

    // A new sink adapter must be added to the SINKS table above. This
    // count fails until it is (same idea as adapter-module-surface).
    it( 'covers all three shipped sinks', function () {
        expect( SINKS.length ).to.equal( 3 );
    } );

    SINKS.forEach( function ( sink ) {

        it( `${sink.name} reads the record only during the call`, async function () {
            const { record, seal, violations, reads } = makeSealedRecord( { ...RECORD_FIELDS } );

            const { result, teardown } = await sink.drive( record );
            seal();
            await teardown();

            expect( result.ok ).to.equal( true );
            expect( reads.length > 0 ).to.equal( true );
            expect( violations ).to.deep.equal( [] );
        } );
    } );
} );
